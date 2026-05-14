import { router } from "../../../trpc.js";
import { githubConfigRouter } from "./config.js";
import { githubInstallRouter } from "./install.js";
import { githubReposRouter } from "./repos.js";

export const githubRouter = router({
  ...githubConfigRouter._def.procedures,
  ...githubInstallRouter._def.procedures,
  ...githubReposRouter._def.procedures,
});
