# Breadcrumb

Open-source tracing for AI agents and pipelines. Learn more at [breadcrumb.sh](https://breadcrumb.sh).

**[Documentation](https://breadcrumb.sh/docs)**

## Packages

| Package | Description |
|---------|-------------|
| [`@breadcrumb-sdk/core`](./packages/sdk-typescript) | Core SDK for tracing agents and pipelines |
| [`@breadcrumb-sdk/ai-sdk`](./packages/ai-sdk) | Vercel AI SDK integration |

## Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/breadcrumb?referralCode=9MtPO4&utm_medium=integration&utm_source=template&utm_campaign=generic)

Or run with Docker Compose:

```bash
cp services/server/.env.example services/server/.env
# Edit services/server/.env with your configuration
docker compose -f docker-compose.prod.yml up -d --build
```

See the [self-hosting docs](https://breadcrumb.sh/docs/setup/self-hosting) for full setup instructions.

## Development

```bash
npm run dev          # Full stack (Docker + server + web)
npm run dev:packages # SDK packages only
npm run test         # Run all tests
npm run build        # Build all workspaces
```

## License

AGPL-3.0 — see [LICENSE](./LICENSE) for details.
