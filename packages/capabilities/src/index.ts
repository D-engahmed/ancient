// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Capability runtime — the tool/capability layer (ARCHITECTURE audit #5).
//
// Per A-LAYER-002 this package may depend only on @ANCIENT/shared and
// @ANCIENT/infrastructure (never upward into strategies/engine/gateway). Per
// A-EXEC-004 a new capability must be addable as a runtime module without
// touching a chat handler. Sub-modules: core (registry + contract + permission)
// via own sub-branches; core, files, shell, skills, mcp, browser are wired.

export {};