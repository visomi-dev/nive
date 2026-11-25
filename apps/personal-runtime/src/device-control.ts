import {
  deviceMessage,
  openDeviceMessage,
  pairingControlKey,
  sealDeviceMessage,
  type DeviceOperation,
} from '@nive/finance';

import type { Broker } from './broker';
import type { RuntimeInbox } from './inbox';

const challengeLifetime = 10_000;
const challengeLimit = 64;

/** Authenticates both ends of a browser request without sending the code or any key over bare loopback. */
export class DeviceControl {
  private readonly challenges = new Map<string, number>();

  constructor(
    private readonly broker: Broker,
    private readonly inbox: RuntimeInbox,
    private code: string | undefined,
  ) {}

  issue(): { challenge: string } {
    const now = performance.now();

    for (const [id, deadline] of this.challenges) {
      if (deadline <= now || this.challenges.size >= challengeLimit) {
        this.challenges.delete(id);
      }
    }

    const challenge = crypto.randomUUID();

    this.challenges.set(challenge, now + challengeLifetime);

    return { challenge };
  }

  async exchange(value: unknown): Promise<unknown> {
    const parsed = deviceMessage.safeParse(value);

    if (!parsed.success) {
      return;
    }

    const message = parsed.data;
    const deadline = this.challenges.get(message.challenge);

    if (deadline === undefined || !this.challenges.delete(message.challenge) || deadline <= performance.now()) {
      return;
    }

    const key = await this.keyFor(message.operation);

    if (!key) {
      return;
    }

    const input = await openDeviceMessage(crypto, key, message, 'request');

    if (deadline <= performance.now()) {
      return;
    }

    const answer = this.run(message.operation, key, input);

    return answer === undefined ? undefined : sealDeviceMessage(crypto, key, message, 'response', answer);
  }

  private async keyFor(operation: DeviceOperation): Promise<string | undefined> {
    if (operation !== 'pair') {
      return this.inbox.controlKey();
    }

    return this.code && this.broker.canPair(this.code) ? pairingControlKey(crypto, this.code) : undefined;
  }

  private run(operation: DeviceOperation, key: string, value: unknown): unknown {
    switch (operation) {
      case 'pair':
        if (this.code && this.broker.canPair(this.code) && this.inbox.pair(value, true)) {
          this.code = undefined;
          this.broker.expirePairing();

          return { ok: true };
        }

        return;
      case 'authorize':
        return { ok: this.inbox.authorizeDevice(key, value) };
      case 'status':
        return this.inbox.status(key) ?? { revoked: true };
      case 'finish':
        return { ok: this.inbox.finish(key, value) };
      case 'revoke': {
        const revoked = this.inbox.revoke(key);

        if (revoked) {
          this.broker.close();
        }

        return { ok: revoked };
      }
    }
  }
}
