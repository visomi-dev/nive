import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { runtimePort } from '@nive/finance';

import type { Broker } from './broker';

const host = '127.0.0.1';

export async function startLoopback(broker: Broker, origin: string) {
  const server = createServer(
    { requestTimeout: 6000, headersTimeout: 4000, keepAliveTimeout: 1000 },
    (request, response) => {
      void handle(request, response, broker, origin).catch(() => send(response, 400));
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(runtimePort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return () => {
    server.close();
    server.closeAllConnections();
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, broker: Broker, origin: string) {
  if (request.headers.host !== host + ':' + runtimePort || request.headers.origin !== origin) {
    send(response, 403);

    return;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  const route = request.url;

  if (!['/pair', '/next', '/reply', '/revoke'].includes(route ?? '')) {
    send(response, 404);

    return;
  }

  if (request.method === 'OPTIONS' && request.headers['access-control-request-method'] === 'POST') {
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    send(response, 204);

    return;
  }

  const authorization = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];

  if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json' || !authorization) {
    send(response, 403);

    return;
  }

  const value = await body(request);

  if (route === '/pair') {
    send(response, broker.pair(authorization, value) ? 204 : 403);
  } else if (route === '/reply') {
    send(response, broker.reply(authorization, value) ? 204 : 403);
  } else if (route === '/revoke') {
    send(response, broker.revoke(authorization) ? 204 : 403);
  } else {
    const next = broker.next(authorization);

    send(response, next ? 200 : 403, next);
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);

    length += chunk.length;

    if (length > 64_000) {
      throw new Error('request_too_large');
    }

    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function send(response: ServerResponse, status: number, data?: unknown): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(data === undefined ? undefined : JSON.stringify(data));
}
