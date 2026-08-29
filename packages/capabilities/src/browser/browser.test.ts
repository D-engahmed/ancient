// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Browser capability tests (capabilities/browser). 12 tests against a local
// HTTP server — no real-network dependence.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { createServer, type Server } from "node:http";

import { CapabilityRegistry, executeTool } from "../core";
import { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { ExecutionScope } from "../core/types";
import { fetchUrl, htmlToText } from "./fetch";
import { browserCapability, fetchUrlTool } from "./tools";

let server: Server;
let base: string;
const scope: ExecutionScope = { cwd: process.cwd() };
const policy = new ApprovalPolicy();
const netPolicy = new ApprovalPolicy().allow("network");

beforeAll(async () => {
    server = createServer((req, res) => {
        const url = req.url ?? "/";
        if (url === "/hello") {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("hello world");
            return;
        }
        if (url === "/page") {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(
                "<html><head><style>body{color:red}</style><script>alert('x')</script></head>" +
                    "<body><h1>Title &amp; More</h1><p>Hello <b>bold</b> text</p></body></html>",
            );
            return;
        }
        if (url === "/slow") {
            setTimeout(() => {
                res.writeHead(200, { "content-type": "text/plain" });
                res.end("too late");
            }, 400);
            return;
        }
        if (url === "/missing") {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("nope");
            return;
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("fallback");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("htmlToText", () => {
    it("strips scripts/styles/comments/tags and decodes entities", () => {
        const out = htmlToText("<html><script>var x</script><style>a{}</style><!-- c --><p>a &amp; b <b>c</b></p></html>");
        expect(out).toBe("a & b c");
    });
});

describe("fetchUrl", () => {
    it("fetches plain text", async () => {
        const out = await fetchUrl(`${base}/hello`);
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.result.status).toBe(200);
            expect(out.result.text).toBe("hello world");
        }
    });

    it("extracts text from HTML", async () => {
        const out = await fetchUrl(`${base}/page`);
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.result.text).toContain("Title & More");
            expect(out.result.text).toContain("Hello bold text");
            expect(out.result.text).not.toContain("<script>");
            expect(out.result.text).not.toContain("cred");
        }
    });

    it("rejects non-http(s) protocols", async () => {
        const out = await fetchUrl("ftp://example.com/x");
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.error).toContain("unsupported protocol");
    });

    it("times out on a slow server", async () => {
        const out = await fetchUrl(`${base}/slow`, { timeoutMs: 50 });
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.error).toContain("timed out");
    }, 5000);

    it("surfaces non-200 status without throwing", async () => {
        const out = await fetchUrl(`${base}/missing`);
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.result.status).toBe(404);
    });

    it("respects maxChars", async () => {
        const out = await fetchUrl(`${base}/hello`, { maxChars: 5 });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.result.text).toBe("hello");
    });
});

describe("fetchUrlTool through the central edge", () => {
    it("is denied under the default policy (network deny)", async () => {
        const res = await executeTool(fetchUrlTool, scope, { url: `${base}/hello` }, { policy });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("denied");
    });

    it("fetches when network is allowed", async () => {
        const res = await executeTool(fetchUrlTool, scope, { url: `${base}/hello` }, { policy: netPolicy });
        expect(res.ok).toBe(true);
        expect(JSON.parse(res.output).text).toBe("hello world");
    });

    it("validates args (url required)", async () => {
        const res = await executeTool(fetchUrlTool, scope, {}, { policy: netPolicy });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("invalid arguments");
    });
});

describe("browserCapability wired into the registry", () => {
    it("registers fetchUrl as network-only", () => {
        const registry = new CapabilityRegistry().registerAll(browserCapability());
        expect(registry.listNames()).toEqual(["fetchUrl"]);
        expect(registry.get("fetchUrl")?.category).toBe("network");
        expect(registry.listFor("PLAN").map((t) => t.name)).not.toContain("fetchUrl");
        expect(registry.listFor("BUILD").map((t) => t.name)).toContain("fetchUrl");
    });

    it("exposes the URL as the approval target", () => {
        expect(fetchUrlTool.target?.({ url: "https://example.com" })).toBe("https://example.com");
    });
});