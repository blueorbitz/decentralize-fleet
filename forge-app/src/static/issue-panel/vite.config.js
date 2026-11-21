import { defineConfig } from 'vite';
import compiled from '@compiled/vite-plugin';
import react from '@vitejs/plugin-react';

// Compiled must run before React so the design-system transforms apply first,
// as the Atlassian Design System setup guide specifies.
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
    // Vite 8 minifies CSS with lightningcss, which currently rejects selectors
    // that the design system's compiled output emits. Tree-shaking and JS
    // minification still apply; only CSS minification is off.
    cssMinify: false,
    rollupOptions: {
      input: { index: 'index.html' },
    },
  },
  server: {
    port: Number(process.env.DEV_SERVER_PORT) || 3000,
    strictPort: true,
    host: 'localhost',
  },
});
