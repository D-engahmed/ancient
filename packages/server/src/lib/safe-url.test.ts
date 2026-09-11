import { describe, expect, it } from "bun:test";
import { assertSafeBaseUrl } from "./safe-url";

describe("assertSafeBaseUrl", () => {
    it("accepts a public https endpoint", async () => {
        await expect(assertSafeBaseUrl("https://api.openai.com/v1")).resolves.toBeUndefined();
    });

    it("accepts a public http endpoint", async () => {
        await expect(assertSafeBaseUrl("http://example.com/v1")).resolves.toBeUndefined();
    });

    it("rejects non-http(s) schemes", async () => {
        await expect(assertSafeBaseUrl("file:///etc/passwd")).rejects.toThrow("must be http(s)");
        await expect(assertSafeBaseUrl("gopher://internal/")).rejects.toThrow("must be http(s)");
    });

    it("allows explicit loopback for local model servers", async () => {
        await expect(assertSafeBaseUrl("http://localhost:11434/v1")).resolves.toBeUndefined();
        await expect(assertSafeBaseUrl("http://127.0.0.1:1234/v1")).resolves.toBeUndefined();
        await expect(assertSafeBaseUrl("http://[::1]:8080/v1")).resolves.toBeUndefined();
    });

    it("rejects known metadata and internal-suffixed hosts", async () => {
        await expect(assertSafeBaseUrl("http://metadata.google.internal/")).rejects.toThrow("disallowed");
        await expect(assertSafeBaseUrl("http://router.local/")).rejects.toThrow("disallowed internal host");
        await expect(assertSafeBaseUrl("http://db.internal/")).rejects.toThrow("disallowed internal host");
    });

    it("rejects private IPv4 literals", async () => {
        await expect(assertSafeBaseUrl("http://10.0.0.1:8000/v1")).rejects.toThrow("private or link-local");
        await expect(assertSafeBaseUrl("http://192.168.1.10:8000/v1")).rejects.toThrow("private or link-local");
        await expect(assertSafeBaseUrl("http://172.16.0.9:8000/v1")).rejects.toThrow("private or link-local");
    });

    it("rejects the cloud metadata address", async () => {
        await expect(assertSafeBaseUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/disallowed|private/);
    });

    it("rejects IPv6 loopback, ULA, and link-local literals", async () => {
        await expect(assertSafeBaseUrl("http://[::1]:8080")) // handled in loopback; keep contract
            .resolves.toBeUndefined();
        await expect(assertSafeBaseUrl("http://[fc00::1]:8080/v1")).rejects.toThrow("private or link-local");
        await expect(assertSafeBaseUrl("http://[fd12:3456::1]:8080/v1")).rejects.toThrow("private or link-local");
        await expect(assertSafeBaseUrl("http://[fe80::1]:8080/v1")).rejects.toThrow("private or link-local");
    });

    it("rejects IPv4-mapped IPv6 addresses that map to private IPv4", async () => {
        await expect(assertSafeBaseUrl("http://[::ffff:127.0.0.1]:8080/v1")).rejects.toThrow("private or link-local");
        await expect(assertSafeBaseUrl("http://[::ffff:10.0.0.5]:8080/v1")).rejects.toThrow("private or link-local");
        await expect(assertSafeBaseUrl("http://[::ffff:7f00:1]:8080/v1")).rejects.toThrow("private or link-local");
    });

    it("rejects a hostname that only resolves privately (DNS re-check)", async () => {
        await expect(assertSafeBaseUrl("http://private.example.internal-test/")).rejects.toThrow();
    });
});