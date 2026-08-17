// file: packages/server/src/checkpoints/store.ts
// Checkpoints & rewind — the Claude Code "checkpoint / Esc-Esc" equivalent.
//
// Implementation: a per-workspace SHADOW git repository. The repo lives at
// ~/.ancient/checkpoints/<hash>/repo (GIT_DIR) with the project directory as
// its working tree. Your project never gets a .git it didn't ask for, and a
// project that IS a git repo is unaffected — the two never touch.
//
// A checkpoint is created automatically before every BUILD-mode turn, so any
// turn can be rewound: files are restored to the snapshot, conversation
// messages after the checkpoint are deleted.

import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { createLogger } from "@ANCIENT/shared";

const execFileAsync = promisify(execFile);
const log = createLogger("checkpoints");

export type Checkpoint = {
    id: string;            // commit sha (short)
    sessionId: string;
    label: string;         // first chars of the triggering prompt
    createdAt: string;     // ISO
};

type CheckpointMeta = { checkpoints: Checkpoint[] };

function workspaceKey(cwd: string): string {
    return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

function shadowDir(cwd: string): string {
    return join(homedir(), ".ancient", "checkpoints", workspaceKey(cwd));
}

function metaPath(cwd: string): string {
    return join(shadowDir(cwd), "meta.json");
}

async function git(cwd: string, args: string[]): Promise<string> {
    const dir = shadowDir(cwd);
    const { stdout } = await execFileAsync(
        "git",
        ["--git-dir", join(dir, "repo"), "--work-tree", cwd, ...args],
        { maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout.trim();
}

async function ensureShadowRepo(cwd: string): Promise<boolean> {
    const dir = shadowDir(cwd);
    await mkdir(dir, { recursive: true });
    if (existsSync(join(dir, "repo"))) return true;

    try {
        await mkdir(join(dir, "repo"), { recursive: true });
        await execFileAsync("git", ["--git-dir", join(dir, "repo"), "init", "-q", "--bare"]);
        // Exclude nothing by default, but never track the user's own .git.
        await writeFile(join(dir, "repo", "info", "exclude"), ".git\n.ancient/checkpoints\n", { flag: "a" }).catch(() => {});
        await git(cwd, ["config", "user.email", "ancient@localhost"]);
        await git(cwd, ["config", "user.name", "ANCIENT Checkpoints"]);
        return true;
    } catch (err) {
        log.warn("git unavailable — checkpoints disabled", { error: err instanceof Error ? err.message : String(err) });
        return false;
    }
}

async function readMeta(cwd: string): Promise<CheckpointMeta> {
    try {
        return JSON.parse(await readFile(metaPath(cwd), "utf-8"));
    } catch {
        return { checkpoints: [] };
    }
}

async function writeMeta(cwd: string, meta: CheckpointMeta): Promise<void> {
    await mkdir(shadowDir(cwd), { recursive: true });
    await writeFile(metaPath(cwd), JSON.stringify(meta, null, 2));
}

/**
 * Snapshots the workspace. Returns the checkpoint, or null when nothing
 * changed since the last one (no noise checkpoints) or git is unavailable.
 */
export async function createCheckpoint(cwd: string, sessionId: string, label: string): Promise<Checkpoint | null> {
    if (!(await ensureShadowRepo(cwd))) return null;

    try {
        await git(cwd, ["add", "-A"]);
        const status = await git(cwd, ["status", "--porcelain"]);
        if (!status) return null; // nothing to snapshot

        await git(cwd, ["commit", "-q", "-m", label.slice(0, 120) || "checkpoint", "--no-verify"]);
        const sha = await git(cwd, ["rev-parse", "--short", "HEAD"]);

        const checkpoint: Checkpoint = {
            id: sha,
            sessionId,
            label: label.slice(0, 80),
            createdAt: new Date().toISOString(),
        };
        const meta = await readMeta(cwd);
        meta.checkpoints.push(checkpoint);
        // Keep the history bounded — 100 checkpoints per workspace.
        if (meta.checkpoints.length > 100) meta.checkpoints = meta.checkpoints.slice(-100);
        await writeMeta(cwd, meta);
        return checkpoint;
    } catch (err) {
        log.warn("checkpoint failed", { error: err instanceof Error ? err.message : String(err) });
        return null;
    }
}

/** Checkpoints for one session, newest first. */
export async function listCheckpoints(cwd: string, sessionId: string): Promise<Checkpoint[]> {
    const meta = await readMeta(cwd);
    return meta.checkpoints
        .filter((c) => c.sessionId === sessionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Restores the working tree to a checkpoint. Files created after the
 * checkpoint are deleted; modified files are reverted. The DB-side message
 * rewind is handled by the caller (it owns the session).
 */
export async function rewindTo(cwd: string, checkpointId: string): Promise<{ ok: boolean; error?: string }> {
    if (!(await ensureShadowRepo(cwd))) return { ok: false, error: "Checkpoints are unavailable (git not found)" };

    const meta = await readMeta(cwd);
    const target = meta.checkpoints.find((c) => c.id === checkpointId || c.id.startsWith(checkpointId));
    if (!target) return { ok: false, error: `Unknown checkpoint: ${checkpointId}` };

    try {
        // Restore tracked files to the snapshot…
        await git(cwd, ["checkout", target.id, "--", "."]);
        // …and delete files that were created after it.
        const later = meta.checkpoints.filter((c) => c.createdAt > target.createdAt);
        if (later.length > 0) {
            const newest = later.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
            const added = await git(cwd, ["diff", "--name-only", "--diff-filter=A", target.id, newest.id]);
            for (const file of added.split("\n").filter(Boolean)) {
                await git(cwd, ["rm", "-q", "-f", "--ignore-unmatch", "--", file]).catch(() => {});
                const { rm } = await import("fs/promises");
                await rm(join(cwd, file), { force: true }).catch(() => {});
            }
        }
        // Truncate meta history at the rewind point.
        meta.checkpoints = meta.checkpoints.filter((c) => c.createdAt <= target.createdAt);
        await writeMeta(cwd, meta);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
