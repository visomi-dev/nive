import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  addAccount,
  deviceChallenge,
  deviceMessage,
  emptyLedger,
  openDeviceMessage,
  pairingControlKey,
  postMovement,
  readOnlyCopy,
  runtimeUrl,
  runtimeWork,
  sealDeviceMessage,
  type DeviceOperation,
} from '@nive/finance';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

const origin = 'http://localhost:18581';

function post(route: string, token: string | null, body: unknown, webOrigin = origin) {
  return fetch(runtimeUrl + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: webOrigin,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

it('uses official stdio client and permits only authorized requests against a live local broker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nive-mcp-'));
  const path = join(dir, 'pairing-code');
  const client = new Client({ name: 'nive-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dirname, '../../../dist/apps/personal-runtime/main.mjs')],
    env: { NIVE_RUNTIME_DIR: dir, NIVE_WEB_ORIGIN: origin },
    stderr: 'pipe',
  });
  const args = { month: '2024-02' };
  const call = (name: string, parameters: Record<string, unknown>) => client.callTool({ name, arguments: parameters });

  try {
    await client.connect(transport);

    const available = await client.listTools();

    expect(available.tools.map((tool) => tool.name).sort()).toEqual([
      'nive_financial_summary',
      'nive_prepare_import',
      'nive_prepare_movement',
    ]);

    await expect(call('nive_financial_summary', args)).resolves.toMatchObject({
      structuredContent: { error: 'not_enrolled' },
    });

    await expect(call('nive_approve_movement', args)).resolves.toMatchObject({
      structuredContent: { error: 'invalid' },
    });

    const contents = await readFile(path, 'utf8');
    const code = contents.trim();
    const pairingFile = await stat(path);

    expect(pairingFile.mode & 0o777).toBe(0o600);
    const token = randomBytes(32).toString('hex');
    const pair = { channel: token, capabilities: ['read-summary'] };

    const foreign = await post('/pair', code, pair, 'http://localhost:18582');
    const paired = await post('/pair', code, pair);

    expect(foreign.status).toBe(403);
    expect(paired.status).toBe(204);

    await vi.waitFor(async () => expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' }));

    await expect(
      call('nive_prepare_movement', {
        requestId: 'bdf14bbf-1552-4a96-b95b-9b6b671f26ab',
        movement: {
          accountId: 'bdf14bbf-1552-4a96-b95b-9b6b671f26ac',
          amountMinor: '93',
          date: '2024-02-28',
          kind: 'expense',
          note: '',
        },
      }),
    ).resolves.toMatchObject({ structuredContent: { error: 'permission_denied' } });

    const batch = {
      requestId: 'bdf14bbf-1552-4a96-b95b-9b6b671f26ab',
      groups: [
        {
          account: null,
          budgets: [],
          rows: [
            {
              kind: null,
              currency: null,
              date: null,
              amountMinor: null,
              note: '',
              category: null,
              needsReview: true,
              source: { format: 'csv', row: 2 },
            },
          ],
        },
      ],
    };

    await expect(call('nive_prepare_import', batch)).resolves.toMatchObject({
      structuredContent: { error: 'permission_denied' },
    });

    await expect(call('nive_prepare_import', { ...batch, path: 'synthetic.csv' })).resolves.toMatchObject({
      structuredContent: { error: 'invalid' },
    });

    await expect(call('nive_approve_import', batch)).resolves.toMatchObject({
      structuredContent: { error: 'invalid' },
    });

    await expect(call('nive_financial_summary', { ...args, ownerId: 'synthetic-election' })).resolves.toMatchObject({
      structuredContent: { error: 'invalid' },
    });

    const next = z.object({ work: runtimeWork.nullable() });
    const running = call('nive_financial_summary', args);
    const work = await vi.waitFor(async () => {
      const response = await post('/next', token, {});
      const payload: unknown = await response.json();
      const state = next.parse(payload);

      expect(state.work).not.toBeNull();

      return state.work!;
    });

    const answer = await post('/reply', token, { id: work.id, result: { error: 'locked' } });

    expect(answer.status).toBe(204);

    await expect(running).resolves.toMatchObject({ structuredContent: { error: 'locked' } });

    const revoked = await post('/revoke', token, {});

    expect(revoked.status).toBe(204);

    await expect(call('nive_financial_summary', args)).resolves.toMatchObject({
      structuredContent: { error: 'revoked' },
    });
  } finally {
    await client.close();

    await rm(dir, { recursive: true, force: true });
  }
});

it('persists an import over official stdio and restores its ciphertext after restarting the process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nive-mcp-inbox-'));
  const channel = randomBytes(32).toString('hex');
  const key = randomBytes(32).toString('hex');
  const pair = { id: randomUUID(), channel, keyProof: createHash('sha256').update(key).digest('hex') };
  const batch = {
    requestId: randomUUID(),
    groups: [
      {
        account: null,
        budgets: [],
        rows: [
          {
            kind: 'expense',
            currency: 'MXN',
            date: '2026-11-18',
            amountMinor: '900',
            note: 'Synthetic station cafe',
            category: null,
            needsReview: true,
            source: { format: 'csv', row: 2 },
          },
        ],
      },
    ],
  };
  const connect = async () => {
    const client = new Client({ name: 'nive-inbox-test', version: '1.0.0' });

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve(import.meta.dirname, '../../../dist/apps/personal-runtime/main.mjs')],
        env: { NIVE_RUNTIME_DIR: dir, NIVE_WEB_ORIGIN: origin },
        stderr: 'pipe',
      }),
    );

    return client;
  };

  let client: Client | undefined;

  try {
    const started = await connect();

    client = started;
    const pairingFile = await readFile(join(dir, 'pairing-code'), 'utf8');
    const code = pairingFile.trim();
    const badOrigin = await post('/inbox/pair', code, pair, 'http://localhost:18582');
    const paired = await post('/inbox/pair', code, pair);
    const repeatedCode = await post('/inbox/pair', code, pair);

    expect(badOrigin.status).toBe(403);
    expect(paired.status).toBe(204);
    expect(repeatedCode.status).toBe(403);

    await expect(client.callTool({ name: 'nive_prepare_import', arguments: batch })).resolves.toMatchObject({
      structuredContent: { error: 'locked' },
    });

    const granted = await post('/inbox/authorize', channel, key);

    expect(granted.status).toBe(204);

    await expect(
      client.callTool({ name: 'nive_financial_summary', arguments: { month: '2026-11' } }),
    ).resolves.toMatchObject({
      structuredContent: { error: 'permission_denied' },
    });

    await expect(client.callTool({ name: 'nive_prepare_import', arguments: batch })).resolves.toMatchObject({
      structuredContent: { proposalId: batch.requestId, status: 'pending' },
    });

    await expect(client.callTool({ name: 'nive_approve_import', arguments: batch })).resolves.toMatchObject({
      structuredContent: { error: 'invalid' },
    });

    await client.close();

    const restarted = await connect();

    client = restarted;

    await expect(client.callTool({ name: 'nive_prepare_import', arguments: batch })).resolves.toMatchObject({
      structuredContent: { error: 'locked' },
    });

    const status = await post('/inbox/status', channel, {});
    const payload: unknown = await status.json();

    expect(payload).toMatchObject({ expiresAt: 0, proposal: { id: batch.requestId } });
    expect(JSON.stringify(payload)).not.toContain('Synthetic station cafe');

    const rejected = await post('/inbox/finish', channel, { id: batch.requestId, status: 'rejected' });
    const reauthorized = await post('/inbox/authorize', channel, key);

    expect(rejected.status).toBe(204);
    expect(reauthorized.status).toBe(204);

    await expect(client.callTool({ name: 'nive_prepare_import', arguments: batch })).resolves.toMatchObject({
      structuredContent: { proposalId: batch.requestId, status: 'rejected' },
    });

    const revoked = await post('/inbox/revoke', channel, {});

    expect(revoked.status).toBe(204);

    await expect(client.callTool({ name: 'nive_prepare_import', arguments: batch })).resolves.toMatchObject({
      structuredContent: { error: 'revoked' },
    });
  } finally {
    await client?.close();

    await rm(dir, { recursive: true, force: true });
  }
});

it('authenticates a local device and separates copied-ledger reads from durable draft intake', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nive-mcp-device-'));
  const agent = new Client({ name: 'nive-device-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dirname, '../../../dist/apps/personal-runtime/main.mjs')],
    env: { NIVE_RUNTIME_DIR: dir, NIVE_WEB_ORIGIN: origin },
    stderr: 'pipe',
  });
  const id = randomUUID();
  const requestId = randomUUID();
  const accountId = randomUUID();
  const channel = randomBytes(32).toString('hex');
  const proposalKey = randomBytes(32).toString('hex');
  const account = addAccount(emptyLedger(), accountId, {
    name: 'Synthetic encrypted account',
    currency: 'MXN',
    openingMinor: '10000',
  });
  const ledger = postMovement(account, randomUUID(), {
    accountId,
    kind: 'expense',
    amountMinor: '2500',
    date: '2026-11-09',
    note: 'Synthetic note excluded from copy',
  });
  const snapshot = { revision: 4, capturedAt: '2026-11-25T20:00:00.000Z', ledger: readOnlyCopy(ledger) };
  const draft = {
    requestId,
    movement: {
      accountId,
      kind: 'expense',
      amountMinor: '193',
      date: '2026-11-10',
      note: 'Synthetic movement proposal',
    },
  };
  const call = (name: string, args: Record<string, unknown>) => agent.callTool({ name, arguments: args });
  const summary = () => call('nive_financial_summary', { month: '2026-11' });

  async function prepare(operation: DeviceOperation, key: string, value: unknown) {
    const offered = await post('/device/challenge', null, {});
    const data: unknown = await offered.json();
    const challenge = deviceChallenge.parse(data);

    return sealDeviceMessage(crypto, key, { operation, ...challenge }, 'request', value);
  }

  async function exchange(operation: DeviceOperation, key: string, value: unknown) {
    const wire = await prepare(operation, key, value);
    const answer = await post('/device/control', null, wire);

    expect(answer.status).toBe(200);
    const response: unknown = await answer.json();

    expect(response).toMatchObject({ challenge: wire.challenge, operation: wire.operation });

    const clear = await openDeviceMessage(crypto, key, deviceMessage.parse(response), 'response');

    return { wire, answer: clear };
  }

  try {
    await agent.connect(transport);

    const code = await readFile(join(dir, 'pairing-code'), 'utf8');
    const pairingKey = await pairingControlKey(crypto, code.trim());
    const pair = { id, channel, keyProof: createHash('sha256').update(proposalKey).digest('hex') };
    const wrong = await prepare('pair', channel, pair);
    const rejected = await post('/device/control', null, wrong);

    expect(rejected.status).toBe(400);

    const { wire, answer } = await exchange('pair', pairingKey, pair);

    expect(answer).toEqual({ ok: true });
    const repeated = await post('/device/control', null, wire);

    expect(repeated.status).toBe(403);
    const downgrade = await post('/inbox/authorize', channel, proposalKey);

    expect(downgrade.status).toBe(403);

    await expect(
      exchange('authorize', channel, { capabilities: ['prepare-movement'], proposalKey, snapshot }),
    ).resolves.toMatchObject({ answer: { ok: false } });

    await expect(exchange('authorize', channel, { capabilities: ['read-summary'], snapshot })).resolves.toMatchObject({
      answer: { ok: true },
    });

    await expect(summary()).resolves.toMatchObject({
      structuredContent: {
        snapshot: { revision: 4, capturedAt: snapshot.capturedAt },
        accounts: [{ id: accountId, balanceMinor: '7500' }],
        totals: [{ currency: 'MXN', expenseMinor: '2500' }],
      },
    });

    await expect(call('nive_prepare_movement', draft)).resolves.toMatchObject({
      structuredContent: { error: 'permission_denied' },
    });

    await expect(
      exchange('authorize', channel, {
        capabilities: ['read-summary'],
        snapshot: { ...snapshot, revision: 3 },
      }),
    ).resolves.toMatchObject({ answer: { ok: false } });

    const stored = await readFile(join(dir, 'import-inbox.json'), 'utf8');

    expect(stored).toContain('"replica"');
    expect(stored).not.toContain('Synthetic');
    expect(stored).not.toContain(proposalKey);
    expect(JSON.stringify(snapshot.ledger)).not.toContain('Synthetic note excluded from copy');

    await expect(
      exchange('authorize', channel, { capabilities: ['prepare-movement'], proposalKey }),
    ).resolves.toMatchObject({ answer: { ok: true } });

    await expect(summary()).resolves.toMatchObject({ structuredContent: { error: 'permission_denied' } });

    await expect(call('nive_prepare_movement', draft)).resolves.toMatchObject({
      structuredContent: { proposalId: requestId, status: 'pending' },
    });

    await expect(
      call('nive_prepare_movement', { ...draft, movement: { ...draft.movement, amountMinor: '194' } }),
    ).resolves.toMatchObject({ structuredContent: { error: 'conflict' } });

    await expect(call('nive_approve_movement', draft)).resolves.toMatchObject({
      structuredContent: { error: 'invalid' },
    });

    const current = await exchange('status', channel, {});

    expect(current.answer).toMatchObject({ proposal: { id: requestId, capability: 'prepare-movement' } });
    expect(JSON.stringify(current.answer)).not.toContain(draft.movement.note);

    await expect(exchange('revoke', channel, {})).resolves.toMatchObject({ answer: { ok: true } });

    await expect(call('nive_prepare_movement', draft)).resolves.toMatchObject({
      structuredContent: { error: 'revoked' },
    });
  } finally {
    await agent.close();

    await rm(dir, { recursive: true, force: true });
  }
});
