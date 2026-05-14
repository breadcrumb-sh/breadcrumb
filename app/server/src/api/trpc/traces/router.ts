import { router } from "../../../trpc.js";
import { statsRouter } from "./stats.js";
import { listRouter } from "./list.js";
import { detailRouter } from "./detail.js";
import { metadataRouter } from "./metadata.js";
import { insightsRouter } from "./insights.js";

export const tracesRouter = router({
  ...statsRouter._def.procedures,
  ...listRouter._def.procedures,
  ...detailRouter._def.procedures,
  ...metadataRouter._def.procedures,
  ...insightsRouter._def.procedures,
});
