import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@breadcrumb/server/trpc";

export const trpc = createTRPCReact<AppRouter>();
