# Breadcrumb Marketing Site

Static marketing and waitlist site for [Breadcrumb](https://breadcrumb.sh) — built with Astro and deployed on Railway.

## Stack

- [Astro](https://astro.build) (SSR via `@astrojs/node`)
- Tailwind CSS v4
- PostgreSQL (waitlist storage)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for waitlist storage |
| `NTFY_URL` | No | ntfy.sh topic URL for signup notifications |

## Development

```sh
npm install
npm run dev       # http://localhost:4321
```

## Build & Deploy

```sh
npm run build     # Output to dist/
npm run start     # Serve the built SSR bundle
```

## Routes

- `/` — Landing page
- `POST /api/waitlist` — Waitlist signup endpoint (email, deploy, scale, comments)
