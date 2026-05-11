import { build, context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const production = process.env.NODE_ENV === 'production';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [resolve(__dirname, 'src/extension.ts')],
  bundle: true,
  outfile: resolve(__dirname, 'dist/extension.js'),
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode', 'better-sqlite3'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function copyAssets() {
  const dist = resolve(__dirname, 'dist');
  await mkdir(dist, { recursive: true });
  await mkdir(resolve(dist, 'webview'), { recursive: true });
  await mkdir(resolve(dist, 'assets'), { recursive: true });
  // Pricing table is needed at runtime
  await copyFile(
    resolve(__dirname, 'assets/pricing.json'),
    resolve(dist, 'assets/pricing.json'),
  );
}

if (watch) {
  await copyAssets();
  const ctx = await context(options);
  await ctx.watch();
  console.log('[esbuild] watching for changes…');
} else {
  await copyAssets();
  await build(options);
  console.log('[esbuild] build complete');
}
