import { router, procedure } from "../trpc.js";
import { env } from "../../env.js";

export const configRouter = router({
  publicViewing: procedure.query(() => ({
    enabled: env.allowPublicViewing,
  })),
});
