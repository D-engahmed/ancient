// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// SSRF guard for user-supplied provider endpoints (BYOK base URLs). A BYOK
// connection hands the gateway an arbitrary host; without this check a malicious
// user could point the platform at cloud metadata, the loopback device, or an
// RFC1918 host and have the gateway fetch it on their behalf.
//
// Defense layers (order matters):
//   1. scheme allow-list (http/https only),
//   2. literal host checks (loopback, *.local, *.internal, known metadata),
//   3. literal IP checks (IPv4 + IPv6: loopback/unspecified/link-local/ULA,
//      IPv4-mapped IPv6 re-parsed as IPv4),
//   4. DNS re-resolution of every returned address (A and AAAA) — a hostname
//      that only resolves privately is rejected BEFORE any HTTP traffic.
//
// Deliberate trade-off: loopback IS allowed (localhost/127.0.0.1/::1 pass) so
// local model servers (Ollama, LM Studio, vLLM on the gateway host) stay
// usable — the operator grants that trust by deploying the server. The check
// exists to stop remote users from using the platform as a proxy into private
// networks, not to lock the gateway off its own localhost.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
    "metadata.google.internal",
    "169.254.169.254",
]);

const LOOPBACK_HOSTNAMES = new Set(["localhost"]);

/** Strip the brackets a WHATWG URL keeps on IPv6 literal hostnames. */
function normalizeHostname(hostname: string): string {
    return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
}

function isPrivateOrLinkLocalIpv4(ip: string): boolean {
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

/** IPv6 → IPv4 for the ::ffff:x.x.x.x / ::ffff:xxxx:xxxx mapped forms. */
function ipv4MappedToIpv4(ipv6: string): string | null {
    const lower = ipv6.toLowerCase();
    if (!lower.startsWith("::ffff:")) return null;
    const embedded = lower.slice("::ffff:".length);
    const parts = embedded.split(".");
    if (parts.length === 4) return embedded; // dotted form (::ffff:127.0.0.1)
    // Hex 16-bit pairs (::ffff:7f00:1) — reassemble into dotted decimal.
    const groups = embedded.split(":");
    if (groups.length !== 2) return null;
    const hi = Number.parseInt(groups[0]!, 16);
    const lo = Number.parseInt(groups[1]!, 16);
    if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

/** True when the given address must never be a gateway fetch target. */
function isDisallowedIp(ip: string): boolean {
    const kind = isIP(ip);
    if (kind === 4) return isPrivateOrLinkLocalIpv4(ip);
    if (kind === 6) {
        const lower = ip.toLowerCase();
        if (lower === "::1" || lower === "::") return true; // loopback / unspecified
        if (lower.startsWith("fe8") || lower.startsWith("fe9")
            || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
        if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
        const mapped = ipv4MappedToIpv4(lower);
        if (mapped) return isPrivateOrLinkLocalIpv4(mapped);
    }
    return false;
}

export async function assertSafeBaseUrl(rawUrl: string): Promise<void> {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("baseUrl must be http(s)");
    }
    const hostname = normalizeHostname(url.hostname.toLowerCase());

    // Literal loopback hosts pass (operator-granted local model servers).
    if (LOOPBACK_HOSTNAMES.has(hostname) || hostname === "127.0.0.1" || hostname === "::1") {
        return;
    }
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new Error("baseUrl points at a disallowed internal host");
    }
    if (isIP(hostname) && isDisallowedIp(hostname)) {
        throw new Error("baseUrl points at a private or link-local address");
    }

    // Resolve EVERY record (A + AAAA) and reject if any lands on a private,
    // link-local, loopback, or otherwise disallowed address — a hostname that
    // also resolves publicly is still rejected, because an attacker who
    // controls resolution only needs one private answer to reach the metadata
    // service or an internal host. DNS lookup failures are a hard reject.
    try {
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        for (const addr of addresses) {
            if (isDisallowedIp(addr.address)) {
                throw new Error(`Resolved IP (${addr.address}) is private or link-local`);
            }
        }
    } catch (err) {
        if (err instanceof Error) throw err;
        throw new Error("Failed to resolve hostname - cannot verify safety");
    }
}