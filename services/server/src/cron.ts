import { CronJob } from "cron";
import { cache } from "./shared/lib/cache.js";
import { createLogger } from "./shared/lib/logger.js";

const log = createLogger("cron");

/**
 * Start all scheduled jobs. Call once at server startup.
 */
export function startCronJobs() {
  // Purge expired cache entries every 10 minutes
  new CronJob("*/10 * * * *", async () => {
    try {
      const count = await cache.cleanup();
      if (count > 0) log.info({ count }, "cache cleanup: removed expired entries");
    } catch (err) {
      log.error({ err }, "cache cleanup failed");
    }
  }).start();
}
