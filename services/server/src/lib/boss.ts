import PgBoss from "pg-boss";
import { env } from "../env.js";

export const boss = new PgBoss(env.databaseUrl);

boss.on("error", (err) => console.error("[pg-boss] error:", err));
