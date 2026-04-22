import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/nextjs.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  // Match package.json exports: ESM -> .mjs, CJS -> .js
  outExtension({ format }) {
    return format === 'esm' ? { js: '.mjs' } : { js: '.js' };
  },
});
