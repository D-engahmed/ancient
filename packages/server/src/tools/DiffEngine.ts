import fs from 'node:fs/promises';
import path from 'node:path';

// ==========================================
// 1. TYPES (What our data looks like)
// ==========================================

// This represents one single edit the AI wants to make
export interface DiffBlock {
    search: string;  // The original code the AI is looking for
    replace: string; // The new code the AI wants to put there
}

// The result we return to the CLI UI
export interface ApplyResult {
    success: boolean;
    message: string;
    filePath: string;
    diffApplied?: string; // The visual diff to show the user
}

// ==========================================
// 2. THE PARSER (Extracting blocks from AI text)
// ==========================================

/**
 * WHAT: Extracts SEARCH/REPLACE blocks from the raw AI text.
 * WHY: The AI often wraps its code in markdown or adds conversational text. 
 *      We need to surgically extract only the edit instructions.
 */
export function parseDiffBlocks(aiOutput: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];

    // This Regular Expression (Regex) looks for the exact format:
    // <<<<<<< SEARCH
    // [original code]
    // =======
    // [new code]
    // >>>>>>> REPLACE
    const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

    let match;
    while ((match = regex.exec(aiOutput)) !== null) {
        blocks.push({
            search: match[1],
            replace: match[2]
        });
    }

    return blocks;
}

// ==========================================
// 3. THE FUZZY MATCHER (Handling AI mistakes)
// ==========================================

/**
 * WHAT: Calculates the "Levenshtein Distance" between two strings.
 * WHY: AI models are bad at exact whitespace. If the file has 4 spaces, 
 *      but the AI searches for 2 spaces, exact matching fails. 
 *      This algorithm finds the "closest" match to prevent expensive retries.
 */
function getLevenshteinDistance(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,       // deletion
                matrix[i][j - 1] + 1,       // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }
    return matrix[a.length][b.length];
}

/**
 * WHAT: Finds the best matching section in the actual file for the AI's search block.
 */
function findBestMatch(fileContent: string, searchBlock: string): string | null {
    // 1. Try exact match first (Fastest)
    if (fileContent.includes(searchBlock)) {
        return searchBlock;
    }

    // 2. Fuzzy match: Break file into chunks and find the closest one
    const lines = fileContent.split('\n');
    const searchLines = searchBlock.split('\n').length;

    let bestMatch = '';
    let lowestScore = Infinity;

    // Slide a window over the file
    for (let i = 0; i <= lines.length - searchLines; i++) {
        const chunk = lines.slice(i, i + searchLines).join('\n');
        const score = getLevenshteinDistance(chunk, searchBlock);

        // If the score is very low (less than 10% of the string length), it's a match
        if (score < lowestScore && score < searchBlock.length * 0.1) {
            lowestScore = score;
            bestMatch = chunk;
        }
    }

    return bestMatch || null;
}

// ==========================================
// 4. THE CORE ENGINE (Applying the edit)
// ==========================================

/**
 * WHAT: Reads a file, applies the AI's diffs, and saves it back to disk.
 */
export async function applyDiffToFile(filePath: string, aiOutput: string): Promise<ApplyResult> {
    try {
        // 1. Read the actual file from the user's computer
        const absolutePath = path.resolve(filePath);
        let fileContent = await fs.readFile(absolutePath, 'utf-8');
        const originalContent = fileContent; // Keep a backup to show diffs later

        // 2. Parse the AI's instructions
        const blocks = parseDiffBlocks(aiOutput);
        if (blocks.length === 0) {
            return { success: false, message: "AI did not provide any SEARCH/REPLACE blocks.", filePath };
        }

        // 3. Apply each block one by one
        for (const block of blocks) {
            const match = findBestMatch(fileContent, block.search);

            if (!match) {
                return {
                    success: false,
                    message: `Could not find the code to replace. The file might have changed.`,
                    filePath
                };
            }

            // Replace the matched chunk with the AI's new code
            fileContent = fileContent.replace(match, block.replace);
        }

        // 4. Save the updated file to disk
        await fs.writeFile(absolutePath, fileContent, 'utf-8');

        return {
            success: true,
            message: "Successfully applied changes!",
            filePath,
            diffApplied: `Original length: ${originalContent.length}, New length: ${fileContent.length}`
        };

    } catch (error: any) {
        return { success: false, message: `File system error: ${error.message}`, filePath };
    }
}