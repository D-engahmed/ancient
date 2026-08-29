// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Infrastructure layer — the bottom base every other layer leans on.
//
// Per A-LAYER-001 each target layer is its own workspace package. This package
// owns: providers, memory, storage, events, security. Sub-modules are added in
// their own sub-branches; only `providers` is wired here so far.

export * as providers from "./providers";
