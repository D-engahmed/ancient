
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/lib/safe-url.ts

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
    "metadata.google.internal",
    "169.254.169.254",
]);

const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1"]);

function isPrivateOrLinkLocalIp(ip: string): boolean {
    if (ip === "169.254.169.254") return true;
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    const [aPart, bPart] = parts;
    const a = Number(aPart);
    const b = Number(bPart);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return (
        a === 127 ||
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
    );
}

export async function assertSafeBaseUrl(rawUrl: string): Promise<void> {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("baseUrl must be http(s)");
    }
    const hostname = url.hostname.toLowerCase();
    if (LOOPBACK_HOSTNAMES.has(hostname) || hostname === "127.0.0.1") {
        return;
    }
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new Error("baseUrl points at a disallowed internal host");
    }
    if (isIP(hostname) && isPrivateOrLinkLocalIp(hostname)) {
        throw new Error("baseUrl points at a private or link-local address");
    }
    // DNS rebinding protection – resolve and re‑check
    try {
        const addresses = await lookup(hostname);
        const ips = Array.isArray(addresses) ? addresses : [addresses];
        for (const addr of ips) {
            if (isPrivateOrLinkLocalIp(addr.address)) {
                throw new Error(`Resolved IP (${addr.address}) is private or link-local`);
            }
        }
    } catch {
        throw new Error("Failed to resolve hostname - cannot verify safety");
    }
}
