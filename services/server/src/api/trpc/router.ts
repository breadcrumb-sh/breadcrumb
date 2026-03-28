import { router, procedure } from "../../trpc.js";
import { organizationsRouter } from "./organizations.js";
import { projectsRouter } from "./projects.js";
import { apiKeysRouter } from "./api-keys.js";
import { mcpKeysRouter } from "./mcp-keys.js";
import { tracesRouter } from "./traces/router.js";
import { membersRouter } from "./members.js";
import { invitationsRouter } from "./invitations.js";
import { aiProvidersRouter } from "./ai-providers.js";
import { configRouter } from "./config.js";
import { monitorRouter } from "./monitor.js";

export const appRouter = router({
  health: procedure.query(() => ({ status: "ok" })),
  config: configRouter,
  organizations: organizationsRouter,
  projects: projectsRouter,
  apiKeys: apiKeysRouter,
  mcpKeys: mcpKeysRouter,
  traces: tracesRouter,
  members: membersRouter,
  invitations: invitationsRouter,
  aiProviders: aiProvidersRouter,
  monitor: monitorRouter,
});

export type AppRouter = typeof appRouter;

