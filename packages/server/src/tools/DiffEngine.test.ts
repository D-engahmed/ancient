import { test, expect } from "bun:test";
import { parseDiffBlocks } from "./DiffEngine";

test("parseDiffBlocks extracts a single SEARCH/REPLACE block", () => {
    const aiOutput = `Fix the typo below.

<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE
`;

    const blocks = parseDiffBlocks(aiOutput);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.search).toBe("const x = 1;");
    expect(blocks[0]!.replace).toBe("const x = 2;");
});

test("parseDiffBlocks extracts multiple blocks in order", () => {
    const aiOutput = `
<<<<<<< SEARCH
foo
=======
bar
>>>>>>> REPLACE

<<<<<<< SEARCH
baz
=======
qux
>>>>>>> REPLACE
`;

    const blocks = parseDiffBlocks(aiOutput);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.replace).toBe("bar");
    expect(blocks[1]!.search).toBe("baz");
});

test("parseDiffBlocks ignores surrounding conversational text", () => {
    const aiOutput = `I fixed the issue for you. Here is the patch:

<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE

Let me know if it works!`;

    const blocks = parseDiffBlocks(aiOutput);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.search).toBe("old");
    expect(blocks[0]!.replace).toBe("new");
});

test("parseDiffBlocks supports multi-line search/replace bodies", () => {
    const aiOutput = `<<<<<<< SEARCH
line one
line two
=======
line A
line B
>>>>>>> REPLACE`;

    const blocks = parseDiffBlocks(aiOutput);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.search).toBe("line one\nline two");
    expect(blocks[0]!.replace).toBe("line A\nline B");
});

test("parseDiffBlocks returns empty array when no blocks present", () => {
    expect(parseDiffBlocks("no diff markers here")).toHaveLength(0);
    expect(parseDiffBlocks("")).toHaveLength(0);
});
