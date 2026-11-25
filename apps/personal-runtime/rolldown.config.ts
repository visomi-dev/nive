import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/main.ts',
  platform: 'node',
  tsconfig: 'tsconfig.app.json',
  external: /^(?:@modelcontextprotocol\/sdk\/|zod$)/,
  output: {
    dir: '../../dist/apps/personal-runtime',
    cleanDir: true,
    format: 'esm',
    entryFileNames: 'main.mjs',
  },
});
