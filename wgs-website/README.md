# wgs-website

Static marketing site for WorkGrid Studio, built for Cloudflare Pages.

## Local development

```bash
pnpm install
pnpm dev
```

## Production build

```bash
pnpm build
```

The Cloudflare Pages output directory is `dist/`.

## Cloudflare Pages

This package already points all site metadata to `https://workgrid-studio.skiddph.com`:

- canonical URL
- prerendered homepage HTML
- Open Graph and Twitter URLs
- JSON-LD structured data
- `robots.txt`
- `sitemap.xml`
- web manifest

Recommended Pages project settings:

- Project name: `wgs-website`
- Root directory: `wgs-website`
- Build command: `pnpm install && pnpm build`
- Build output directory: `dist`

If you deploy with Wrangler instead of Git integration:

```bash
pnpm cf:deploy
```

Cloudflare Pages still requires the custom domain to be attached in the Pages project itself. After creating or importing the project, add `workgrid-studio.skiddph.com` under **Custom domains** for the final DNS association.
