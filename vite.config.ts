import { defineConfig, type Plugin } from 'vite';

// Вбудовує JS і CSS у index.html, щоб dist/index.html відкривався навіть подвійним кліком (file://)
function inlineBundle(): Plugin {
  return {
    name: 'eco-inline-bundle',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          const re = new RegExp(`<script[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`);
          const code = chunk.code.replace(/<\/script/gi, '<\\/script');
          source = source.replace(re, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (chunk.type === 'asset' && name.endsWith('.css')) {
          const re = new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`);
          source = source.replace(re, () => `<style>${String(chunk.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = source;
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig({
  base: './',
  build: {
    target: ['es2019', 'chrome79', 'safari13', 'firefox78'],
    cssTarget: ['chrome79', 'safari13'],
    assetsInlineLimit: 100000,
    modulePreload: false,
    sourcemap: false,
  },
  plugins: [inlineBundle()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
