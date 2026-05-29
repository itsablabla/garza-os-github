/**
 * Convert agent-emitted Markdown into Matrix-compatible HTML.
 *
 * Matrix's `org.matrix.custom.html` subset is much richer than Telegram's,
 * so on top of the inline subset (bold/italic/code/links/strikethrough)
 * we also handle block-level structure: ATX headers, bullet + numbered
 * lists, and blank-line paragraph breaks. Inside list items + headers we
 * still run the inline pass so **bold** etc. keep working.
 *
 * Pipeline:
 *   1. extract fenced code blocks (so their internals are inert)
 *   2. extract inline `code`
 *   3. line-walk to group headers + list runs + blanks
 *   4. inline pass on the remaining prose
 *   5. paste the code placeholders back
 */
export function markdownToTelegramHtml(md: string): string {
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

	// Block-level pre-pass: walk lines and emit <h1>-<h6>, <ul>/<ol>, and
	// paragraph-grouped prose. The code placeholders are opaque tokens at this
	// point so the line-walker won't false-trigger on `#` etc. inside code.
	s = blockify(s);

	// Escape remaining prose. blockify already escaped the text it touched
	// (header/list innards), so re-escaping inside <h*>/<li> would double-encode.
	// Mark already-emitted blocks with a sentinel and escape only outside.
	s = escapeOutsideBlocks(s);

	// Bold: ** or __ around non-empty text on a single line.
	s = s.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<b>$1</b>");
	s = s.replace(/__([^_\n][^_\n]*?)__/g, "<b>$1</b>");

	// Italic: a single * or _ not adjacent to another. Run after bold so we
	// don't eat the asterisks that belong to **bold**. The `>` in the prefix
	// class lets us match italics that landed immediately after a block-tag
	// opener (e.g. `<li>*italic*</li>`).
	s = s.replace(/(^|[\s(>])\*([^\s*][^\n*]*?)\*(?=[\s.,;:!?)\]<]|$)/gm, "$1<i>$2</i>");
	s = s.replace(/(^|[\s(>])_([^\s_][^\n_]*?)_(?=[\s.,;:!?)\]<]|$)/gm, "$1<i>$2</i>");

	// Strikethrough (double-tilde for GFM, single-tilde for Telegram MD).
	s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
	s = s.replace(/(?<![~\w])~([^~\n]+)~(?![~\w])/g, "<s>$1</s>");

	// Links: [text](url). URL was already &-escaped above; restore safe quotes.
	s = s.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_m, text: string, url: string) => {
		const safeUrl = url.replace(/"/g, "&quot;");
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

// Walk lines and convert # headers + bullet/numbered list runs + paragraph
// breaks. Returns text where header/list segments are already wrapped in
// their HTML tags; surrounding prose is left as-is. Newlines that fall
// inside a paragraph become <br>; blank-line-separated paragraphs are
// joined with <br><br> later by escapeOutsideBlocks (which doesn't touch
// the block segments).
function blockify(s: string): string {
	const lines = s.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		// ATX header
		const h = /^(#{1,6})\s+(.*)$/.exec(line);
		if (h) {
			const level = h[1]!.length;
			out.push(`<h${level}>${escapeHtml(h[2]!)}</h${level}>`);
			i++;
			continue;
		}
		// Bullet list run
		if (/^\s*[-*]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
				items.push(escapeHtml(lines[i]!.replace(/^\s*[-*]\s+/, "")));
				i++;
			}
			out.push(`<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`);
			continue;
		}
		// Numbered list run
		if (/^\s*\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
				items.push(escapeHtml(lines[i]!.replace(/^\s*\d+\.\s+/, "")));
				i++;
			}
			out.push(`<ol>${items.map((x) => `<li>${x}</li>`).join("")}</ol>`);
			continue;
		}
		out.push(line);
		i++;
	}
	return out.join("\n");
}

// Escape text that lives OUTSIDE the block tags we already emitted, and
// turn paragraph-style blank-line gaps into `<br><br>` while a single
// newline becomes a `<br>`. Blocks themselves pass through unchanged.
function escapeOutsideBlocks(s: string): string {
	// Tokenize on the block tags blockify produced so we can leave their
	// contents alone while escaping the prose between them.
	const blockTag = /<(\/?(?:h[1-6]|ul|ol|li))>/g;
	const parts: string[] = [];
	let last = 0;
	let inBlock = 0;
	for (const m of s.matchAll(blockTag)) {
		parts.push(s.slice(last, m.index));
		parts.push(m[0]!);
		last = m.index + m[0]!.length;
		inBlock += m[1]!.startsWith("/") ? -1 : 1;
		void inBlock;
	}
	parts.push(s.slice(last));

	// Apply the prose-only transforms to the non-tag chunks. Tag chunks
	// already contain raw HTML and pre-escaped innards, so leave them.
	let result = "";
	let isTag = false;
	for (const part of parts) {
		if (isTag) {
			result += part;
		} else {
			let chunk = escapeHtml(part);
			// Paragraph breaks: blank line → <br><br>; single newline → <br>.
			chunk = chunk.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
			// Trim leading/trailing <br> that hang next to block tags.
			chunk = chunk.replace(/^(<br>)+/, "").replace(/(<br>)+$/, "");
			result += chunk;
		}
		isTag = !isTag;
	}
	return result;
}
