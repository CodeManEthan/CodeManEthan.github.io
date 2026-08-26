// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://codemanethan.github.io',
  integrations: [react()],
  vite: {
    server: {
      // When @codemanethan/genesis is npm-linked to ~/projects/genesis, Vite
      // serves its files from the symlink's real path, which sits outside this
      // project. Allow the parent dir so the linked package loads in dev.
      // Harmless when the link is not active.
      fs: { allow: ['.', '..'] },
    },
  },
});