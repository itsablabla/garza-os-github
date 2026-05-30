import { describe, expect, it } from "vitest";
import { archiveBasename } from "./output-archive";

describe("archiveBasename", () => {
	it("uses Read/Edit file_path basename", () => {
		expect(archiveBasename("Read", { file_path: "/foo/bar/baz.ts" })).toBe("baz.ts.out.txt");
	});

	it("sanitizes path special chars in file_path", () => {
		const name = archiveBasename("Read", { file_path: "/etc/foo bar?.txt" });
		expect(name).not.toContain(" ");
		expect(name).not.toContain("?");
	});

	it("uses Bash command's first NON-env-var token", () => {
		// SECURITY: this used to leak secrets when the agent inlined an
		// env-var assignment in front of a command, e.g.
		// `OPENAI_API_KEY=sk-xxx node srv.js` → basename
		// `OPENAI_API_KEY_sk-xxx.out.txt` ending up in a public R2 URL.
		const name = archiveBasename("Bash", {
			command: "OPENAI_API_KEY=sk-xxx node srv.js",
		});
		expect(name).toBe("node.out.txt");
		expect(name).not.toContain("OPENAI");
		expect(name).not.toContain("sk-xxx");
	});

	it("skips multiple env vars + nohup prefix", () => {
		const name = archiveBasename("Bash", {
			command: "DEBUG=1 OPENAI_API_KEY=sk-xxx nohup bun build",
		});
		expect(name).toBe("bun.out.txt");
	});

	it("strips trailing =… defensively even if regex missed something", () => {
		const name = archiveBasename("Bash", { command: "FOO=bar" });
		// FOO=bar matches env-var rule and is skipped → falls back to "bash"
		expect(name).toBe("bash.out.txt");
	});

	it("falls back to bash when command is empty", () => {
		expect(archiveBasename("Bash", { command: "" })).toBe("bash.out.txt");
	});

	it("falls back to tool name when no input", () => {
		expect(archiveBasename("Glob", undefined)).toBe("Glob-output.txt");
	});

	it("caps basename length to avoid URL bloat", () => {
		const longCmd = "a".repeat(200);
		const name = archiveBasename("Bash", { command: longCmd });
		expect(name.length).toBeLessThan(60);
	});
});
