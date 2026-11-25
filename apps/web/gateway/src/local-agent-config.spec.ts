import { createServer, get } from 'node:http';
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
    const policy = (path: string, host: string) =>
      new Promise<string | undefined>((resolve, reject) => {
        const request = get({ host: '127.0.0.1', port: address.port, path, headers: { Host: host } }, (response) => {
          response.resume();
          resolve(response.headers['content-security-policy'] as string | undefined);
        });

        request.once('error', reject);
      });
    const local = await policy('/app', 'localhost:8080');
    const foreign = await policy('/app/en/personal', 'localhost:8081');
    const nonApp = await policy('/api/', 'localhost:8080');

    expect(local).toContain(loopback);
    expect(foreign).not.toContain(loopback);
    expect(nonApp).not.toContain(loopback);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
