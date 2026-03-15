import pino from "pino";
import { env } from "../../env.js";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(env.nodeEnv === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});

/** Create a child logger scoped to a feature area. */
export function createLogger(name: string) {
  return logger.child({ module: name });
}
