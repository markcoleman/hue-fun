# GitHub Pages Publishing

The repo now includes a dedicated GitHub Pages build that turns the existing Markdown docs into a modern landing page and guide hub.

## What gets published

- a homepage that introduces the SDK, CLI, MCP server, and contributor workflow
- generated guide pages created from the Markdown files already stored in `docs`
- the generated TypeDoc API reference copied from `docs/api`
- SEO assets such as `robots.txt`, `sitemap.xml`, canonical URLs, and Open Graph metadata for sharing previews

## Local preview workflow

```bash
npm install
npm run docs
SITE_ORIGIN=https://example.com SITE_BASE_PATH=/openhue-client npm run pages:build
```

Open `site-dist/index.html` in a browser or serve `site-dist` with any static file server.

## GitHub workflow

On every push to `main` and on manual dispatch, `.github/workflows/pages.yml` will:

1. install dependencies with `npm ci`
2. regenerate TypeDoc with `npm run docs`
3. build the GitHub Pages site with `npm run pages:build`
4. deploy the `site-dist` artifact with `actions/deploy-pages`

## Support links

The published site includes support references to [buymeacottoncandy.com](https://buymeacottoncandy.com) so visitors can help keep the project energized.
