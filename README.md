# shiplog-site

Simple landing page and browser config builder for [shiplog](https://github.com/karanbalani/shiplog).

The canonical documentation lives in the `shiplog` README. The local `/docs/` route is kept only as a redirect for old links.

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

## Sync shiplog assets

The config builder uses generated schema assets from the canonical `shiplog` repo.
Generated files are ignored by Git and refreshed before `dev`, `check`, and `build`.

```bash
bun run sync:shiplog
```

By default the script reads from `../shiplog` when that checkout exists, then falls
back to GitHub at `SHIPLOG_REF=main`.

```bash
SHIPLOG_REPO_PATH=/path/to/shiplog bun run sync:shiplog
SHIPLOG_REF=v1.0.0 bun run sync:shiplog
```
