/**
 * Backend Factory
 * 
 * Creates AI SDK model instances for each provider.
 */

import type { BackendConfig } from "../types";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export class BackendFactory {
    async createModel(config: BackendConfig): Promise<unknown> {
        switch (config.provider) {
            case "openai": {
                const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
                return openai(config.model);
            }
            case "anthropic": {
                const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
                return anthropic(config.model);
            }
            case "google": {
                const google = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
                return google(config.model);
            }
            case "openrouter": {
                const openai = createOpenAI({
                    apiKey: config.apiKey,
                    baseURL: config.baseUrl || "https://openrouter.ai/api/v1"
                });
                return openai(config.model);
            }
            case "ollama": {
                const openai = createOpenAI({
                    apiKey: "ollama",
                    baseURL: config.baseUrl || "http://localhost:11434/api"
                });
                return openai(config.model);
            }
            case "local": {
                const openai = createOpenAI({
                    apiKey: config.apiKey || "local",
                    baseURL: config.baseUrl || "http://localhost:8000/v1"
                });
                return openai(config.model);
            }
            default:
                throw new Error(`Unknown provider: ${config.provider}`);
        }
    }
}