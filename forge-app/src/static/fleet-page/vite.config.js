import { defineConfig } from 'vite';
import compiled from '@compiled/vite-plugin';
import react from '@vitejs/plugin-react';

// Same build shape as the issue panel: Compiled before React so the design
// system transforms apply first.
export default defineConfig({
  base: './',
  plugins: [
    compiled({ transformerBabelPlugins: [['@atlaskit/tokens/babel-plugin']], extract: true }),
    react(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // See src/static/issue-panel/vite.config.js: lightningcss rejects selectors
    // the design system's compiled output emits.
    cssMinify: false,
    rollupOptions: {
      input: { index: 'index.html' },
    },
  },
  server: {
    port: Number(process.env.DEV_SERVER_PORT) || 3001,
    strictPort: true,
    host: 'localhost',
  },
});
