import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cipherPayload,
  controlByteLimit,
  deviceGrant,
  deviceSnapshot,
  enrollmentLifetime,
  inboxDecision,
  inboxLabel,
  inboxPair,
  sealedProposal,
  runtimeCall,
  summarize,
  type Capability,
  type RuntimeCall,
  type RuntimeResult,
} from '@nive/finance';
import { z } from 'zod';

const storedInbox = z.strictObject({
  id: z.uuid(),
  channelProof: z.hash('sha256'),
  keyProof: z.hash('sha256'),
  revoked: z.boolean(),
  controlKey: z.hash('sha256').optional(),
  replica: cipherPayload.optional(),
  revision: z.number().int().nonnegative().optional(),
  pending: sealedProposal.nullable(),
  decision: inboxDecision.optional(),
});

type StoredInbox = z.infer<typeof storedInbox>;

function proof(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function matches(value: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(proof(value)), Buffer.from(expected));
}

type Lease = {
  proposalKey?: Buffer;
  snapshotKey?: Buffer;
  grants: readonly Capability[];
  expiresAt: number;
  monotonicDeadline: number;
  timer: ReturnType<typeof setTimeout>;
};

function seal(key: Buffer, label: Uint8Array, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  cipher.setAAD(label);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);

  return { iv: iv.toString('hex'), ciphertext: ciphertext.toString('hex') };
}

function open(key: Buffer, label: Uint8Array, value: z.infer<typeof cipherPayload>): unknown {
  const raw = Buffer.from(value.ciphertext, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'hex'));

  decipher.setAAD(label);
  decipher.setAuthTag(raw.subarray(-16));
  const clear = Buffer.concat([decipher.update(raw.subarray(0, -16)), decipher.final()]);

  try {
    return JSON.parse(clear.toString('utf8')) as unknown;
  } finally {
    clear.fill(0);
  }
}

function replicaLabel(id: string, revision: number) {
  return new TextEncoder().encode(JSON.stringify(['nive.runtime-ledger', 1, id, revision]));
}

/** A disposable copy and an inbox. The browser remains the writer of record. */
export class RuntimeInbox {
  private readonly file: string;

  private state: StoredInbox | undefined;
  private lease: Lease | undefined;

  constructor(
    directory: string,
    private readonly now = Date.now,
  ) {
    this.file = join(directory, 'import-inbox.json');
    const file = lstatSync(this.file, { throwIfNoEntry: false });

    if (file) {
      if (
        !file.isFile() ||
        (file.mode & 0o077) !== 0 ||
        file.uid !== process.getuid?.() ||
        file.size > controlByteLimit * 2 + 130_000
      ) {
        throw new Error('private_inbox_required');
      }

      this.state = storedInbox.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    }
  }

  enrolled(): boolean {
    return Boolean(this.state && !this.state.revoked);
  }

  controlKey(): string | undefined {
    return this.state?.controlKey;
  }

  pair(value: unknown, secure = false): boolean {
    const input = inboxPair.safeParse(value);

    if (!input.success || this.enrolled()) {
      return false;
    }

    const { id, channel, keyProof } = input.data;

    this.write({
      id,
      channelProof: proof(channel),
      keyProof,
      revoked: false,
      pending: null,
      controlKey: secure ? channel : undefined,
    });

    return true;
  }

  authorize(token: string, key: string): boolean {
    return !this.controlKey() && this.authorizeDevice(token, { capabilities: ['prepare-import'], proposalKey: key });
  }

  authorizeDevice(token: string, value: unknown): boolean {
    const state = this.authenticated(token);
    const grant = deviceGrant.safeParse(value);

    if (!state || state.revoked || !grant.success) {
      return false;
    }

    const { capabilities: grants, proposalKey, snapshot } = grant.data;

    if (
      (proposalKey && !matches(proposalKey, state.keyProof)) ||
      (snapshot && snapshot.revision < (state.revision ?? 0))
    ) {
      return false;
    }

    const snapshotKey = snapshot ? randomBytes(32) : undefined;

    try {
      if (state.controlKey) {
        const replica =
          snapshot && snapshotKey
            ? seal(snapshotKey, replicaLabel(state.id, snapshot.revision), JSON.stringify(snapshot))
            : undefined;

        this.write({ ...state, replica, revision: snapshot?.revision ?? state.revision });
      }
    } catch (error) {
      snapshotKey?.fill(0);

      throw error;
    }

    this.lock();
    const timer = setTimeout(() => this.lock(), enrollmentLifetime);

    timer.unref();
    this.lease = {
      proposalKey: proposalKey ? Buffer.from(proposalKey, 'hex') : undefined,
      snapshotKey,
      grants,
      expiresAt: this.now() + enrollmentLifetime,
      monotonicDeadline: performance.now() + enrollmentLifetime,
      timer,
    };

    return true;
  }

  status(token: string): unknown {
    const state = this.authenticated(token);

    return state && !state.revoked
      ? {
          expiresAt: this.active()?.expiresAt ?? 0,
          proposal: state.decision ? null : state.pending,
        }
      : undefined;
  }

  finish(token: string, value: unknown): boolean {
    const state = this.authenticated(token);
    const decision = inboxDecision.safeParse(value);

    if (!state || state.revoked || !decision.success || state.pending?.id !== decision.data.id) {
      return false;
    }

    if (state.decision) {
      return state.decision.status === decision.data.status;
    }

    this.write({ ...state, decision: decision.data });

    return true;
  }

  revoke(token: string): boolean {
    const state = this.authenticated(token);

    if (!state) {
      return false;
    }

    this.lock();

    if (!state.revoked) {
      this.write({ ...state, revoked: true, pending: null, decision: undefined, replica: undefined });
    }

    return true;
  }

  invoke(call: RuntimeCall): RuntimeResult {
    const state = this.state;

    if (!state || state.revoked) {
      return { error: state?.revoked ? 'revoked' : 'not_enrolled' };
    }

    if (!state.controlKey && call.capability !== 'prepare-import') {
      return { error: 'permission_denied' };
    }

    const lease = this.active();

    if (!lease) {
      return { error: 'locked' };
    }

    if (!lease.grants.includes(call.capability)) {
      return { error: 'permission_denied' };
    }

    if (call.capability === 'read-summary') {
      if (!lease.snapshotKey || !state.replica || state.revision === undefined) {
        return { error: 'locked' };
      }

      const { ledger, revision, capturedAt } = deviceSnapshot.parse(
        open(lease.snapshotKey, replicaLabel(state.id, state.revision), state.replica),
      );
      const result = summarize({ ...ledger, imports: [] }, call.input.month);

      return this.active() ? { ...result, snapshot: { revision, capturedAt } } : { error: 'expired' };
    }

    const key = lease.proposalKey;

    if (!key) {
      return { error: 'locked' };
    }

    const { requestId } = call.input;
    const capability = call.capability === 'prepare-movement' ? call.capability : undefined;
    const label = inboxLabel(state.id, requestId, capability);
    const canonical = JSON.stringify(call.input);

    if (state.pending?.id === requestId) {
      if (state.pending.capability !== capability) {
        return { error: 'conflict' };
      }

      const existing = runtimeCall.parse({ capability: call.capability, input: open(key, label, state.pending) });

      if (!this.active()) {
        return { error: 'expired' };
      }

      return JSON.stringify(existing.input) === canonical
        ? { proposalId: requestId, status: state.decision?.status ?? 'pending' }
        : { error: 'conflict' };
    }

    if (state.pending && !state.decision) {
      return { error: 'busy' };
    }

    const encrypted = seal(key, label, canonical);

    if (!this.active()) {
      return { error: 'expired' };
    }

    this.write({ ...state, decision: undefined, pending: { id: requestId, capability, ...encrypted } });

    return { proposalId: requestId, status: 'pending' };
  }

  lock(): void {
    if (this.lease) {
      clearTimeout(this.lease.timer);
      this.lease.proposalKey?.fill(0);
      this.lease.snapshotKey?.fill(0);
      this.lease = undefined;
    }
  }

  private active() {
    if (this.lease && (this.now() >= this.lease.expiresAt || performance.now() >= this.lease.monotonicDeadline)) {
      this.lock();
    }

    return this.lease;
  }

  private authenticated(token: string): StoredInbox | undefined {
    return this.state && matches(token, this.state.channelProof) ? this.state : undefined;
  }

  private write(value: StoredInbox): void {
    const parsed = storedInbox.parse(value);
    const temporary = this.file + '.' + randomBytes(12).toString('hex');

    try {
      writeFileSync(temporary, JSON.stringify(parsed), { mode: 0o600, flag: 'wx', flush: true });
      renameSync(temporary, this.file);
      this.state = parsed;
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
