// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Buffer } from "node:buffer";

type CryptoIv = Uint8Array<ArrayBuffer>;

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

let masterKeyPromise: Promise<CryptoKey> | null = null;

async function getMasterKey(): Promise<CryptoKey> {
    if (masterKeyPromise) return masterKeyPromise;
    masterKeyPromise = (async () => {
        const raw = Buffer.from(getRequiredEnv("ANCIENT_CONNECTION_KEY_SECRET"), "base64");
        if (raw.byteLength !== 32) {
            throw new Error("ANCIENT_CONNECTION_KEY_SECRET must be a base64-encoded 32-byte key");
        }
        return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    })();
    return masterKeyPromise;
}

export async function encryptApiKey(plaintext: string): Promise<Uint8Array<ArrayBuffer>> {
    const key = await getMasterKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)) as CryptoIv;
    const encoder = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(plaintext)
    );
    const bytes = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    bytes.set(iv, 0);
    bytes.set(new Uint8Array(ciphertext), iv.byteLength);
    return bytes;
}

export async function decryptApiKey(stored: Uint8Array | Buffer): Promise<string> {
    const key = await getMasterKey();
    const bytes = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
    const iv = bytes.subarray(0, 12) as CryptoIv;
    const ciphertext = bytes.subarray(12) as Uint8Array<ArrayBuffer>;
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
    );
    return new TextDecoder().decode(plaintext);
}