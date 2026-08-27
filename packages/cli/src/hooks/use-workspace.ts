import { useEffect, useState } from "react";
import {
  cliLatency,
  getWorkspaceInfo,
  type WorkspaceInfo,
} from "../lib/experience";
import { openLearningStore, defaultLearningFile } from "../lib/experience";
import type { LearningStore } from "../lib/experience";

/**
 * Loads the current workspace's git/package-manager info once on mount and
 * exposes the shared CLI latency tracker (+ a persisted learning store).
 */
export function useWorkspace(cwd = process.cwd()) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [learning, setLearning] = useState<LearningStore | null>(null);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      const info = await getWorkspaceInfo(cwd);
      if (!ignore) setWorkspace(info);
      const store = await openLearningStore(defaultLearningFile(cwd));
      if (!ignore) setLearning(store);
    })();
    return () => {
      ignore = true;
    };
  }, [cwd]);

  return { workspace, learning, latency: cliLatency };
}
