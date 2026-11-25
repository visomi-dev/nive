import { readFileSync } from 'node:fs';

import { bucket, defineRailway, github, image, preserve, project, ref, service, volume } from 'railway/iac';

const publicHost = 'nive.visomi.dev';
const publicOrigin = `https://${publicHost}`;
const region = 'us-east4-eqdc4a';
const postgresMount = '/var/lib/postgresql/data';
const redisMount = '/data';
const jaegerMount = '/badger';
const secretGenerator = 'secret(64, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")';

export const watchPatterns = [
  '/apps/web/gateway/**',
  '/apps/web/realtime/**',
  '/apps/web/api/**',
  '/apps/web/site/**',
  '/apps/web/app/**',
  '/assets/brand/**',
  '/tools/branding/**',
  '/libs/backend/db/**',
  '/libs/backend/shared/**',
  '/libs/shared/db/**',
  '/libs/web/backend/shared/**',
  '/libs/web/frontend/db/**',
  '/libs/web/frontend/ui/**',
  '/libs/web/shared/observability/**',
  '/styles.base.css',
  '/.postcssrc.json',
  '/package.json',
  '/pnpm-lock.yaml',
  '/pnpm-workspace.yaml',
  '/nx.json',
  '/tsconfig*.json',
  '/.node-version',
  '/Dockerfile',
  '/.dockerignore',
  '/patches/**',
  '/.railway/**',
];

export default defineRailway((context) => {
  if (context.projectName !== 'nive' || !context.isEnvironment('production')) {
    throw new Error('Select the nive production environment before planning its infrastructure.');
  }

  const privateFiles = bucket('private-files', { region: 'iad' });
  const databaseVolume = volume('postgres-volume', { sizeMB: 50000, region });
  // The postgres() preset also provisions a public TCP proxy.
  const appDatabase = service('Postgres', {
    source: image(
      'docker.io/library/postgres:16-alpine@sha256:866efe7070b471f3a5397edac0e5edd65c23ff056587c6e47c07d008caaedd28',
    ),
    replicas: { [region]: 1 },
    tracing: { enabled: false },
    volumeMounts: { [postgresMount]: databaseVolume },
    deploy: { requiredMountPath: postgresMount },
    env: {
      PGDATA: `${postgresMount}/pgdata`,
      POSTGRES_DB: 'nive',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: { generator: secretGenerator },
      DATABASE_URL:
        'postgresql://${{POSTGRES_USER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{POSTGRES_DB}}',
    },
  });

  const brokerData = volume('redis-volume', { sizeMB: 50000, region });
  const broker = service('Redis', {
    source: image(
      'docker.io/library/redis:8.2@sha256:bb302517211721bf85ae3152b663c848a7cb36e79b02d69239ce20b5ddce95be',
    ),
    replicas: { [region]: 1 },
    tracing: { enabled: false },
    volumeMounts: { [redisMount]: brokerData },
    deploy: {
      requiredMountPath: redisMount,
      startCommand: `/bin/sh -c 'exec docker-entrypoint.sh redis-server --appendonly yes --requirepass "$REDIS_PASSWORD"'`,
    },
    env: {
      REDIS_PASSWORD: { generator: secretGenerator },
      REDIS_URL: 'redis://:${{REDIS_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:6379',
    },
  });

  const traces = volume('jaeger-data', { sizeMB: 1024, region });
  const jaeger = service('jaeger', {
    source: image(
      'jaegertracing/jaeger:2.22.0@sha256:4d9387a02389204ef9a256cf291a36cfbae91983010e403b4d300202d07eff2a',
    ),
    replicas: { [region]: 1 },
    tracing: { enabled: false },
    volumeMounts: { [jaegerMount]: traces },
    deploy: {
      requiredMountPath: jaegerMount,
      startCommand: '/cmd/jaeger/jaeger-linux --config env:JAEGER_CONFIG',
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 500000000 } },
      healthcheckPath: '/status',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      drainingSeconds: 10,
      sleepApplication: false,
    },
    env: {
      PORT: '13133',
      // Railway mounts the Badger data volume with root ownership.
      RAILWAY_RUN_UID: '0',
      JAEGER_CONFIG: readFileSync(new URL('./jaeger.yaml', import.meta.url), 'utf8'),
      JAEGER_HTPASSWD: context.shared.NIVE_JAEGER_HTPASSWD,
    },
  });

  const gateway = service('web-gateway', {
    source: github('visomi-dev/nive', { branch: 'main', checkSuites: true }),
    replicas: { [region]: 1 },
    // Railway edge tracing can capture paths and client trace IDs outside the application allowlist.
    tracing: { enabled: false },
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile', watchPatterns },
    deploy: {
      preDeployCommand: ['node libs/backend/db/tools/migrate.mjs'],
      preDeployTimeoutSeconds: 120,
      healthcheckPath: '/api/',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      drainingSeconds: 10,
      sleepApplication: false,
    },
    env: {
      PORT: '8080',
      DATABASE_URL: appDatabase.env.DATABASE_URL,
      AUTH_ORIGIN: publicOrigin,
      AUTH_RP_ID: publicHost,
      NG_ALLOWED_HOSTS: publicHost,
      SESSION_SECRET: { generator: secretGenerator },
      // One Railway HTTP ingress and only trusted private-network callers.
      AUTH_TRUST_PROXY: '1-hop',
      GOOGLE_AUTH_CLIENT_ID: preserve(),
      SMTP_HOST: preserve(),
      SMTP_PORT: preserve(),
      SMTP_SECURE: preserve(),
      SMTP_FROM: preserve(),
      SMTP_USER: preserve(),
      SMTP_PASSWORD: preserve(),
      REALTIME_REDIS_URL: broker.env.REDIS_URL,
      PRIVATE_S3_ENDPOINT: ref(privateFiles, 'ENDPOINT'),
      PRIVATE_S3_BUCKET: ref(privateFiles, 'BUCKET'),
      PRIVATE_S3_ACCESS_KEY: ref(privateFiles, 'ACCESS_KEY_ID'),
      PRIVATE_S3_SECRET_KEY: ref(privateFiles, 'SECRET_ACCESS_KEY'),
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://${{jaeger.RAILWAY_PRIVATE_DOMAIN}}:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_HEADERS: context.shared.NIVE_OTLP_AUTH_HEADER,
    },
  });

  return project('nive', {
    resources: [gateway, appDatabase, databaseVolume, broker, brokerData, privateFiles, jaeger, traces],
  });
});
