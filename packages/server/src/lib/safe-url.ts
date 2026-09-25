// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// SSRF guard for user-supplied provider endpoints (BYOK).
//
// SECURITY MODEL:
//   - Remote SaaS BYOK endpoints must never target loopback/private/link-local
//     destinations.
//   - Local model servers are allowed only when the deployment operator
//     explicitly enables ANCIENT_ALLOW_LOCAL_PROVIDER_ENDPOINTS=true.
//   - DNS answers are checked before the request is made. Callers must still
//     enforce redirect validation at the HTTP client boundary.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "169.254.169.254",
]);

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isPrivateOrLinkLocalIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const a = Number(parts[0] ?? NaN);
  const b = Number(parts[1] ?? NaN);
  if (![a, b].every(Number.isFinite)) return false;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function ipv4MappedToIpv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase();
  if (!lower.startsWith("::ffff:")) return null;
  const embedded = lower.slice("::ffff:".length);
  if (embedded.includes(".")) return embedded;
  const groups = embedded.split(":");
  if (groups.length !== 2) return null;
  const hi = Number.parseInt(groups[0]!, 16);
  const lo = Number.parseInt(groups[1]!, 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

function isDisallowedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateOrLinkLocalIpv4(ip);
  if (kind !== 6) return false;

  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  const mapped = ipv4MappedToIpv4(lower);
  return mapped ? isPrivateOrLinkLocalIpv4(mapped) : false;
}

function localEndpointsEnabled(): boolean {
  return process.env.ANCIENT_ALLOW_LOCAL_PROVIDER_ENDPOINTS === "true";
}

function assertLocalEndpointAllowed(hostname: string): void {
  if (localEndpointsEnabled()) return;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && isPrivateOrLinkLocalIpv4(hostname)) ||
    isDisallowedIp(hostname)
  ) {
    throw new Error(
      "baseUrl targets a local/private address; enable ANCIENT_ALLOW_LOCAL_PROVIDER_ENDPOINTS only for a trusted self-hosted deployment",
    );
  }
}

export async function assertSafeBaseUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("baseUrl must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("baseUrl must be http(s)");
  }
  if (url.username || url.password) {
    throw new Error("baseUrl must not contain embedded credentials");
  }

  const hostname = normalizeHostname(url.hostname.toLowerCase());
  if (!hostname) throw new Error("baseUrl must include a hostname");

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("baseUrl points at a disallowed internal host");
  }

  if (isIP(hostname)) {
    if (isDisallowedIp(hostname)) assertLocalEndpointAllowed(hostname);
    return;
  }

  if (hostname === "localhost") {
    assertLocalEndpointAllowed(hostname);
    return;
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) throw new Error("hostname returned no addresses");
    for (const addr of addresses) {
      if (isDisallowedIp(addr.address)) {
        throw new Error(`baseUrl resolves to a private, loopback, or link-local address (${addr.address})`);
      }
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("failed to resolve hostname; refusing to verify an unsafe endpoint");
  }
}
