import { createServer, get, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

import { expect, it, vi } from 'vitest';

import type { ApiModule } from './api-module';
import { createGatewayApp } from './app';
import { configuredLocalAgentOrigin } from './local-agent-config';

const loopback = 'http://127.0.0.1:43871';
const origin = 'http://localhost:8080';

it('permits the browser bridge only in explicitly enabled loopback development', () => {
  expect(configuredLocalAgentOrigin({ NODE_ENV: 'development', NIVE_LOCAL_AGENT: '1', AUTH_ORIGIN: origin })).toBe(
    origin,
  );
  expect(
    configuredLocalAgentOrigin({ NODE_ENV: 'development', NIVE_LOCAL_AGENT: '0', AUTH_ORIGIN: origin }),
  ).toBeUndefined();
  expect(
    configuredLocalAgentOrigin({ NODE_ENV: 'production', NIVE_LOCAL_AGENT: '1', AUTH_ORIGIN: origin }),
  ).toBeUndefined();
  expect(
    configuredLocalAgentOrigin({
      NODE_ENV: 'development',
      NIVE_LOCAL_AGENT: '1',
      AUTH_ORIGIN: 'https://app.example.test',
    }),
  ).toBeUndefined();
});

it('scopes the additional CSP source to app documents on the selected local origin', async () => {
  const api: ApiModule = {
    exampleApiVersion: 1,
    createApp: () => (_request, response) => response.json({}),
    authConfig: vi.fn(),
    createAuthentication: vi.fn(),
  };
  const app = createGatewayApp({ api, localAgentOrigin: origin });
  const server = createServer(app);

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const getFromHost = (path: string, host: string) =>
      new Promise<{ headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
        const request = get({ host: '127.0.0.1', port: address.port, path, headers: { Host: host } }, (response) => {
          let body = '';

          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.once('end', () => resolve({ headers: response.headers, body }));
          response.once('error', reject);
        });

        request.once('error', reject);
      });
    const local = await getFromHost('/app', 'localhost:8080');
    const foreign = await getFromHost('/app/en/personal', 'localhost:8081');
    const nonApp = await getFromHost('/api/', 'localhost:8080');

    expect(local.headers['content-security-policy']).toContain(loopback);
    expect(foreign.headers['content-security-policy']).not.toContain(loopback);
    expect(nonApp.headers['content-security-policy']).not.toContain(loopback);

    const enabled = await getFromHost('/api/personal/local-agent', 'localhost:8080');
    const disabled = await getFromHost('/api/personal/local-agent', 'localhost:8081');

    expect(enabled.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(enabled.body)).toEqual({ enabled: true });
    expect(JSON.parse(disabled.body)).toEqual({ enabled: false });
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
