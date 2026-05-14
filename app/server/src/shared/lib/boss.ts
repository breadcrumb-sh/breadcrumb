import PgBoss from "pg-boss";
import { env } from "../../env.js";
import { createLogger } from "./logger.js";

const log = createLogger("pg-boss");

export const boss = new PgBoss(env.databaseUrl);

boss.on("error", (err) => log.error({ err }, "pg-boss error"));
