import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { bearer, controlByteLimit, runtimePort } from '@nive/finance';

import type { Broker } from './broker';
import { DeviceControl } from './device-control';
import type { RuntimeInbox } from './inbox';

const host = '127.0.0.1';

export async function startLoopback(broker: Broker, origin: string, code: string, openInbox: () => RuntimeInbox) {
  let inbox: RuntimeInbox;
  let control: DeviceControl;
  const server = createServer(
    { requestTimeout: 6000, headersTimeout: 4000, keepAliveTimeout: 1000 },
    (request, response) => {
      void handle(request, response, broker, inbox, control, origin).catch(() => send(response, 400));
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(runtimePort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const stop = () => {
    server.close();
    server.closeAllConnections();
  };

  try {
    // The listener owns the port before loading durable state.
    inbox = openInbox();
    control = new DeviceControl(broker, inbox, code);

    return { inbox, stop };
  } catch (error) {
    stop();

    throw error;
  }
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  broker: Broker,
  inbox: RuntimeInbox,
  control: DeviceControl,
  origin: string,
) {
  if (request.headers.host !== host + ':' + runtimePort || request.headers.origin !== origin) {
    send(response, 403);

    return;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  const route = request.url;

  if (
    ![
      '/device/challenge',
      '/device/control',
      '/pair',
      '/next',
      '/reply',
      '/revoke',
      '/inbox/pair',
      '/inbox/authorize',
      '/inbox/status',
      '/inbox/finish',
      '/inbox/revoke',
    ].includes(route ?? '')
  ) {
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

  if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
    send(response, 403);

    return;
  }

  if (route === '/device/challenge') {
    const value = await body(request, 64);

    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0) {
      send(response, 400);

      return;
    }

    send(response, 200, control.issue());

    return;
  }

  if (route === '/device/control') {
    const value = await body(request, controlByteLimit * 2 + 256);
    const answer = await control.exchange(value);

    send(response, answer ? 200 : 403, answer);

    return;
  }

  const authorization = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];

  if (!authorization || (route?.startsWith('/inbox/') && inbox.controlKey())) {
    send(response, 403);

    return;
  }

  const value = await body(request, 64_000);

  if (route === '/pair') {
    send(response, !inbox.enrolled() && broker.pair(authorization, value) ? 204 : 403);
  } else if (route === '/inbox/pair') {
    if (broker.canPair(authorization) && inbox.pair(value)) {
      broker.expirePairing();
      send(response, 204);
    } else {
      send(response, 403);
    }
  } else if (route === '/inbox/authorize') {
    const key = bearer.safeParse(value);

    send(response, key.success && inbox.authorize(authorization, key.data) ? 204 : 403);
  } else if (route === '/inbox/status') {
    const status = inbox.status(authorization);

    send(response, status ? 200 : 403, status);
  } else if (route === '/inbox/revoke') {
    if (inbox.revoke(authorization)) {
      broker.close();
      send(response, 204);
    } else {
      send(response, 403);
    }
  } else if (route === '/inbox/finish') {
    send(response, inbox.finish(authorization, value) ? 204 : 403);
  } else if (route === '/reply') {
    send(response, broker.reply(authorization, value) ? 204 : 403);
  } else if (route === '/revoke') {
    send(response, broker.revoke(authorization) ? 204 : 403);
  } else {
    const next = broker.next(authorization);

    send(response, next ? 200 : 403, next);
  }
}

async function body(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);

    length += chunk.length;

    if (length > limit) {
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
