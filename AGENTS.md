## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Genesis dependency

The homepage valley, the `/days` archive, and the sprite catalog are not in this repo. They come from `@codemanethan/genesis` (https://github.com/CodeManEthan/genesis), installed as a git dependency, so the lockfile pins one commit of it.

To pick up genesis changes that are already pushed:

```
npm update @codemanethan/genesis
```

Commit the lockfile change afterwards. Nothing else in this repo needs to move.

To work against a local genesis checkout, link it and run its watch build:

```
cd ~/projects/genesis
npm link
npm run dev
```

```
cd ~/projects/portfolio
npm link @codemanethan/genesis
```

`npm run dev` in genesis is tsup in watch mode, which the link needs because the package exports point at `dist/`. Any later `npm install` here drops the link, so re-link after one.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
