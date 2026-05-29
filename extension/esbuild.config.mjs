import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const cfg = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info'
};

if (watch) {
  const ctx = await context(cfg);
  await ctx.watch();
} else {
  await build(cfg);
}
