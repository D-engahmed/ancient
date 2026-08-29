// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Provider connection model + BYOK key cipher.
//
// This module owns the *concept* of a provider connection (the BYOK shape:
// encrypted runtime key + base URL + model + protocol) and the encryption
// primitive used to store keys at rest. It is deliberately free of any
// specific database or AI-SDK dependency so the encryption and the connection
// contract stay testable and reusable across every layer that touches a
// provider (the engine's model runtime, the gateway's BYOK endpoints, the
// strategies' per-agent routing, ...).
//
// The concrete wiring to a Prisma row and to a resolved LanguageModel lives in
// a later integration (storage/DB), which implements the interfaces defined
// here rather than importing this module's internals.

import { Buffer } from "node:buffer";

/** Wiring/shape of a saved provider connection (BYOK). */
export type ProviderConnection = {
    id: string;
    provider: string;
    protocol: "openai" | "anthropic" | "gemini";
    baseUrl: string;
    modelId: string;
    /** Encrypted runtime API key, stored at rest. */
    encryptedKey: Uint8Array;
    isValid: boolean;
};

const IV_LENGTH = 12; // AES-GCM 96-bit nonce

/**
 * Encrypt/decrypt provider keys with AES-256-GCM using a caller-supplied
 * master key secret (base64-encoded 32 bytes). Injectable so callers control
 * where the secret comes from (env var, vault, ...) and so the cipher is
 * fully unit-testable without reading process.env.
 */
export class ProviderKeyCipher {
    private readonly masterKeyPromise: Promise<CryptoKey>;

    constructor(private readonly keySecretB64: string) {
        if (typeof keySecretB64 !== "string" || keySecretB64.length === 0) {
            throw new Error("ProviderKeyCipher requires a key secret");
        }
        const raw = Buffer.from(keySecretB64, "base64");
        if (raw.byteLength !== 32) {
            throw new Error("ProviderKeyCipher key secret must be a base64-encoded 32-byte key");
        }
        this.masterKeyPromise = this.importMasterKey();
    }

    private async importMasterKey(): Promise<CryptoKey> {
        const raw = Buffer.from(this.keySecretB64, "base64");
        return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    }

    async encrypt(plaintext: string): Promise<Uint8Array> {
        const key = await this.masterKeyPromise;
        const encoder = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            encoder.encode(plaintext),
        );
        const bytes = new Uint8Array(iv.byteLength + ciphertext.byteLength);
        bytes.set(iv, 0);
        bytes.set(new Uint8Array(ciphertext), iv.byteLength);
        return bytes;
    }

    async decrypt(stored: Uint8Array | Buffer): Promise<string> {
        const key = await this.masterKeyPromise;
        const bytes = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
        const iv = bytes.subarray(0, IV_LENGTH);
        const ciphertext = bytes.subarray(IV_LENGTH);
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
        return new TextDecoder().decode(plaintext);
    }
}

/** Create a ProviderKeyCipher from the standard ANCIENT env secret. */
export function cipherFromEnv(): ProviderKeyCipher {
    const secret = process.env.ANCIENT_CONNECTION_KEY_SECRET;
    if (!secret) {
        throw new Error("ANCIENT_CONNECTION_KEY_SECRET is required");
    }
    return new ProviderKeyCipher(secret);
}
