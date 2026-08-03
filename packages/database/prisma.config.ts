// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "prisma/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `datasource` is optional for most commands (generate included) and only
  // required for migrate/introspection. Reading process.env directly here
  // (instead of the throwing `env()` helper) means `prisma generate` no
  // longer hard-fails just because `.env`/DATABASE_URL isn't set yet.
  datasource: { url: process.env.DATABASE_URL },
});