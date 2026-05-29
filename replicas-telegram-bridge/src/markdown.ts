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

	// Escape remaining prose.
	s = escapeHtml(s);

	// Bold: ** or __ around non-empty text on a single line.
	s = s.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<b>$1</b>");
	s = s.replace(/__([^_\n][^_\n]*?)__/g, "<b>$1</b>");

	// Italic: a single * or _ not adjacent to another. Run after bold so we
	// don't eat the asterisks that belong to **bold**.
	s = s.replace(/(^|[\s(])\*([^\s*][^\n*]*?)\*(?=[\s.,;:!?)\]]|$)/gm, "$1<i>$2</i>");
	s = s.replace(/(^|[\s(])_([^\s_][^\n_]*?)_(?=[\s.,;:!?)\]]|$)/gm, "$1<i>$2</i>");

	// Strikethrough.
	s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");

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
