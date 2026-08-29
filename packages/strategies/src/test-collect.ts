// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Event-collection helper for strategy tests.

import type { StrategyEvent } from "./types";

export async function collect(source: AsyncIterable<StrategyEvent>): Promise<StrategyEvent[]> {
    const events: StrategyEvent[] = [];
    for await (const event of source) events.push(event);
    return events;
}