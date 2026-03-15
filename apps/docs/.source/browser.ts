// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"introduction/ai-integrations.mdx": () => import("../content/docs/introduction/ai-integrations.mdx?collection=docs"), "introduction/index.mdx": () => import("../content/docs/introduction/index.mdx?collection=docs"), "introduction/quick-start.mdx": () => import("../content/docs/introduction/quick-start.mdx?collection=docs"), "setup/hosted.mdx": () => import("../content/docs/setup/hosted.mdx?collection=docs"), "setup/self-hosting.mdx": () => import("../content/docs/setup/self-hosting.mdx?collection=docs"), "product/ai/explore.mdx": () => import("../content/docs/product/ai/explore.mdx?collection=docs"), "product/ai/mcp.mdx": () => import("../content/docs/product/ai/mcp.mdx?collection=docs"), "product/ai/observations.mdx": () => import("../content/docs/product/ai/observations.mdx?collection=docs"), "product/observability/dashboard.mdx": () => import("../content/docs/product/observability/dashboard.mdx?collection=docs"), "product/observability/traces.mdx": () => import("../content/docs/product/observability/traces.mdx?collection=docs"), "product/settings/ai-provider.mdx": () => import("../content/docs/product/settings/ai-provider.mdx?collection=docs"), "product/settings/api-keys.mdx": () => import("../content/docs/product/settings/api-keys.mdx?collection=docs"), "product/settings/members.mdx": () => import("../content/docs/product/settings/members.mdx?collection=docs"), "sdks/ai-sdk/index.mdx": () => import("../content/docs/sdks/ai-sdk/index.mdx?collection=docs"), "sdks/typescript/agents.mdx": () => import("../content/docs/sdks/typescript/agents.mdx?collection=docs"), "sdks/typescript/installation.mdx": () => import("../content/docs/sdks/typescript/installation.mdx?collection=docs"), "sdks/typescript/tracing.mdx": () => import("../content/docs/sdks/typescript/tracing.mdx?collection=docs"), }),
};
export default browserCollections;