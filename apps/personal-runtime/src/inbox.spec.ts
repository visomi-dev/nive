import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enrollmentLifetime, runtimeCall } from '@nive/finance';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { RuntimeInbox } from './inbox';

const marker = 'Synthetic bus ticket';
const channel = randomBytes(32).toString('hex');
const key = randomBytes(32).toString('hex');
const pair = { id: randomUUID(), channel, keyProof: createHash('sha256').update(key).digest('hex') };
const input = {
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
          note: marker,
          category: null,
          needsReview: true,
          source: { format: 'csv', row: 2 },
        },
      ],
    },
  ],
};
const prepare = (batch = input) => runtimeCall.parse({ capability: 'prepare-import', input: batch });

let dir: string;
let inbox: RuntimeInbox;
let time: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nive-inbox-'));
  time = Date.now();
  inbox = new RuntimeInbox(dir, () => time);
});

afterEach(() => {
  inbox.lock();
  rmSync(dir, { recursive: true, force: true });
});

it('binds authorization and status to the installation and limits intake after the deadline', () => {
  expect(inbox.invoke(prepare())).toEqual({ error: 'not_enrolled' });
  expect(inbox.pair(pair)).toBe(true);
  expect(inbox.pair(pair)).toBe(false);
  expect(inbox.status(key)).toBeUndefined();
  expect(inbox.authorize(channel, channel)).toBe(false);
  expect(inbox.authorize(key, key)).toBe(false);
  expect(inbox.invoke(prepare())).toEqual({ error: 'locked' });

  expect(inbox.authorize(channel, key)).toBe(true);
  expect(inbox.invoke(runtimeCall.parse({ capability: 'read-summary', input: { month: '2026-11' } }))).toEqual({
    error: 'permission_denied',
  });
  time += enrollmentLifetime;
  expect(inbox.status(channel)).toEqual({ expiresAt: 0, proposal: null });
  expect(inbox.invoke(prepare())).toEqual({ error: 'locked' });
});

it('persists only ciphertext, requires reauthorization on restart and handles a durable decision and replay', () => {
  expect(inbox.pair(pair)).toBe(true);
  expect(inbox.authorize(channel, key)).toBe(true);
  expect(inbox.invoke(prepare())).toEqual({ proposalId: input.requestId, status: 'pending' });
  expect(inbox.invoke(prepare())).toEqual({ proposalId: input.requestId, status: 'pending' });
  expect(
    inbox.invoke(
      prepare({
        ...input,
        groups: [
          {
            ...input.groups[0],
            account: {
              name: 'Synthetic checking',
              currency: 'MXN',
              openingMinor: '0',
            },
          },
        ],
      }),
    ),
  ).toEqual({ error: 'conflict' });
  expect(inbox.invoke(prepare({ ...input, requestId: randomUUID() }))).toEqual({ error: 'busy' });

  const file = join(dir, 'import-inbox.json');
  const buffer = readFileSync(file, 'utf8');

  for (const plaintext of [marker, key, channel]) {
    expect(buffer).not.toContain(plaintext);
  }
  expect(statSync(file).mode & 0o777).toBe(0o600);

  const status = inbox.status(channel) as { proposal: unknown };

  inbox.lock();
  inbox = new RuntimeInbox(dir, () => time);
  expect(inbox.invoke(prepare())).toEqual({ error: 'locked' });
  expect(inbox.status(channel)).toEqual({ expiresAt: 0, proposal: status.proposal });
  expect(inbox.finish(key, { id: input.requestId, status: 'applied' })).toBe(false);
  expect(inbox.finish(channel, { id: randomUUID(), status: 'applied' })).toBe(false);

  const decision = { id: input.requestId, status: 'applied' };

  expect(inbox.finish(channel, decision)).toBe(true);
  expect(inbox.finish(channel, decision)).toBe(true);
  expect(inbox.finish(channel, { ...decision, status: 'rejected' })).toBe(false);
  expect(inbox.status(channel)).toEqual({ expiresAt: 0, proposal: null });
  expect(inbox.authorize(channel, key)).toBe(true);
  expect(inbox.invoke(prepare())).toEqual({ proposalId: input.requestId, status: 'applied' });
});

it('revokes the lease and discards a pending proposal across restarts', () => {
  expect(inbox.pair(pair)).toBe(true);
  expect(inbox.authorize(channel, key)).toBe(true);
  expect(inbox.invoke(prepare())).toMatchObject({ status: 'pending' });
  expect(inbox.revoke(key)).toBe(false);
  expect(inbox.revoke(channel)).toBe(true);
  expect(inbox.revoke(channel)).toBe(true);
  expect(inbox.invoke(prepare())).toEqual({ error: 'revoked' });

  inbox = new RuntimeInbox(dir, () => time);
  expect(inbox.enrolled()).toBe(false);
  expect(inbox.status(channel)).toBeUndefined();
  expect(inbox.authorize(channel, key)).toBe(false);
  expect(readFileSync(join(dir, 'import-inbox.json'), 'utf8')).not.toContain('ciphertext');
});
