import { describe, expect, it } from "vitest";
import { markdownToTelegramHtml } from "./markdown";

describe("markdownToTelegramHtml", () => {
	it("converts double-asterisk bold", () => {
		expect(markdownToTelegramHtml("**Core (always loaded)**")).toBe(
			"<b>Core (always loaded)</b>",
		);
	});

	it("converts single-asterisk italic without eating bold", () => {
		expect(markdownToTelegramHtml("a *one* and **two** there")).toBe(
			"a <i>one</i> and <b>two</b> there",
		);
	});

	it("converts inline code and escapes HTML inside", () => {
		expect(markdownToTelegramHtml("call `<foo & bar>` now")).toBe(
			"call <code>&lt;foo &amp; bar&gt;</code> now",
		);
	});

	it("converts fenced code blocks with language", () => {
		expect(markdownToTelegramHtml("```ts\nconst x = 1;\n```")).toBe(
			'<pre><code class="language-ts">const x = 1;</code></pre>',
		);
	});

	it("converts plain fenced code blocks without language", () => {
		expect(markdownToTelegramHtml("```\nhello\n```")).toBe("<pre>hello</pre>");
	});

	it("converts markdown links", () => {
		expect(markdownToTelegramHtml("[github](https://github.com/owner/repo)")).toBe(
			'<a href="https://github.com/owner/repo">github</a>',
		);
	});

	it("escapes ampersands and angle brackets in prose", () => {
		expect(markdownToTelegramHtml("if x < 5 && y > 0")).toBe("if x &lt; 5 &amp;&amp; y &gt; 0");
	});

	it("preserves code-block contents from markdown processing", () => {
		expect(markdownToTelegramHtml("Use ```\n**not bold**\n```")).toBe(
			"Use <pre>**not bold**</pre>",
		);
	});

	it("converts single-tilde and double-tilde strikethrough", () => {
		expect(markdownToTelegramHtml("~~gone~~")).toBe("<s>gone</s>");
		expect(markdownToTelegramHtml("~item~")).toBe("<s>item</s>");
		expect(markdownToTelegramHtml("a ~mid~ b")).toBe("a <s>mid</s> b");
	});

	it("does not strike words that include a tilde elsewhere", () => {
		expect(markdownToTelegramHtml("foo~bar~baz")).toBe("foo~bar~baz");
	});

	it("handles a realistic agent reply", () => {
		const md = [
			"Here's a high-level overview:",
			"",
			"**Core (always loaded)**",
			"- File ops: Read, Write, Edit, Glob, Grep",
			"- Shell: Bash",
			"",
			"**Deferred** — load via `ToolSearch`:",
			"- *italic* and ~~strike~~ work too",
		].join("\n");

		const html = markdownToTelegramHtml(md);
		expect(html).toContain("<b>Core (always loaded)</b>");
		expect(html).toContain("<b>Deferred</b>");
		expect(html).toContain("<code>ToolSearch</code>");
		expect(html).toContain("<i>italic</i>");
		expect(html).toContain("<s>strike</s>");
	});

	it("blocks javascript: link schemes (renders as bracketed plain text)", () => {
		const out = markdownToTelegramHtml("[click](javascript:alert(1))");
		expect(out).not.toContain("<a ");
		expect(out).not.toContain("href=");
		expect(out).toContain("[click]");
	});

	it("blocks data: link schemes", () => {
		const out = markdownToTelegramHtml("[x](data:text/html,<script>alert(1)</script>)");
		expect(out).not.toContain("<a ");
		expect(out).not.toContain("<script>");
	});

	it("allows http(s), mailto, ftp, magnet, tg link schemes", () => {
		expect(markdownToTelegramHtml("[a](http://x.com)")).toContain('href="http://x.com"');
		expect(markdownToTelegramHtml("[a](https://x.com)")).toContain('href="https://x.com"');
		expect(markdownToTelegramHtml("[a](mailto:x@y.com)")).toContain('href="mailto:x@y.com"');
		expect(markdownToTelegramHtml("[a](tg://user?id=123)")).toContain('href="tg://user?id=123"');
	});

	it("strips NULL bytes from input", () => {
		const out = markdownToTelegramHtml("a\u0000PH0\u0000b");
		expect(out).not.toContain("\u0000");
	});
});
