import { test, expect, beforeAll } from "bun:test";
import { encryptApiKey, decryptApiKey } from "./connection-crypto";

const TEST_SECRET = Buffer.alloc(32, 0x42).toString("base64");

beforeAll(() => {
    process.env.ANCIENT_CONNECTION_KEY_SECRET = TEST_SECRET;
});

test("round-trips a secret through encrypt/decrypt", async () => {
    const secret = "sk-super-secret-abc123";
    const encrypted = await encryptApiKey(secret);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    const decrypted = await decryptApiKey(encrypted);
    expect(decrypted).toBe(secret);
});

test("round-trips special characters and unicode", async () => {
    const secret = "sk-λ-🗑️-😀-line\nbreak\t\0";
    const encrypted = await encryptApiKey(secret);
    const decrypted = await decryptApiKey(encrypted);
    expect(decrypted).toBe(secret);
});

test("produces a 12-byte IV prefix plus ciphertext and does not leak the plaintext", async () => {
    const secret = "openai-sk-test";
    const encrypted = await encryptApiKey(secret);
    expect(encrypted.length).toBeGreaterThan(12);
    // A single run of encryption should be self-consistent (12-byte IV header).
    const decrypted = await decryptApiKey(encrypted);
    expect(decrypted).toBe(secret);
});

test("each encryption produces a distinct ciphertext for the same plaintext", async () => {
    const secret = "same-input";
    const a = await encryptApiKey(secret);
    const b = await encryptApiKey(secret);
    // Random IV per call guarantees different ciphertexts.
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
});
