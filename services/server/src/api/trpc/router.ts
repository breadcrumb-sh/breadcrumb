import { router, procedure } from "../../trpc.js";
import { projectsRouter } from "./projects.js";
import { apiKeysRouter } from "./api-keys.js";
import { mcpKeysRouter } from "./mcp-keys.js";
import { tracesRouter } from "./traces/router.js";
import { membersRouter } from "./members.js";
import { invitationsRouter } from "./invitations.js";
import { aiProvidersRouter } from "./ai-providers.js";
import { exploresRouter } from "./explore.js";
import { configRouter } from "./config.js";
import { observationsRouter } from "./observations.js";

export const appRouter = router({
  health: procedure.query(() => ({ status: "ok" })),
  config: configRouter,
  projects: projectsRouter,
  apiKeys: apiKeysRouter,
  mcpKeys: mcpKeysRouter,
  traces: tracesRouter,
  members: membersRouter,
  invitations: invitationsRouter,
  aiProviders: aiProvidersRouter,
  explores: exploresRouter,
  observations: observationsRouter,
});

export type AppRouter = typeof appRouter;

export type {
  LegendEntry,
  ChartSpec,
  DisplayPart,
  StreamEvent,
} from "../../services/explore/types.js";
