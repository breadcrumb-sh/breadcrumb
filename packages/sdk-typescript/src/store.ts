import { AsyncLocalStorage } from "node:async_hooks";

// Holds the currently active Agent — typed as `any` to avoid a circular import
// with agent.ts. Consumers cast to Agent when reading.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const agentStore = new AsyncLocalStorage<any>();
