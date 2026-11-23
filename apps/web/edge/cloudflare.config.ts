import { defineConfig, triggers } from 'cf/config';

const publicHost = process.env['NIVE_PUBLIC_HOST'] ?? 'nive.example.invalid';
const publicZone = process.env['NIVE_PUBLIC_ZONE'] ?? 'example.invalid';

export default defineConfig({
  worker: {
    name: 'nive-malformed-path-guard',
    compatibilityDate: '2026-11-01',
    entrypoint: './src/worker.ts',
    workersDev: false,
    previewUrls: false,
    logpush: false,
    observability: {
      enabled: false,
      logs: { enabled: false, invocationLogs: false },
      traces: { enabled: false },
    },
    triggers: [triggers.fetch({ pattern: `${publicHost}/*`, zone: publicZone })],
  },
});
