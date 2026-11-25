import { z } from 'zod';

import {
  accountInput,
  addAccount,
  budgetLine,
  currency,
  importSource,
  ledgerSchema,
  movementInput,
  periodBudget,
  positiveMinor,
  postMovement,
  type ImportSource,
  type Ledger,
} from './ledger';

export const importRow = z.strictObject({
  source: importSource,
  kind: z.enum(['expense', 'income']).nullable(),
  date: z.iso.date().nullable(),
  currency: currency.nullable(),
  amountMinor: positiveMinor.nullable(),
  note: z.string().trim().max(140),
  category: z.string().trim().min(1).max(80).nullable(),
  needsReview: z.boolean(),
});
export type ImportRow = z.infer<typeof importRow>;

export const importGroup = z.strictObject({
  account: z
    .union([
      z.strictObject({ id: z.uuid() }),
      z.strictObject({
        name: accountInput.shape.name.nullable(),
        currency: currency.nullable(),
        openingMinor: accountInput.shape.openingMinor.nullable(),
      }),
    ])
    .nullable(),
  rows: z.array(importRow).min(1).max(50),
  budgets: z.array(budgetLine).max(36),
});
export type ImportGroup = z.infer<typeof importGroup>;
export const importInput = z
  .strictObject({
    requestId: z.uuid(),
    groups: z.array(importGroup).min(1).max(8),
  })
  .refine((batch) => batch.groups.reduce((sum, group) => sum + group.rows.length, 0) <= 50);
export type ImportBatch = z.infer<typeof importInput>;

export async function importDigest(batch: ImportBatch): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(importInput.parse(batch).groups));
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameReference(left: ImportSource, right: ImportSource): boolean {
  return Boolean(
    left.reference &&
    left.reference.toLowerCase() === right.reference?.toLowerCase() &&
    (left.format === 'cfdi') === (right.format === 'cfdi'),
  );
}

export function importMatches(ledger: Ledger, accountId: string, row: ImportRow) {
  return ledger.movements.filter(
    ({ movement, sources }) =>
      movement.accountId === accountId &&
      (sources?.some((source) => sameReference(source, row.source)) ||
        (movement.kind !== 'transfer' && movement.amountMinor === row.amountMinor && movement.date === row.date)),
  );
}

export type ImportDecision = { action: 'post' | 'skip' | 'link'; targetId?: string };
export type ReviewedRow = { id: string; row: ImportRow; decision: ImportDecision };

export type ReviewedGroup = {
  accountId: string;
  account: z.infer<typeof accountInput> | null;
  rows: ReviewedRow[];
  budgets: ImportGroup['budgets'];
};

export function reviewImport(ledger: Ledger, batch: ImportBatch, digest: string, groups: ReviewedGroup[]): Ledger {
  const previous = ledger.imports.find((receipt) => receipt.id === batch.requestId);

  if (previous) {
    if (previous.digest !== digest) {
      throw new Error('import_conflict');
    }

    return ledger;
  }

  if (ledger.imports.some((item) => item.digest === digest)) {
    return ledger;
  }

  if (groups.length !== batch.groups.length || new Set(groups.map((group) => group.accountId)).size !== groups.length) {
    throw new Error('account_conflict');
  }

  const reviewed = groups.reduce((next, group, index) => reviewGroup(next, batch.groups[index], group), ledger);

  return ledgerSchema.parse({ ...reviewed, imports: [...ledger.imports, { id: batch.requestId, digest }] });
}

export function reviewGroup(ledger: Ledger, batch: ImportGroup, group: ReviewedGroup): Ledger {
  const { accountId, account, rows, budgets } = group;
  let next = account ? addAccount(ledger, accountId, account) : ledger;
  const destination = next.accounts.find(({ id }) => id === accountId);

  if (!destination || rows.length !== batch.rows.length) {
    throw new Error('account_missing');
  }

  // Resolve posted rows first so an invoice may precede its bank charge in the attachments.
  const ordered = [...rows.entries()].sort(
    ([, left], [, right]) => Number(left.decision.action === 'link') - Number(right.decision.action === 'link'),
  );

  for (const [index, { id, row, decision }] of ordered) {
    if (decision.action === 'skip') {
      continue;
    }

    const source = batch.rows[index].source;

    if (row.currency !== destination.currency) {
      throw new Error('currency_mismatch');
    }

    const movement = movementInput.parse({
      kind: row.kind,
      accountId,
      amountMinor: row.amountMinor,
      date: row.date,
      note: row.note,
    });
    const existing = next.movements.find(
      (entry) => entry.movement.accountId === accountId && entry.sources?.some((other) => sameReference(other, source)),
    );

    if (existing && (decision.action !== 'link' || existing.id !== decision.targetId)) {
      throw new Error('duplicate_reference');
    }

    if (decision.action === 'post') {
      next = postMovement(next, id, movement);
    }

    const targetId = decision.action === 'link' ? decision.targetId : id;
    const target = next.movements.find((entry) => entry.id === targetId);

    if (
      !target ||
      target.movement.accountId !== accountId ||
      target.movement.kind !== movement.kind ||
      target.movement.amountMinor !== movement.amountMinor
    ) {
      throw new Error('match_invalid');
    }

    const sources = target.sources ?? [];

    if (decision.action === 'link' && row.category && target.category && row.category !== target.category) {
      throw new Error('category_conflict');
    }

    const linked = sources.some((item) => JSON.stringify(item) === JSON.stringify(source));

    if (!linked || (!target.category && row.category)) {
      const updated = {
        ...target,
        ...(row.category ? { category: row.category } : {}),
        sources: linked ? sources : [...sources, source],
      };

      next = { ...next, movements: next.movements.map((entry) => (entry === target ? updated : entry)) };
    }
  }

  const seen = new Set<string>();

  for (const budget of budgets) {
    const value = periodBudget.parse({ ...budget, accountId });
    const key = JSON.stringify([value.month, value.category]);

    if (
      seen.has(key) ||
      value.basisMonths.some((month) => month >= value.month) ||
      new Set(value.basisMonths).size !== value.basisMonths.length ||
      !next.movements.some(
        ({ movement, category }) =>
          movement.accountId === accountId &&
          movement.kind === 'expense' &&
          category === value.category &&
          value.basisMonths.includes(movement.date.slice(0, 7)),
      )
    ) {
      throw new Error('budget_basis_invalid');
    }

    seen.add(key);
    next = {
      ...next,
      budgets: [
        ...next.budgets.filter(
          (item) => item.accountId !== accountId || item.month !== value.month || item.category !== value.category,
        ),
        value,
      ],
    };
  }

  return ledgerSchema.parse(next);
}
