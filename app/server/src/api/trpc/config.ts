import { router, procedure } from "../../trpc.js";
import { env } from "../../env.js";
import { getInstanceId } from "../../shared/lib/telemetry.js";

export const configRouter = router({
  instance: procedure.query(() => ({
    allowOpenSignup: env.allowOpenSignupOrgIds.length > 0,
    allowOrgCreation: env.allowOrgCreation,
    isDemo: env.isBreadcrumbDemo,
  })),
  telemetry: procedure.query(() => ({
    disabled: env.disableTelemetry,
    instanceId: getInstanceId(),
  })),
});
