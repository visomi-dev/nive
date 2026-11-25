import { randomUUID, timingSafeEqual } from 'node:crypto';

import {
  bearer,
  enrollment,
  enrollmentLifetime,
  pairingLifetime,
  preparationResult,
  runtimeFailure,
  runtimeReply,
  summarySchema,
  type Capability,
  type RuntimeCall,
  type RuntimeResult,
} from '@nive/finance';

const callLifetime = 4500;

type Channel = {
  token: string;
  grants: readonly Capability[];
  expiresAt: number;
};
type Pending = {
  id: string;
  call: RuntimeCall;
  delivered: boolean;
  finish: (result: RuntimeResult) => void;
};

function matches(secret: string, received: string): boolean {
  return bearer.safeParse(received).success && timingSafeEqual(Buffer.from(secret), Buffer.from(received));
}

export class Broker {
  private readonly pairUntil: number;

  private channel?: Channel;
  private pending?: Pending;
  private ended?: 'revoked' | 'expired';

  constructor(
    private pairingCode: string | undefined,
    private readonly removePairing: () => void,
    private readonly now = Date.now,
  ) {
    this.pairUntil = now() + pairingLifetime;
  }

  pair(authorization: string, input: unknown): boolean {
    const parsed = enrollment.safeParse(input);

    if (!parsed.success || !this.canPair(authorization)) {
      return false;
    }

    this.forgetPairing();
    this.channel = {
      token: parsed.data.channel,
      grants: parsed.data.capabilities,
      expiresAt: this.now() + enrollmentLifetime,
    };

    return true;
  }

  canPair(authorization: string): boolean {
    return Boolean(
      !this.ended &&
      !this.channel &&
      this.pairingCode &&
      this.now() < this.pairUntil &&
      matches(this.pairingCode, authorization),
    );
  }

  async invoke(call: RuntimeCall): Promise<RuntimeResult> {
    const channel = this.active();

    if (!channel) {
      return { error: this.ended ?? (this.now() >= this.pairUntil ? 'expired' : 'not_enrolled') };
    }

    if (!channel.grants.includes(call.capability)) {
      return { error: 'permission_denied' };
    }

    if (this.pending) {
      return { error: 'busy' };
    }

    return new Promise((resolve) => {
      const id = randomUUID();
      const timeout = setTimeout(() => finish({ error: 'unavailable' }), callLifetime);
      const finish = (result: RuntimeResult) => {
        clearTimeout(timeout);
        this.pending = undefined;
        resolve(result);
      };

      this.pending = { id, call, delivered: false, finish };
    });
  }

  next(token: string): unknown {
    const channel = this.active();

    if (!channel || !matches(channel.token, token)) {
      return undefined;
    }

    const pending = this.pending;

    if (!pending || pending.delivered) {
      return { expiresAt: channel.expiresAt, work: null };
    }

    pending.delivered = true;

    return { expiresAt: channel.expiresAt, work: { id: pending.id, call: pending.call } };
  }

  reply(token: string, input: unknown): boolean {
    const channel = this.active();
    const pending = this.pending;
    const parsed = runtimeReply.safeParse(input);

    if (
      !channel ||
      !matches(channel.token, token) ||
      !pending?.delivered ||
      !parsed.success ||
      parsed.data.id !== pending.id
    ) {
      return false;
    }

    const safeFailure = runtimeFailure.safeParse(parsed.data.result);

    if (safeFailure.success) {
      pending.finish(safeFailure.data);

      return true;
    }

    const call = pending.call;

    if (call.capability === 'read-summary') {
      const summary = summarySchema.safeParse(parsed.data.result);

      if (!summary.success || summary.data.month !== call.input.month) {
        return false;
      }

      pending.finish(summary.data);
    } else {
      const result = preparationResult.safeParse(parsed.data.result);

      if (!result.success || result.data.proposalId !== call.input.requestId) {
        return false;
      }

      pending.finish(result.data);
    }

    return true;
  }

  revoke(token: string): boolean {
    const channel = this.active();

    if (!channel || !matches(channel.token, token)) {
      return false;
    }

    this.end('revoked');

    return true;
  }

  expirePairing(): void {
    this.forgetPairing();
  }

  close(): void {
    this.forgetPairing();
    this.end('revoked');
  }

  private active(): Channel | undefined {
    if (this.channel && this.now() >= this.channel.expiresAt) {
      this.end('expired');
    }

    return this.channel;
  }

  private end(reason: 'revoked' | 'expired'): void {
    this.ended = reason;
    this.channel = undefined;
    this.pending?.finish({ error: reason });
  }

  private forgetPairing(): void {
    if (this.pairingCode) {
      this.pairingCode = undefined;
      this.removePairing();
    }
  }
}
