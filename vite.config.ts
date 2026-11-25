import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Caminho base do site (ex.: /Eagle-1/ no GitHub Pages). */
const base = process.env.BASE_PATH || '/';
/** URL pública absoluta, com barra no fim. Sem ela, não há canonical nem sitemap. */
const siteUrl = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';

const PAGES = ['', 'privacidade/'];

/** Canonical, og:url, sitemap.xml e robots.txt com a URL real do site. */
function seo(): Plugin {
  return {
    name: 'goela-seo',
    transformIndexHtml(html, ctx) {
      const path = ctx.path.replace(/^\//, '').replace(/index\.html$/, '');
      const abs = siteUrl ? siteUrl + path : '';
      let out = html.replaceAll('__SITE_URL__', siteUrl || base);
      if (abs) {
        out = out.replace(
          '</title>',
          `</title>\n    <link rel="canonical" href="${abs}" />\n    <meta property="og:url" content="${abs}" />`,
        );
      }
      return out;
    },
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /'];
      if (siteUrl) {
        const urls = PAGES.map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`).join('\n');
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        });
        robots.push('', `Sitemap: ${siteUrl}sitemap.xml`);
      }
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') + '\n' });
    },
  };
}

export default defineConfig({
  base,
  plugins: [seo()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        privacidade: resolve(import.meta.dirname, 'privacidade/index.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
