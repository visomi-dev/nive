import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  enrollmentLifetime,
  importInput,
  inboxDecision,
  inboxLabel,
  inboxPair,
  sealedProposal,
  type RuntimeCall,
  type RuntimeResult,
} from '@nive/finance';
import { z } from 'zod';

const storedInbox = z.strictObject({
  id: z.uuid(),
  channelProof: z.hash('sha256'),
  keyProof: z.hash('sha256'),
  revoked: z.boolean(),
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

/** One authenticated inbox per runtime directory. Only the active process holds an inbox key. */
export class RuntimeInbox {
  private readonly file: string;

  private state: StoredInbox | undefined;
  private lease:
    { key: Buffer; expiresAt: number; monotonicDeadline: number; timer: ReturnType<typeof setTimeout> } | undefined;

  constructor(
    directory: string,
    private readonly now = Date.now,
  ) {
    this.file = join(directory, 'import-inbox.json');
    const file = lstatSync(this.file, { throwIfNoEntry: false });

    if (file) {
      if (!file.isFile() || (file.mode & 0o077) !== 0 || file.uid !== process.getuid?.() || file.size > 130_000) {
        throw new Error('private_inbox_required');
      }

      this.state = storedInbox.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    }
  }

  enrolled(): boolean {
    return Boolean(this.state && !this.state.revoked);
  }

  pair(value: unknown): boolean {
    const input = inboxPair.safeParse(value);

    if (!input.success || this.enrolled()) {
      return false;
    }

    const { id, channel, keyProof } = input.data;

    this.write({ id, channelProof: proof(channel), keyProof, revoked: false, pending: null });

    return true;
  }

  authorize(token: string, key: string): boolean {
    const state = this.authenticated(token);

    if (!state || state.revoked || !matches(key, state.keyProof)) {
      return false;
    }

    this.lock();
    const timer = setTimeout(() => this.lock(), enrollmentLifetime);

    timer.unref();
    this.lease = {
      key: Buffer.from(key, 'hex'),
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
      this.write({ ...state, revoked: true, pending: null, decision: undefined });
    }

    return true;
  }

  invoke(call: RuntimeCall): RuntimeResult {
    const state = this.state;

    if (!state || state.revoked) {
      return { error: state?.revoked ? 'revoked' : 'not_enrolled' };
    }

    if (call.capability !== 'prepare-import') {
      return { error: 'permission_denied' };
    }

    const lease = this.active();

    if (!lease) {
      return { error: 'locked' };
    }

    const { requestId } = call.input;
    const canonical = JSON.stringify(call.input);

    if (state.pending?.id === requestId) {
      const raw = Buffer.from(state.pending.ciphertext, 'hex');
      const decipher = createDecipheriv('aes-256-gcm', lease.key, Buffer.from(state.pending.iv, 'hex'));

      decipher.setAAD(inboxLabel(state.id, requestId));
      decipher.setAuthTag(raw.subarray(-16));
      const clear = Buffer.concat([decipher.update(raw.subarray(0, -16)), decipher.final()]);

      try {
        const existing = importInput.parse(JSON.parse(clear.toString('utf8')));

        return JSON.stringify(existing) === canonical
          ? { proposalId: requestId, status: state.decision?.status ?? 'pending' }
          : { error: 'conflict' };
      } finally {
        clear.fill(0);
      }
    }

    if (state.pending && !state.decision) {
      return { error: 'busy' };
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', lease.key, iv);

    cipher.setAAD(inboxLabel(state.id, requestId));
    const ciphertext = Buffer.concat([cipher.update(canonical, 'utf8'), cipher.final(), cipher.getAuthTag()]);

    if (!this.active()) {
      return { error: 'expired' };
    }

    this.write({
      ...state,
      decision: undefined,
      pending: {
        id: requestId,
        iv: iv.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
      },
    });

    return { proposalId: requestId, status: 'pending' };
  }

  lock(): void {
    if (this.lease) {
      clearTimeout(this.lease.timer);
      this.lease.key.fill(0);
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
