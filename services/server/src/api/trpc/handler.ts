import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Context } from "hono";
import { appRouter } from "./router.js";
import type { TRPCContext } from "../../trpc.js";

export const trpcHandler = async (c: Context) => {
  return fetchRequestHandler({
    endpoint: "/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): TRPCContext => ({
      user: c.get("user") ?? null,
      session: c.get("session") ?? null,
    }),
  });
};
