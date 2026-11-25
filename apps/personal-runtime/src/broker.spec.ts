import { enrollmentLifetime, pairingLifetime } from '@nive/finance';
import { expect, it, vi } from 'vitest';

import { Broker } from './broker';

const code = 'a'.repeat(64);
const token = 'b'.repeat(64);
const grant = { channel: token, capabilities: ['read-summary'] };
const query = { capability: 'read-summary', input: { month: '2024-02' } } as const;

it('consumes one pairing proof and denies after expiration, including work already delivered', async () => {
  let now = 0;
  const remove = vi.fn();
  const broker = new Broker(code, remove, () => now);

  expect(broker.pair(token, grant)).toBe(false);
  expect(broker.pair(code, { ...grant, capabilities: ['approve'] })).toBe(false);
  expect(broker.pair(code, grant)).toBe(true);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(broker.pair(code, grant)).toBe(false);

  const running = broker.invoke(query);

  expect(broker.next(code)).toBeUndefined();
  expect(broker.next(token)).toMatchObject({ work: { call: query } });
  now += enrollmentLifetime;
  expect(broker.next(token)).toBeUndefined();

  await expect(running).resolves.toEqual({ error: 'expired' });

  await expect(broker.invoke(query)).resolves.toEqual({ error: 'expired' });
});

it('denies a stale pairing code and fails closed after revocation', async () => {
  const stale = new Broker(
    code,
    () => undefined,
    () => 0,
  );

  stale.expirePairing();
  expect(stale.pair(code, grant)).toBe(false);

  let now = 0;
  const broker = new Broker(
    code,
    () => undefined,
    () => now,
  );

  now = pairingLifetime;
  expect(broker.pair(code, grant)).toBe(false);

  const live = new Broker(code, () => undefined);

  expect(live.pair(code, grant)).toBe(true);
  const running = live.invoke(query);

  expect(live.revoke(code)).toBe(false);
  expect(live.revoke(token)).toBe(true);

  await expect(running).resolves.toEqual({ error: 'revoked' });

  await expect(live.invoke(query)).resolves.toEqual({ error: 'revoked' });
});
