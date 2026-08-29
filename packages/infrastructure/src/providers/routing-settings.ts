// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// The routing settings shape the provider router consumes. Defined here (not in
// the server's hooks/settings) so the infrastructure router has no dependency
// on server internals; the server's settings loader maps/casts onto this shape.

export type ModelRoutingSettings = {
    enabled?: boolean;
    strategy?: "free-first";
    freeModel?: {
        baseUrl?: string;
        modelId?: string;
        apiKeyEnv?: string;
    };
};
