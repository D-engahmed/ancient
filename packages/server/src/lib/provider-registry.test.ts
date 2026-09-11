import { describe, expect, it, afterEach } from "bun:test";
import type { LanguageModel } from "ai";
import {
    ProviderRegistry,
    defaultProviderRegistry,
    createOpenAICompatiblePlugin,
    createAnthropicPlugin,
    createGooglePlugin,
    type ModelResolvingPlugin,
    type ResolvedModel,
} from "./provider-registry";

const ENV_KEYS = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "DEEPSEEK_API_KEY",
] as const;

afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    delete process.env.ANCIENT_OPENROUTER_FALLBACK_MODELS;
});

describe("ProviderRegistry", () => {
    it("registers the builtin protocols at import time", () => {
        for (const protocol of ["openai", "anthropic", "google", "gemini", "deepseek", "ollama", "custom"]) {
            expect(defaultProviderRegistry.supports(protocol)).toBe(true);
        }
        expect(defaultProviderRegistry.supports("not-a-provider")).toBe(false);
    });

    it("rejects duplicate protocol registration", () => {
        const registry = new ProviderRegistry();
        registry.register(createOpenAICompatiblePlugin());
        expect(() => registry.register(createOpenAICompatiblePlugin())).toThrow(/already registered/);
    });

    it("throws a typed error for an unregistered protocol", () => {
        const registry = new ProviderRegistry();
        registry.register(createOpenAICompatiblePlugin());
        let caught: unknown;
        try {
            registry.resolve({ protocol: "brand-new", modelId: "x", provenance: "env" });
        } catch (e) {
            caught = e;
        }
        expect((caught as { code?: string }).code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("resolves through a bespoke plugin for a brand-new provider (installation invariant)", () => {
        const registry = new ProviderRegistry();
        const stubModel = {} as unknown as LanguageModel;
        const plugin: ModelResolvingPlugin = {
            id: "acme-corp",
            label: "Acme's private model",
            protocols: ["acme"],
            credentialMode: "byok",
            resolve(input): ResolvedModel {
                return { model: stubModel, provider: "custom", modelId: input.modelId, apiKey: input.apiKey };
            },
        };
        registry.register(plugin);

        expect(registry.supports("acme")).toBe(true);
        const resolved = registry.resolve({
            protocol: "acme",
            modelId: "acme-turbo",
            baseUrl: "https://models.acme-corp.example/v1",
            apiKey: "sk-acme",
            provenance: "connection",
        });
        expect(resolved.model).toBe(stubModel);
        expect(resolved.modelId).toBe("acme-turbo");
        expect(resolved.apiKey).toBe("sk-acme");
    });
});

describe("env-key builtin resolution", () => {
    it("resolves openai from OPENAI_API_KEY", () => {
        process.env.OPENAI_API_KEY = "sk-openai";
        const resolved = defaultProviderRegistry.resolve({
            protocol: "openai",
            modelId: "gpt-4o",
            provenance: "env",
        });
        expect(resolved.provider).toBe("openai");
        expect(resolved.modelId).toBe("gpt-4o");
        expect(resolved.apiKey).toBeUndefined();
    });

    it("resolves anthropic from ANTHROPIC_API_KEY", () => {
        process.env.ANTHROPIC_API_KEY = "sk-ant";
        const resolved = defaultProviderRegistry.resolve({
            protocol: "anthropic",
            modelId: "claude-sonnet-5",
            provenance: "env",
        });
        expect(resolved.provider).toBe("anthropic");
        expect(resolved.modelId).toBe("claude-sonnet-5");
    });

    it("resolves google from GOOGLE_API_KEY", () => {
        process.env.GOOGLE_API_KEY = "sk-gem";
        const resolved = defaultProviderRegistry.resolve({
            protocol: "google",
            modelId: "gemini-2.5-flash",
            provenance: "env",
        });
        expect(resolved.provider).toBe("google");
        expect(resolved.modelId).toBe("gemini-2.5-flash");
    });

    it("throws PROVIDER_AUTH_FAILED when the env key is missing", () => {
        expect(() =>
            defaultProviderRegistry.resolve({
                protocol: "anthropic",
                modelId: "claude-sonnet-5",
                provenance: "env",
            }),
        ).toThrow(/ANTHROPIC_API_KEY is not set/);
    });

    it("deepseek env resolution uses its vendor baseURL", () => {
        process.env.DEEPSEEK_API_KEY = "sk-ds";
        const resolved = defaultProviderRegistry.resolve({
            protocol: "deepseek",
            modelId: "deepseek-v4",
            provenance: "env",
        });
        expect(resolved.provider).toBe("deepseek");
        expect(resolved.modelId).toBe("deepseek-v4");
    });
});

describe("local protocols", () => {
    it("throw 'requires a BYOK connection' in the env/selection path", () => {
        expect(() =>
            defaultProviderRegistry.resolve({
                protocol: "ollama",
                modelId: "ollama-default",
                provenance: "env",
            }),
        ).toThrow(/require a BYOK connection/);
    });

    it("resolve an openai-compatible local server with a baseUrl and no api key", () => {
        const resolved = defaultProviderRegistry.resolve({
            protocol: "openai",
            modelId: "llama3.1",
            baseUrl: "http://localhost:11434/v1",
            provenance: "connection",
        });
        expect(resolved.provider).toBe("openai");
        expect(resolved.apiKey).toBeUndefined();
    });
});

describe("BYOK connection resolution", () => {
    it("resolves an openai-compatible connection with an explicit key", () => {
        const resolved = defaultProviderRegistry.resolve({
            protocol: "openai",
            modelId: "my-model",
            baseUrl: "https://gateway.example.com/v1",
            apiKey: "sk-byok",
            provenance: "connection",
        });
        expect(resolved.provider).toBe("openai");
        expect(resolved.modelId).toBe("my-model");
        expect(resolved.apiKey).toBe("sk-byok");
    });

    it("resolves an anthropic proxy connection", () => {
        const resolved = defaultProviderRegistry.resolve({
            protocol: "anthropic",
            modelId: "claude-sonnet-5",
            baseUrl: "https://anthropic-proxy.example.com",
            apiKey: "sk-ant-byok",
            provenance: "connection",
        });
        expect(resolved.provider).toBe("anthropic");
        expect(resolved.apiKey).toBe("sk-ant-byok");
    });

    it("resolves a gemini connection via the native provider (baseUrl not passed)", () => {
        const resolved = defaultProviderRegistry.resolve({
            protocol: "gemini",
            modelId: "gemini-2.5-flash",
            baseUrl: "https://gateway.example.com/v1beta/openai",
            apiKey: "sk-gem-byok",
            provenance: "connection",
        });
        expect(resolved.provider).toBe("google");
        expect(resolved.modelId).toBe("gemini-2.5-flash");
        expect(resolved.apiKey).toBe("sk-gem-byok");
    });
});