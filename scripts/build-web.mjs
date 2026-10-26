// Builds the static site into site/ (published to GitHub Pages).
//   node scripts/build-web.mjs           one-off build
//   node scripts/build-web.mjs --serve   build, watch and serve on http://localhost:8317

import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const serve = process.argv.includes('--serve');
rmSync('site', { recursive: true, force: true });
mkdirSync('site');
for (const f of ['index.html', 'style.css', 'favicon.svg']) copyFileSync(`web/${f}`, `site/${f}`);

const options = {
  entryPoints: { app: 'web/main.ts' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: !serve,
  sourcemap: serve,
  outdir: 'site',
  charset: 'utf8',
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'site', port: 8317 });
  console.log(`http://localhost:${port}/`);
} else {
  await esbuild.build(options);
}
