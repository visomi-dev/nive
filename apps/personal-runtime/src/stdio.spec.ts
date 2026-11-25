import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runtimeUrl, runtimeWork } from '@nive/finance';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

const origin = 'http://localhost:18581';

function post(route: string, token: string, body: unknown, webOrigin = origin) {
  return fetch(runtimeUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: webOrigin, Authorization: 'Bearer ' + token },
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
