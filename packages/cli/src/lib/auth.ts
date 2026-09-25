// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

type AuthData = {
  token: string;
};

const AUTH_DIR = join(homedir(), ".ANCIENT");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export function getAuth(): AuthData | null {
  try {
    const data = readFileSync(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(data) as Partial<AuthData>;
    return typeof parsed.token === "string" && parsed.token.length > 0 ? { token: parsed.token } : null;
  } catch {
    return null;
  }
}

/**
 * Persist the interactive login token without ever rewriting the existing
 * credential file in place. On POSIX filesystems rename() atomically replaces
 * the destination; Windows requires a narrow unlink+rename fallback because
 * rename() cannot replace an existing file there.
 */
export function saveAuth(data: AuthData) {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(AUTH_DIR, 0o700);
  } catch {
    // chmod is best-effort on platforms whose ACL model ignores POSIX modes.
  }

  const tempFile = join(AUTH_DIR, `.auth-${process.pid}-${randomUUID()}.tmp`);
  let fd: number | undefined;

  try {
    fd = openSync(tempFile, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(data), { encoding: "utf8" });
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    try {
      renameSync(tempFile, AUTH_FILE);
    } catch (error) {
      if (process.platform !== "win32" || !existsSync(AUTH_FILE)) throw error;
      unlinkSync(AUTH_FILE);
      renameSync(tempFile, AUTH_FILE);
    }

    try {
      chmodSync(AUTH_FILE, 0o600);
    } catch {
      // Best-effort on Windows/restricted filesystems.
    }
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The descriptor is only a cleanup path.
      }
    }
    try {
      unlinkSync(tempFile);
    } catch {
      // The rename path already consumed the temp file.
    }
  }
}

export function clearAuth() {
  try {
    unlinkSync(AUTH_FILE);
  } catch {
    // File doesn't exist.
  }
}
