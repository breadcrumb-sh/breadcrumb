import { CronJob } from "cron";
import { cache } from "./lib/cache.js";

/**
 * Start all scheduled jobs. Call once at server startup.
 */
export function startCronJobs() {
  // Purge expired cache entries every 10 minutes
  new CronJob("*/10 * * * *", async () => {
    try {
      const count = await cache.cleanup();
      if (count > 0) console.log(`cache cleanup: removed ${count} expired entries`);
    } catch (err) {
      console.error("cache cleanup failed:", err);
    }
  }).start();
}
