// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Security module tests (infrastructure/security). 12 tests.

import { describe, expect, it } from "bun:test";

import { ApprovalPolicy } from "./approval";
import { Redactor } from "./redaction";

describe("Redactor", () => {
    const redactor = new Redactor();

    it("masks an api key by value pattern", () => {
        const { text, changed } = redactor.redact("key=sk-abcdefghijklmnopqrstuvwx");
        expect(changed).toBe(true);
        expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwx");
        expect(text).toContain("sk-[REDACTED]");
    });

    it("redacts a bearer token", () => {
        const out = redactor.mask("Authorization: Bearer abc123XYZ789==");
        expect(out).not.toContain("abc123XYZ789==");
    });

    it("redacts AWS access key ids", () => {
        const out = redactor.mask("AKIAIOSFODNN7EXAMPLE");
        expect(out).toContain("[REDACTED]");
    });

    it("leaves ordinary text untouched", () => {
        const { changed, redacted } = redactor.redact("hello world, this is a normal log line");
        expect(changed).toBe(false);
        expect(redacted).toEqual([]);
    });

    it("reports the names of patterns that hit", () => {
        const { redacted } = redactor.redact("token=sk-abcdefghijklmnopqrstuvwx AND AKIAIOSFODNN7EXAMPLE");
        expect(redacted).toContain("sk");
        expect(redacted).toContain("aws");
    });
});

describe("ApprovalPolicy", () => {
    const policy = new ApprovalPolicy();

    it("allows read operations by default", () => {
        expect(policy.evaluate({ name: "readFile", category: "read", target: "/a/b.txt" }).decision)
            .toBe("allow");
    });

    it("denies exec operations by default", () => {
        expect(policy.evaluate({ name: "bash", category: "exec", target: "rm -rf /" }).decision)
            .toBe("deny");
    });

    it("requires consent for scope changes by default", () => {
        expect(policy.evaluate({ name: "setScope", category: "scope" }).decision)
            .toBe("require-consent");
    });

    it("applies an explicit allow override for a category", () => {
        const p = new ApprovalPolicy().allow("write");
        expect(p.evaluate({ name: "writeFile", category: "write", target: "/tmp/x" }).decision)
            .toBe("allow");
    });

    it("matches target patterns with glob-ish *", () => {
        const p = new ApprovalPolicy([
            { category: "exec", decision: "allow", targetPattern: "npm run *" },
        ]);
        expect(p.evaluate({ name: "bash", category: "exec", target: "npm run test" }).decision)
            .toBe("allow");
        expect(p.evaluate({ name: "bash", category: "exec", target: "rm -rf /" }).decision)
            .toBe("deny");
    });

    it("returns an explicit reason with the decision", () => {
        const r = policy.evaluate({ name: "bash", category: "exec" });
        expect(r.decision).toBe("deny");
        expect(r.reason).toContain("denies exec");
    });
});
