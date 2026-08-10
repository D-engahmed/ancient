// Destination: packages/server/src/lib/token-budget.ts
//
// Rough token accounting — chars/4 is close enough for budgeting purposes,
// no tokenizer dependency needed. Used to keep both the project map and
// large file reads from silently blowing up the context window (input
// tokens), and to give project-map a consistent set of dirs to skip.

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateToTokenBudget(
    text: string,
    maxTokens: number,
    noteSuffix = "\n...[truncated]"
): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - noteSuffix.length) + noteSuffix;
}

/**
 * Caps a file's content before it goes back to the model. Large files
 * (generated code, lockfiles, seed data, big schema files) otherwise burn
 * huge input-token budget for tasks that only needed the top of the file.
 */
export function truncateFileContent(
    content: string,
    filePath: string,
    maxTokens = 1500
): string {
    const estimated = estimateTokens(content);
    if (estimated <= maxTokens) return content;

    const totalLines = content.split("\n").length;
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    const truncated = content.slice(0, maxChars);
    const shownLines = truncated.split("\n").length;

    return (
        `${truncated}\n\n[${filePath} truncated: showing ~${shownLines} of ${totalLines} lines ` +
        `(~${estimated} tokens total). Ask to read a specific line range if you need more.]`
    );
}

/** Dirs that are never worth putting in a project map or walking into. */
export const NOISE_DIRS = new Set([
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    ".cache",
    ".git",
]);