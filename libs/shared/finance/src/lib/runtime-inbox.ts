import { z } from 'zod';

const secret = z.string().regex(/^[a-f0-9]{64}$/);
const inboxIdentity = z.strictObject({ id: z.uuid(), channel: secret, key: secret });

export const inboxDecision = z.strictObject({ id: z.uuid(), status: z.enum(['applied', 'rejected']) });
export const inboxEnrollment = inboxIdentity.extend({
  revoked: z.boolean(),
  secureControl: z.literal(true).optional(),
  decision: inboxDecision.optional(),
});
export type InboxEnrollment = z.infer<typeof inboxEnrollment>;

export const sealedProposal = z.strictObject({
  id: z.uuid(),
  capability: z.literal('prepare-movement').optional(),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  ciphertext: z
    .string()
    .regex(/^(?:[a-f0-9]{2})+$/)
    .min(34)
    .max(128_000),
});
export const inboxState = z.strictObject({
  expiresAt: z.number().int().nonnegative(),
  proposal: sealedProposal.nullable(),
});
export const inboxLabel = (
  installationId: string,
  proposalId: string,
  variant?: 'prepare-movement',
): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(
    JSON.stringify(
      variant
        ? ['nive.runtime-inbox', 2, installationId, proposalId, variant]
        : ['nive.runtime-inbox', 1, installationId, proposalId],
    ),
  );

export const inboxPair = inboxIdentity.omit({ key: true }).extend({ keyProof: secret });
