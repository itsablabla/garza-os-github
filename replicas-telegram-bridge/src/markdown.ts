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
