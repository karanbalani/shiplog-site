# shiplog-site

Simple landing page and browser config builder for [shiplog](https://github.com/karanbalani/shiplog).

## Development

```bash
bun install
bun run dev
```

## Tooling

The site uses Bun, Astro/Vite, oxfmt, and oxlint.

```bash
bun run verify
```

## Deployment

Deployments are configured for Netlify in `netlify.toml`.

- Build command: `bun run build`
- Publish directory: `dist`
- Production branch: `main`
- Custom domain: `shiplog.karanbalani.tech`

## Sync shiplog assets

The config builder and Rendor Studio use generated assets from the canonical `shiplog` repo.
Generated application files are ignored by Git and refreshed before `dev`, `check`, and `build`.
The same sync also publishes JSON schemas into `public/schemas/` so editors can resolve
URLs such as `https://shiplog.karanbalani.tech/schemas/shiplog.config.schema.json`
and `https://shiplog.karanbalani.tech/schemas/render.config.schema.json`.

```bash
bun run sync:shiplog
```

By default the script reads from `../shiplog` when that checkout exists, then falls
back to GitHub at `SHIPLOG_REF=main`.

```bash
SHIPLOG_REPO_PATH=/path/to/shiplog bun run sync:shiplog
SHIPLOG_REF=v1.0.0 bun run sync:shiplog
```
