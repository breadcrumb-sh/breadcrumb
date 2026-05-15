import { router, procedure } from "../../trpc.js";
import { organizationsRouter } from "./organizations.js";
import { projectsRouter } from "./projects.js";
import { apiKeysRouter } from "./api-keys.js";
import { membersRouter } from "./members.js";
import { invitationsRouter } from "./invitations.js";
import { configRouter } from "./config.js";

export const appRouter = router({
  health: procedure.query(() => ({ status: "ok" })),
  config: configRouter,
  organizations: organizationsRouter,
  projects: projectsRouter,
  apiKeys: apiKeysRouter,
  members: membersRouter,
  invitations: invitationsRouter,
});

export type AppRouter = typeof appRouter;
