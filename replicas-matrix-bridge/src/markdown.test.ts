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

	it("renders ATX headers as <h1>-<h6>", () => {
		expect(markdownToTelegramHtml("# Big")).toContain("<h1>Big</h1>");
		expect(markdownToTelegramHtml("### Smaller")).toContain("<h3>Smaller</h3>");
		expect(markdownToTelegramHtml("###### Smallest")).toContain("<h6>Smallest</h6>");
	});

	it("renders bullet lists as <ul><li>", () => {
		const out = markdownToTelegramHtml("- one\n- two\n- three");
		expect(out).toContain("<ul><li>one</li><li>two</li><li>three</li></ul>");
	});

	it("renders numbered lists as <ol><li>", () => {
		const out = markdownToTelegramHtml("1. first\n2. second");
		expect(out).toContain("<ol><li>first</li><li>second</li></ol>");
	});

	it("blank lines between paragraphs become <br><br>", () => {
		expect(markdownToTelegramHtml("first\n\nsecond")).toBe("first<br><br>second");
	});

	it("blocks javascript: link schemes (renders as bracketed plain text)", () => {
		const out = markdownToTelegramHtml("[click me](javascript:alert(1))");
		expect(out).not.toContain("<a ");
		expect(out).not.toContain("href=");
		expect(out).toContain("[click me]");
		expect(out).toContain("javascript:alert(1)");
	});

	it("blocks data: URI link schemes", () => {
		const out = markdownToTelegramHtml("[x](data:text/html,<script>alert(1)</script>)");
		expect(out).not.toContain("<a ");
		expect(out).not.toContain("<script>");
	});

	it("allows http, https, mailto, ftp, magnet schemes", () => {
		expect(markdownToTelegramHtml("[a](http://x.com)")).toContain('href="http://x.com"');
		expect(markdownToTelegramHtml("[a](https://x.com)")).toContain('href="https://x.com"');
		expect(markdownToTelegramHtml("[a](mailto:x@y.com)")).toContain('href="mailto:x@y.com"');
		expect(markdownToTelegramHtml("[a](ftp://x.com/file)")).toContain('href="ftp://x.com/file"');
	});

	it("allows relative paths and fragment-only links", () => {
		expect(markdownToTelegramHtml("[a](/path/to/thing)")).toContain('href="/path/to/thing"');
		expect(markdownToTelegramHtml("[a](#anchor)")).toContain('href="#anchor"');
	});

	it("strips null bytes from input so they cannot collide with placeholders", () => {
		const out = markdownToTelegramHtml("a\u0000PH0\u0000b");
		// The literal "PH0" survives but the wrapping NULL bytes are gone,
		// so the splice-back step cannot mistake it for a real placeholder.
		expect(out).not.toContain("\u0000");
	});

	it("the actual tools-list response shape renders cleanly", () => {
		const md = [
			"# Available Tools",
			"",
			"**Core (loaded):**",
			"- Files: Read, Write, Edit",
			"- Shell: Bash",
			"",
			"**Skills:**",
			"- update-config",
			"- replicas-agent",
		].join("\n");
		const html = markdownToTelegramHtml(md);
		expect(html).toContain("<h1>Available Tools</h1>");
		expect(html).toContain("<b>Core (loaded):</b>");
		expect(html).toContain("<ul><li>Files: Read, Write, Edit</li><li>Shell: Bash</li></ul>");
		expect(html).toContain("<ul><li>update-config</li><li>replicas-agent</li></ul>");
	});
});
