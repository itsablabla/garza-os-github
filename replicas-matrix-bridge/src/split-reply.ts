// Reply splitter — divides a long markdown reply into multiple
// sequential chat-style messages on natural boundaries (paragraphs,
// headings, code blocks, lists). Matches the OpenACP pattern: a long
// turn from the agent renders as several short messages the user can
// scan one at a time, instead of one wall-of-text that pushes the
// rest of the conversation off-screen.
//
// Rules:
//   - Fenced code blocks are NEVER split (each ``` ... ``` stays in one
//     message — splitting it would break syntax highlighting).
//   - Blank lines are the primary boundary. We greedy-pack atomic
//     blocks into messages until the next block would exceed the
//     per-message char cap.
//   - A lone heading line "attaches" to the following block so a header
//     doesn't ship alone in a trailing message.
//   - A single block larger than the cap (an oversize code block) ships
//     alone as one big message; we don't try to subdivide it.

export interface SplitOptions {
	/** Per-message char cap. Default 3000 — short enough to feel chat-y, long
	 *  enough that single paragraphs rarely need to split. Both Matrix and
	 *  Telegram comfortably handle 3KB per send. */
	maxChars?: number;
	/** Minimum chunk size before considering it complete. Used to merge tiny
	 *  fragments together. Default 80. */
	minChars?: number;
}

/**
 * Split a markdown reply into one or more chunks suitable for sequential
 * chat sends. Returns an array of markdown strings. Each chunk is its
 * own complete markdown document — code fences are balanced, headings
 * stay with their content, lists aren't split mid-item.
 *
 * Input <= maxChars returns a single-element array; nothing is split
 * unless it actually exceeds the cap.
 */
export function splitMarkdownReply(md: string, opts: SplitOptions = {}): string[] {
	const maxChars = opts.maxChars ?? 3000;
	const minChars = opts.minChars ?? 80;
	const trimmed = md.trim();
	if (!trimmed) return [];
	if (trimmed.length <= maxChars) return [trimmed];

	// Tokenize into atomic blocks. A block is either:
	//   - A fenced code block (multi-line, never split).
	//   - A paragraph (text between blank lines).
	//   - A list (consecutive `-`/`*`/`1.` lines, kept together).
	const blocks = tokenizeBlocks(trimmed);

	// Greedy pack into chunks. A "pending heading" sticks to the next
	// block so a header never ships alone in a trailing message.
	const chunks: string[] = [];
	let current = "";
	let pendingHeading: string | null = null;

	const flush = () => {
		const out = current.trim();
		if (out) chunks.push(out);
		current = "";
	};

	for (const block of blocks) {
		// Heading: defer until next block.
		if (isHeadingOnly(block)) {
			if (pendingHeading) {
				// Two headings back-to-back: ship the prior with current.
				if (current.length + pendingHeading.length + 2 > maxChars) flush();
				current = appendBlock(current, pendingHeading);
			}
			pendingHeading = block;
			continue;
		}

		// Merge the pending heading into this block so they ship together.
		const combined = pendingHeading
			? `${pendingHeading}\n\n${block}`
			: block;
		pendingHeading = null;

		// If this combined block alone exceeds the cap, flush whatever is in
		// current and ship the oversize block as its own chunk. Don't try to
		// subdivide — code blocks must stay intact, and oversized prose is
		// rare enough that one big message is acceptable.
		if (combined.length > maxChars) {
			flush();
			chunks.push(combined.trim());
			continue;
		}

		// Try to append to current chunk.
		const sep = current ? "\n\n" : "";
		if (current.length + sep.length + combined.length > maxChars) {
			// Flush only if current has meaningful content. Avoids spilling a
			// tiny scrap into the next chunk when the just-finished one is
			// already at the cap.
			if (current.length >= minChars) flush();
		}
		current = appendBlock(current, combined);
	}

	// Anything left over.
	if (pendingHeading) {
		current = appendBlock(current, pendingHeading);
	}
	flush();
	return chunks;
}

/**
 * Slice the input into atomic blocks. The blocks themselves contain no
 * leading/trailing blank lines; the packer re-inserts `\n\n` between
 * them. Fenced code blocks remain a single block even when they
 * contain blank lines internally.
 */
function tokenizeBlocks(md: string): string[] {
	const lines = md.split("\n");
	const blocks: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;

		// Skip leading blank lines between blocks.
		if (line.trim() === "") {
			i++;
			continue;
		}

		// Fenced code block — stays atomic.
		const fenceMatch = /^(\s*)(```+|~~~+)/.exec(line);
		if (fenceMatch) {
			const fenceMark = fenceMatch[2]!;
			const block: string[] = [line];
			i++;
			while (i < lines.length) {
				block.push(lines[i]!);
				if (lines[i]!.trim().startsWith(fenceMark)) {
					i++;
					break;
				}
				i++;
			}
			blocks.push(block.join("\n"));
			continue;
		}

		// List run — keep consecutive list items together so a bulleted
		// list doesn't get split across messages.
		if (isListItem(line)) {
			const block: string[] = [];
			while (i < lines.length && (lines[i]!.trim() === "" || isListItem(lines[i]!) || isListContinuation(lines[i]!))) {
				if (lines[i]!.trim() === "") {
					// Blank inside list — check if next line is also a list item.
					if (i + 1 < lines.length && (isListItem(lines[i + 1]!) || isListContinuation(lines[i + 1]!))) {
						block.push(lines[i]!);
						i++;
						continue;
					}
					break;
				}
				block.push(lines[i]!);
				i++;
			}
			blocks.push(block.join("\n").trim());
			continue;
		}

		// Paragraph — accumulate until a blank line or list/fence boundary.
		const block: string[] = [];
		while (i < lines.length && lines[i]!.trim() !== "" && !/^(\s*)(```+|~~~+)/.test(lines[i]!) && !isListItem(lines[i]!)) {
			block.push(lines[i]!);
			i++;
		}
		blocks.push(block.join("\n"));
	}
	return blocks;
}

function isListItem(line: string): boolean {
	return /^\s*([-*+]|\d+\.)\s+/.test(line);
}

function isListContinuation(line: string): boolean {
	// Indented continuation of a list item (typically 2+ spaces).
	return /^\s{2,}\S/.test(line);
}

function isHeadingOnly(block: string): boolean {
	const trimmed = block.trim();
	if (!trimmed.startsWith("#")) return false;
	// Single-line ATX heading.
	return !trimmed.includes("\n");
}

function appendBlock(current: string, block: string): string {
	if (!current) return block;
	return `${current}\n\n${block}`;
}
