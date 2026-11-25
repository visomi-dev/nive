import { z } from 'zod';

import { importInput } from './imports';
import { movementInput, period, summarySchema } from './ledger';

export const runtimePort = 43871;
export const runtimeUrl = 'http://127.0.0.1:' + runtimePort;
export const pairingLifetime = 5 * 60_000;
export const enrollmentLifetime = 15 * 60_000;
export const proposalLifetime = 5 * 60_000;

export const capability = z.enum(['read-summary', 'prepare-movement', 'prepare-import']);
export const capabilities = z
  .array(capability)
  .min(1)
  .max(3)
  .refine((value) => new Set(value).size === value.length);
export type Capability = z.infer<typeof capability>;

export const summaryInput = z.strictObject({ month: period });
export const preparationInput = z.strictObject({ requestId: z.uuid(), movement: movementInput });
export const runtimeCall = z.discriminatedUnion('capability', [
  z.strictObject({ capability: z.literal('prepare-import'), input: importInput }),
  z.strictObject({ capability: z.literal('read-summary'), input: summaryInput }),
  z.strictObject({ capability: z.literal('prepare-movement'), input: preparationInput }),
]);
export type RuntimeCall = z.infer<typeof runtimeCall>;

export const failure = z.enum([
  'not_enrolled',
  'permission_denied',
  'locked',
  'revoked',
  'expired',
  'unavailable',
  'busy',
  'invalid',
  'conflict',
]);
export const runtimeFailure = z.strictObject({ error: failure });
export const preparationResult = z.strictObject({
  proposalId: z.uuid(),
  status: z.enum(['pending', 'rejected', 'applied']),
});
export const runtimeSummary = summarySchema.extend({
  snapshot: z
    .strictObject({ revision: z.number().int().nonnegative(), capturedAt: z.iso.datetime({ precision: 3 }) })
    .optional(),
});
export const runtimeResult = z.union([runtimeFailure, runtimeSummary, preparationResult]);
export type RuntimeResult = z.infer<typeof runtimeResult>;

export const bearer = z.string().regex(/^[a-f0-9]{64}$/);
export const enrollment = z.strictObject({ channel: bearer, capabilities });
export const runtimeWork = z.strictObject({ id: z.uuid(), call: runtimeCall });
export const runtimeReply = z.strictObject({ id: z.uuid(), result: runtimeResult });

export function localWebOrigin(raw: string | undefined): string | undefined {
  try {
    const url = new URL(raw ?? '');

    if (url.protocol === 'http:' && url.hostname === 'localhost' && url.origin === raw) {
      return raw;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
