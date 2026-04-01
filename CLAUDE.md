## Project

A Big Stick (`www.abigstick.com`) is a personal coding blog built with [Astro](https://astro.build) v5, Tailwind CSS v4, and React v19. It deploys as a static site to Google Cloud Storage.

## Commands

```bash
npm run dev      # Start local dev server
npm run build    # Build static site into dist/
npm run preview  # Preview built site
make publish     # Build + sync dist/ to GCS (deploys to production)
```

## Architecture

**Content** lives in `src/content/blog/` as Markdown files named `YYYY-MM-DD-slug.md`. The schema is defined in `src/content.config.ts` (title, description, date, tags — all required).

**Routing** is fully static — all pages use `getStaticPaths()` at build time:

- `src/pages/[year]/[month]/[day]/[slug].astro` — individual posts (slug strips the date prefix from the filename)
- `src/pages/tags/[tag].astro` — tag-filtered listings
- `src/pages/page/[page].astro` — paginated home (page 2+)
- `src/pages/feed.xml.ts` — RSS feed

**Layouts**: `BaseLayout.astro` wraps all pages (header, nav, footer). `PostLayout.astro` extends it with prose styling for blog posts.
