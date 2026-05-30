/**
 * Convert agent-emitted Markdown into Telegram-compatible HTML.
 *
 * Telegram's HTML parse_mode supports a small subset:
 *   <b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>,
 *   <span class="tg-spoiler">, <a href>, <code>, <pre>, <blockquote>,
 *   <tg-emoji emoji-id>.
 *
 * Within prose we must HTML-escape &, <, >. Inside <code> and <pre> we
 * also escape but we DON'T then run Markdown over the contents.
 *
 * Coverage:
 *   ```lang\ncode\n```  -> <pre><code class="language-lang">…</code></pre>
 *   ```code```          -> <pre><code>…</code></pre>
 *   `inline code`       -> <code>…</code>
 *   **bold** / __bold__ -> <b>…</b>
 *   *italic* / _italic_ -> <i>…</i>
 *   ~~strike~~          -> <s>…</s>
 *   [text](url)         -> <a href="url">text</a>
 *
 * Order matters: we tokenize code blocks first so their internals don't
 * get scanned for asterisks, then escape the prose, then apply inline
 * markup, then splice the codeblocks back in.
 */
// Allow-list of URL schemes for markdown `[text](url)` links. Ported
// from the matrix bridge: a prompt-injected / adversarial agent emitting
// `[click](javascript:alert(1))` could otherwise produce a clickable
// XSS vector if a downstream Telegram client renders schemed hrefs
// loosely. We restrict to http(s), ftp, mailto, magnet plus relative
// paths and fragment-only links; everything else falls through to
// plain bracketed text.
const ALLOWED_LINK_SCHEMES = /^(?:https?|ftp|mailto|magnet|tg):/i;
const RELATIVE_OR_FRAGMENT = /^(?:[\/#?]|[a-zA-Z0-9_\-.]+$)/;

export function markdownToTelegramHtml(md: string): string {
	// Strip NULL bytes up front. The placeholder sentinel below is built
	// around `\u0000PH<n>\u0000`; an agent emitting literal NULL bytes
	// could otherwise collide with a real placeholder and corrupt the
	// spliced-back content.
	md = md.replace(/\u0000/g, "");

	// GFM markdown tables → ASCII-aligned <pre> blocks. Telegram's HTML
	// parse_mode doesn't support <table>, so we render the same data as a
	// monospaced pre-formatted block. Detect `| header | header |` rows
	// followed by `|---|---|` separator + body rows; emit a `<pre>` with
	// each cell padded to the column's widest value. Runs BEFORE the
	// fenced-code-block pass so the pre placeholder is registered
	// alongside the other code blocks and survives the rest of the
	// markdown passes intact.
	md = renderGfmTables(md);

	const placeholders: string[] = [];
	const placeholder = (html: string): string => {
		const key = `\u0000PH${placeholders.length}\u0000`;
		placeholders.push(html);
		return key;
	};

	let s = md;

	// Triple-backtick code blocks first (across lines). Trim the trailing
	// newline that lives between the body and the closing fence so <pre>
	// doesn't render an empty line at the end.
	s = s.replace(/```([a-zA-Z0-9_+\-]*)\n?([\s\S]*?)\n?```/g, (_m, lang: string, code: string) => {
		const tag = lang
			? `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`
			: `<pre>${escapeHtml(code)}</pre>`;
		return placeholder(tag);
	});

	// Inline code.
	s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => placeholder(`<code>${escapeHtml(code)}</code>`));

	// Escape remaining prose.
	s = escapeHtml(s);

	// Bold: ** or __ around non-empty text on a single line.
	s = s.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<b>$1</b>");
	s = s.replace(/__([^_\n][^_\n]*?)__/g, "<b>$1</b>");

	// Italic: a single * or _ not adjacent to another. Run after bold so we
	// don't eat the asterisks that belong to **bold**.
	s = s.replace(/(^|[\s(])\*([^\s*][^\n*]*?)\*(?=[\s.,;:!?)\]]|$)/gm, "$1<i>$2</i>");
	s = s.replace(/(^|[\s(])_([^\s_][^\n_]*?)_(?=[\s.,;:!?)\]]|$)/gm, "$1<i>$2</i>");

	// Strikethrough (double-tilde for GFM, single-tilde for Telegram MD).
	s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
	s = s.replace(/(?<![~\w])~([^~\n]+)~(?![~\w])/g, "<s>$1</s>");

	// Links: [text](url). URL was already &-escaped above. We additionally
	// scheme-validate so `javascript:`/`data:`/`vbscript:` etc. can't slip
	// through into the href — render as plain text in that case so the user
	// still sees what was emitted but it can't be clicked into an XSS.
	s = s.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_m, text: string, url: string) => {
		const trimmed = url.trim();
		const isSchemed = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(trimmed);
		const allowed = isSchemed
			? ALLOWED_LINK_SCHEMES.test(trimmed)
			: RELATIVE_OR_FRAGMENT.test(trimmed);
		if (!allowed) {
			const safeUrl = trimmed
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;");
			return `[${text}](${safeUrl})`;
		}
		const safeUrl = trimmed.replace(/"/g, "&quot;");
		return `<a href="${safeUrl}">${text}</a>`;
	});

	// Splice code blocks back.
	for (let i = 0; i < placeholders.length; i++) {
		s = s.replace(`\u0000PH${i}\u0000`, placeholders[i]!);
	}

	return s;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Pre-pass that walks the markdown line by line, finds GFM tables, and
// rewrites each into a triple-backtick block containing the ASCII-padded
// table. The triple-backtick block is then consumed by the existing
// fenced-code-block extractor, so the table survives unmangled through
// the rest of the markdown passes.
function renderGfmTables(md: string): string {
	const lines = md.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		const isRowLike = /^\s*\|.+\|?\s*$/.test(line);
		const isSeparator =
			i + 1 < lines.length &&
			/^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!) &&
			/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]!);
		if (!isRowLike || !isSeparator) {
			out.push(line);
			i++;
			continue;
		}
		const header = parseTableRow(line);
		i += 2;
		const body: string[][] = [];
		while (i < lines.length && /^\s*\|.+\|?\s*$/.test(lines[i]!)) {
			body.push(parseTableRow(lines[i]!));
			i++;
		}
		// Compute column widths.
		const widths: number[] = header.map((c) => c.length);
		for (const row of body) {
			for (let c = 0; c < row.length; c++) {
				if ((row[c] ?? "").length > (widths[c] ?? 0)) widths[c] = row[c]!.length;
			}
		}
		const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));
		const renderRow = (cells: string[]): string =>
			cells.map((c, idx) => pad(c, widths[idx] ?? c.length)).join(" │ ");
		const sep = widths.map((w) => "─".repeat(w)).join("─┼─");
		const renderedHeader = renderRow(header);
		const renderedBody = body.map(renderRow);
		out.push("```");
		out.push(renderedHeader);
		out.push(sep);
		for (const r of renderedBody) out.push(r);
		out.push("```");
	}
	return out.join("\n");
}

function parseTableRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|")) s = s.slice(0, -1);
	return s.split("|").map((c) => c.trim());
}
