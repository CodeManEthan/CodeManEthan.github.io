# Portfolio

Personal portfolio site — Astro with React islands and a Three.js hero, deployed to GitHub Pages on every push to `main`.

**Live:** https://codemanethan.github.io

## Adding a project

Adding a project to the site is two steps:

1. Create `src/content/projects/<slug>.md`:

   ```markdown
   ---
   title: My Project
   summary: One-sentence description shown on the card.
   tech: [Python, Flask]
   status: public          # public | private | soon
   repo: https://github.com/CodeManEthan/my-project   # only if status: public
   demo: https://example.com                          # optional live demo link
   screenshot: /screenshots/my-project.png            # optional
   featured: false         # true puts it in the Featured section
   order: 8                # lower numbers sort first
   ---

   ## Overview

   The markdown body becomes the project's detail page.
   ```

2. (Optional) Drop a 16:9 screenshot at `public/screenshots/<slug>.png`. Cards without a screenshot get a styled placeholder.

Push to `main` and GitHub Actions rebuilds and deploys the site.

## Status values

- `public` — card links to the GitHub repo (`repo` field required)
- `private` — card shows "Source private · demo on request"
- `soon` — card shows "Repo coming soon" (for projects being cleaned up for release)

## Development

```sh
npm install
npm run dev        # localhost:4321
npm run build      # production build to ./dist/
npm run preview    # preview the production build
```

## Structure

- `src/content/projects/` — one markdown file per project (the only thing you touch to add one)
- `src/content.config.ts` — the project frontmatter schema
- `src/pages/index.astro` — homepage (hero, featured grid, more projects, about)
- `src/pages/projects/[slug].astro` — detail page template, generated per project
- `src/components/Hero3D.tsx` — Three.js hero scene (react-three-fiber, rendered client-only)
- `src/components/ProjectCard.astro` — project card
- `src/layouts/Base.astro` — global layout and theme
- `.github/workflows/deploy.yml` — build + deploy to GitHub Pages
