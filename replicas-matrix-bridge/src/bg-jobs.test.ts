import { describe, expect, it } from "vitest";
import { bgJobFromCommand, bgJobLabel, extractBgJobs } from "./bg-jobs";

describe("bgJobLabel", () => {
	it("uses first 2 tokens of command + pid", () => {
		expect(bgJobLabel("bun run build", 1234)).toBe("bun run (pid 1234)");
		expect(bgJobLabel("npm test", 99)).toBe("npm test (pid 99)");
	});
	it("strips nohup / env / time / sudo prefixes", () => {
		expect(bgJobLabel("nohup bun build", 1234)).toBe("bun build (pid 1234)");
		expect(bgJobLabel("DEBUG=1 node server.js", 555)).toBe("node server.js (pid 555)");
		expect(bgJobLabel("sudo bun run dev", 7)).toBe("bun run (pid 7)");
	});
	it("falls back to pid when command is missing", () => {
		expect(bgJobLabel(undefined, 42)).toBe("pid 42");
		expect(bgJobLabel("", 42)).toBe("pid 42");
	});
});

describe("bgJobFromCommand", () => {
	it("detects trailing &", () => {
		expect(bgJobFromCommand("Bash", { command: "node srv.js &" })).toContain("node srv.js");
	});
	it("rejects && (logical AND)", () => {
		expect(bgJobFromCommand("Bash", { command: "npm test && npm build" })).toBeNull();
	});
	it("detects nohup", () => {
		expect(bgJobFromCommand("Bash", { command: "nohup bun build" })).toContain("bun build");
	});
	it("detects run_in_background flag", () => {
		expect(
			bgJobFromCommand("Bash", { command: "node srv.js", run_in_background: true }),
		).toContain("node srv.js");
	});
	it("returns null for non-Bash tools", () => {
		expect(bgJobFromCommand("Read", { command: "foo &" })).toBeNull();
	});
	it("returns null for normal foreground commands", () => {
		expect(bgJobFromCommand("Bash", { command: "ls -la" })).toBeNull();
	});
});

describe("extractBgJobs", () => {
	it("matches `[N] pid` shell job notifications", () => {
		const labels = extractBgJobs("[1] 12345\nstarted task", "bun build");
		expect(labels.length).toBeGreaterThanOrEqual(1);
		expect(labels[0]).toContain("12345");
	});
	it("matches agent-emitted 'started ... pid N'", () => {
		const labels = extractBgJobs(
			"Started background process pid 9876",
			"node server.js",
		);
		expect(labels.some((l) => l.includes("9876"))).toBe(true);
	});
	it("dedupes the same pid", () => {
		const labels = extractBgJobs("[1] 555\n[1] 555\nstarted 555", "x");
		const fives = labels.filter((l) => l.includes("555"));
		expect(fives.length).toBe(1);
	});
	it("caps at 8 hits per result", () => {
		let raw = "";
		for (let i = 1; i <= 20; i++) raw += `[${i}] ${1000 + i}\n`;
		const labels = extractBgJobs(raw, "cmd");
		expect(labels.length).toBeLessThanOrEqual(8);
	});
	it("returns [] for normal-looking output with no bg markers", () => {
		expect(extractBgJobs("Hello world\nfoo bar baz", "echo")).toEqual([]);
	});
});
