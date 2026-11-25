import { z } from 'zod';

import { ledgerSchema, type Ledger } from './ledger';
import { bearer, capabilities } from './local-agent';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const deviceOperation = z.enum(['pair', 'authorize', 'status', 'finish', 'revoke']);
export type DeviceOperation = z.infer<typeof deviceOperation>;
export const deviceChallenge = z.strictObject({ challenge: z.uuid() });
export const controlByteLimit = 2_000_000;
export const cipherPayload = z.strictObject({
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  ciphertext: z
    .string()
    .min(34)
    .max(controlByteLimit * 2)
    .regex(/^[a-f0-9]+$/)
    .refine((value) => value.length % 2 === 0),
});
export const deviceMessage = deviceChallenge.extend({ operation: deviceOperation, ...cipherPayload.shape });
export type DeviceMessage = z.infer<typeof deviceMessage>;

export const replicaInfo = z.strictObject({
  revision: z.number().int().nonnegative(),
  capturedAt: z.iso.datetime({ precision: 3 }),
});
const replicaLedger = ledgerSchema.omit({ runtimeInbox: true, imports: true });

export const deviceSnapshot = replicaInfo.extend({ ledger: replicaLedger });
export type DeviceSnapshot = z.infer<typeof deviceSnapshot>;

export const deviceGrant = z
  .strictObject({
    capabilities,
    proposalKey: bearer.optional(),
    snapshot: deviceSnapshot.optional(),
  })
  .refine(
    ({ capabilities: grants, snapshot, proposalKey }) =>
      grants.includes('read-summary') === Boolean(snapshot) &&
      (grants.includes('prepare-import') || grants.includes('prepare-movement')) === Boolean(proposalKey),
  );

export function readOnlyCopy(ledger: Ledger): DeviceSnapshot['ledger'] {
  return replicaLedger.parse({
    version: ledger.version,
    accounts: ledger.accounts,
    budgets: ledger.budgets,
    movements: ledger.movements.map(({ id, movement, category }) => ({
      id,
      movement: { ...movement, note: '' },
      category,
    })),
  });
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function unhex(value: string): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(value.length / 2);

  for (let index = 0; index < result.length; index++) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return result;
}

function additionalData(message: Pick<DeviceMessage, 'operation' | 'challenge'>, direction: 'request' | 'response') {
  return encoder.encode(JSON.stringify(['nive.device-control', 1, message.operation, message.challenge, direction]));
}

/** The random pairing code is a one-use secret distinct from the long-lived per-device control key. */
export async function pairingControlKey(crypto: typeof globalThis.crypto, code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('nive.device-pairing.v1:' + code));

  return hex(new Uint8Array(digest));
}

export async function sealDeviceMessage(
  crypto: typeof globalThis.crypto,
  secret: string,
  message: Pick<DeviceMessage, 'operation' | 'challenge'>,
  direction: 'request' | 'response',
  payload: unknown,
): Promise<DeviceMessage> {
  const raw = unhex(secret);
  const clear = encoder.encode(JSON.stringify(payload));

  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const contents = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(message, direction) },
      key,
      clear,
    );

    return deviceMessage.parse({
      ...message,
      iv: hex(iv),
      ciphertext: hex(new Uint8Array(contents)),
    });
  } finally {
    raw.fill(0);
    clear.fill(0);
  }
}

export async function openDeviceMessage(
  crypto: typeof globalThis.crypto,
  secret: string,
  message: DeviceMessage,
  direction: 'request' | 'response',
): Promise<unknown> {
  const raw = unhex(secret);

  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const contents = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unhex(message.iv), additionalData: additionalData(message, direction) },
      key,
      unhex(message.ciphertext),
    );
    const clear = new Uint8Array(contents);

    try {
      return JSON.parse(decoder.decode(clear)) as unknown;
    } finally {
      clear.fill(0);
    }
  } finally {
    raw.fill(0);
  }
}
