import { defineRailway, github, image, preserve, project, service, volume } from 'railway/iac';

const publicHost = 'nive.visomi.dev';
const publicOrigin = `https://${publicHost}`;
const postgresMount = '/var/lib/postgresql/data';

export default defineRailway((context) => {
  if (context.projectName !== 'nive' || !context.isEnvironment('production')) {
    throw new Error('Select the nive production environment before planning its infrastructure.');
  }

  const databaseVolume = volume('postgres-volume', { sizeMB: 1024 });
  // The postgres() preset also provisions a public TCP proxy.
  const appDatabase = service('Postgres', {
    source: image(
      'docker.io/library/postgres:16-alpine@sha256:866efe7070b471f3a5397edac0e5edd65c23ff056587c6e47c07d008caaedd28',
    ),
    volumeMounts: { [postgresMount]: databaseVolume },
    deploy: { requiredMountPath: postgresMount },
    env: {
      PGDATA: `${postgresMount}/pgdata`,
      POSTGRES_DB: 'nive',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: { generator: 'secret(64, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")' },
      DATABASE_URL:
        'postgresql://${{POSTGRES_USER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{POSTGRES_DB}}',
    },
  });

  const gateway = service('web-gateway', {
    source: github('visomi-dev/nive', { branch: 'main', checkSuites: true }),
    // Railway edge tracing can capture paths and client trace IDs outside the application allowlist.
    tracing: { enabled: false, autoInstrumentation: false },
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    deploy: {
      preDeployCommand: ['node libs/backend/db/tools/migrate.mjs'],
      preDeployTimeoutSeconds: 120,
      healthcheckPath: '/api/',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      drainingSeconds: 10,
    },
    env: {
      PORT: '8080',
      DATABASE_URL: appDatabase.env.DATABASE_URL,
      AUTH_ORIGIN: publicOrigin,
      AUTH_RP_ID: publicHost,
      NG_ALLOWED_HOSTS: publicHost,
      NIVE_PUBLIC_ORIGIN: publicOrigin,
      SESSION_SECRET: { generator: 'secret(64, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")' },
      // One Railway HTTP ingress and only trusted private-network callers.
      AUTH_TRUST_PROXY: '1-hop',
      GOOGLE_AUTH_CLIENT_ID: preserve(),
      SMTP_HOST: preserve(),
      SMTP_PORT: preserve(),
      SMTP_SECURE: preserve(),
      SMTP_FROM: preserve(),
      SMTP_USER: preserve(),
      SMTP_PASSWORD: preserve(),
    },
  });

  return project('nive', { resources: [gateway, appDatabase, databaseVolume] });
});
