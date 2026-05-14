import { useSyncExternalStore, useCallback } from "react";

export type ProjectFilters = {
  from?: string;
  to?: string;
  preset?: 7 | 30 | 90;
  names?: string[];
  models?: string[];
  env?: string[];
};

const STORAGE_KEY_PREFIX = "project-filters:";
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function storageKey(projectId: string) {
  return `${STORAGE_KEY_PREFIX}${projectId}`;
}

function read(projectId: string): ProjectFilters {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return {};
    return JSON.parse(raw) as ProjectFilters;
  } catch {
    return {};
  }
}

function write(projectId: string, filters: ProjectFilters) {
  const clean: ProjectFilters = {};
  // Only persist from/to for custom ranges — presets recompute on load
  if (filters.preset) {
    clean.preset = filters.preset;
  } else {
    if (filters.from) clean.from = filters.from;
    if (filters.to) clean.to = filters.to;
  }
  if (filters.names?.length) clean.names = filters.names;
  if (filters.models?.length) clean.models = filters.models;
  if (filters.env?.length) clean.env = filters.env;

  if (Object.keys(clean).length > 0) {
    localStorage.setItem(storageKey(projectId), JSON.stringify(clean));
  } else {
    localStorage.removeItem(storageKey(projectId));
  }
  emit();
}

/**
 * Shared project filter state backed by localStorage.
 * All components using this hook for the same projectId stay in sync.
 */
export function useProjectFilters(projectId: string) {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);

  const filters = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(storageKey(projectId)) ?? "{}",
    () => "{}",
  );

  const parsed: ProjectFilters = (() => {
    try { return JSON.parse(filters); } catch { return {}; }
  })();

  const setFilters = useCallback(
    (updater: ProjectFilters | ((prev: ProjectFilters) => ProjectFilters)) => {
      const prev = read(projectId);
      const next = typeof updater === "function" ? updater(prev) : updater;
      write(projectId, next);
    },
    [projectId],
  );

  return [parsed, setFilters] as const;
}
