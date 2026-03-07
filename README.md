# Breadcrumb

Open-source tracing for AI agents and pipelines. Learn more at [breadcrumb.sh](https://breadcrumb.sh).

## Packages

| Package | Description |
|---------|-------------|
| [`@breadcrumb-sdk/core`](./packages/sdk-typescript) | Core SDK for tracing agents and pipelines |
| [`@breadcrumb-sdk/ai-sdk`](./packages/ai-sdk) | Vercel AI SDK integration |

## Self-hosting

A Docker image is available. It requires PostgreSQL and ClickHouse — configure the connection strings via environment variables before starting the container.

Full self-hosting docs coming soon.

## Development

```bash
npm run dev          # Full stack (Docker + server + web)
npm run dev:packages # SDK packages only
npm run test         # Run all tests
npm run build        # Build all workspaces
```

## License

AGPL-3.0 — see [LICENSE](./LICENSE) for details.
