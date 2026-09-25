// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Standalone CLI bootstrap. Configuration is resolved from the caller's
// working directory so compiled binaries do not depend on the monorepo layout.

import dotenv from "dotenv";
import { resolve } from "node:path";

const envFile = process.env.ANCIENT_ENV_FILE ?? resolve(process.cwd(), ".env");
dotenv.config({ path: envFile, override: true });

await import("./index.tsx");
