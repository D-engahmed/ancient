import { describe, expect, it, afterEach } from "bun:test";
import {
    BUILTIN_PROVIDER_TO_CONN_PROTOCOL,
    PLATFORM_DEFAULT_MODEL_ID_ENV,
    platformDefaultSelection,
    preferUserByok,
    type UserByokConnection,
} from "./credential-policy";
import { DEFAULT_CHAT_MODEL_ID } from "@ANCIENT/shared";

function conn(partial: Partial<UserByokConnection>): UserByokConnection {
    return {
        id: "00000000-0000-0000-0000-000000000000",
        protocol: "openai",
        modelId: "gpt-4o",
        baseUrl: "https://api.openai.com/v1",
        isValid: true,
        ...partial,
    };
}

afterEach(() => {
    delete process.env[PLATFORM_DEFAULT_MODEL_ID_ENV];
});

describe("platformDefaultSelection", () => {
    it("returns the builtin default model when no override is set", () => {
        expect(platformDefaultSelection()).toEqual({
            modelKind: "builtin",
            modelId: DEFAULT_CHAT_MODEL_ID,
        });
    });

    it("honors an explicit override argument", () => {
        expect(platformDefaultSelection("claude-sonnet-5")).toEqual({
            modelKind: "builtin",
            modelId: "claude-sonnet-5",
        });
    });

    it("honors the ANCIENT_DEFAULT_MODEL_ID env override", () => {
        process.env[PLATFORM_DEFAULT_MODEL_ID_ENV] = "gemini-2.5-flash";
        expect(platformDefaultSelection()).toEqual({
            modelKind: "builtin",
            modelId: "gemini-2.5-flash",
        });
    });

    it("falls back to the builtin default for an unknown override id", () => {
        process.env[PLATFORM_DEFAULT_MODEL_ID_ENV] = "acme-999";
        expect(platformDefaultSelection()).toEqual({
            modelKind: "builtin",
            modelId: DEFAULT_CHAT_MODEL_ID,
        });
    });
});

describe("preferUserByok", () => {
    it("leaves an explicit custom selection untouched", () => {
        const selection = { modelKind: "custom", connectionId: "some-id" } as const;
        expect(preferUserByok(selection, [conn({})])).toBe(selection);
    });

    it("swaps a builtin openai model to the user's valid openai BYOK connection", () => {
        const result = preferUserByok(
            { modelKind: "builtin", modelId: "gpt-4o" },
            [conn({ protocol: "anthropic" }), conn({ id: "openai-conn", protocol: "openai" })],
        );
        expect(result).toEqual({ modelKind: "custom", connectionId: "openai-conn" });
    });

    it("maps a builtin google model to a gemini-protocol connection", () => {
        const result = preferUserByok(
            { modelKind: "builtin", modelId: "gemini-2.5-flash" },
            [conn({ id: "gem-conn", protocol: "gemini" })],
        );
        expect(result).toEqual({ modelKind: "custom", connectionId: "gem-conn" });
    });

    it("never swaps to a different provider brand (deepseek/mistral/groq/together have no BYOK protocol)", () => {
        const selection = { modelKind: "builtin", modelId: "gpt-4o" } as const;
        const result = preferUserByok(selection, [conn({ protocol: "openai", isValid: false }), conn({ protocol: "gemini" })]);
        expect(result).toEqual(selection);
    });

    it("ignores invalid/unvalidated connections", () => {
        const selection = { modelKind: "builtin", modelId: "gpt-4o" } as const;
        const result = preferUserByok(selection, [conn({ protocol: "openai", isValid: false })]);
        expect(result).toEqual(selection);
    });

    it("keeps the platform default when the user has no matching connection", () => {
        const selection = { modelKind: "builtin", modelId: "claude-sonnet-5" } as const;
        expect(preferUserByok(selection, [conn({ protocol: "openai" })])).toEqual(selection);
    });

    it("keeps the platform default for builtin providers without a BYOK brand (deepseek)", () => {
        const selection = { modelKind: "builtin", modelId: "deepseek-v4" } as const;
        expect(preferUserByok(selection, [conn({ protocol: "anthropic" }), conn({ protocol: "openai" })])).toEqual(selection);
    });
});