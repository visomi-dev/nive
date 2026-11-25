import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  importDigest,
  importInput,
  importMatches,
  reviewImport,
  type ImportBatch,
  type ImportRow,
  type ReviewedGroup,
} from './imports';
import { categorySpending, emptyLedger, ledgerSchema, summarize } from './ledger';

function fixture() {
  const account = { name: 'Test account', currency: 'MXN' as const, openingMinor: '0' };
  const bank: ImportRow = {
    source: { format: 'csv', row: 2, reference: 'TEST-1' },
    kind: 'expense',
    currency: 'MXN',
    date: '2026-10-01',
    amountMinor: '851',
    note: 'Synthetic paper',
    category: 'Stationery',
    needsReview: false,
  };
  const invoice: ImportRow = {
    ...bank,
    source: { format: 'cfdi', reference: randomUUID() },
    kind: null,
    needsReview: true,
  };
  const budgets = ['2026-11', '2026-12'].map((month) => ({
    month,
    category: 'Stationery',
    limitMinor: '900',
    basisMonths: ['2026-10'],
  }));
  const batch: ImportBatch = { requestId: randomUUID(), groups: [{ account, rows: [invoice, bank], budgets }] };
  const chargeId = randomUUID();
  const review: ReviewedGroup = {
    accountId: randomUUID(),
    account,
    budgets,
    rows: [
      { id: randomUUID(), row: { ...invoice, kind: 'expense' }, decision: { action: 'link', targetId: chargeId } },
      { id: chargeId, row: bank, decision: { action: 'post' } },
    ],
  };

  return { batch, review, bank };
}

describe('reviewed import plans', () => {
  it('links an earlier invoice to its charge, retains evidence and budgets against settled spending', async () => {
    const { batch, review, bank } = fixture();
    const before = emptyLedger();
    const digest = await importDigest(batch);
    const saved = reviewImport(before, batch, digest, [review]);

    expect(before.movements).toHaveLength(0);
    expect(saved.accounts).toHaveLength(1);
    expect(saved.movements).toHaveLength(1);
    expect(saved.movements[0].sources).toEqual([bank.source, batch.groups[0].rows[0].source]);
    expect(saved.budgets).toHaveLength(2);
    expect(categorySpending(saved, review.accountId, 'Stationery', ['2026-10'])).toBe('851');
    expect(summarize(saved, '2026-10').totals[0].expenseMinor).toBe('851');
    const reopened = ledgerSchema.parse(JSON.parse(JSON.stringify(saved)));

    expect(reviewImport(reopened, batch, digest, [review])).toBe(reopened);
    expect(() => reviewImport(reopened, batch, '1'.repeat(64), [review])).toThrow('import_conflict');
    expect(importMatches(reopened, review.accountId, bank)).toHaveLength(1);
    expect(reviewImport(reopened, { ...batch, requestId: randomUUID() }, digest, [review])).toBe(reopened);
    // A different batch which overlaps a settled reference still needs reconciliation.
    const partial = { ...batch, requestId: randomUUID(), groups: [{ ...batch.groups[0], rows: [bank], budgets: [] }] };
    const partialDigest = await importDigest(partial);

    expect(() =>
      reviewImport(reopened, partial, partialDigest, [
        { ...review, rows: [review.rows[1]], budgets: [], account: null },
      ]),
    ).toThrow('duplicate_reference');
  });

  it('rejects unknown currency, missing values, unmatched evidence and unsupported budget lines atomically', async () => {
    const { batch, review } = fixture();
    const ledger = emptyLedger();
    const digest = await importDigest(batch);

    for (const row of [
      { currency: null },
      { currency: 'EUR' as const },
      { amountMinor: null },
      { date: '2026-02-30' },
    ]) {
      const rows = review.rows.map((item) => ({ ...item, row: { ...item.row, ...row } }));

      expect(() => reviewImport(ledger, batch, digest, [{ ...review, rows }])).toThrow();
    }
    expect(() =>
      reviewImport(ledger, batch, digest, [{ ...review, budgets: [{ ...review.budgets[0], category: 'Unobserved' }] }]),
    ).toThrow();
    expect(() =>
      reviewImport(ledger, batch, digest, [
        {
          ...review,
          rows: [{ ...review.rows[0], decision: { action: 'link', targetId: randomUUID() } }, review.rows[1]],
        },
      ]),
    ).toThrow();
    expect(ledger).toEqual(emptyLedger());
  });

  it('requires bounded structured payloads and reads existing version-one vaults', () => {
    const { batch, bank } = fixture();

    expect(ledgerSchema.parse({ version: 1, accounts: [], movements: [] })).toEqual(emptyLedger());
    for (const field of ['path', 'url', 'file', 'apiKey', 'ownerId', 'approved']) {
      expect(importInput.safeParse({ ...batch, [field]: 'synthetic' }).success).toBe(false);
      expect(
        importInput.safeParse({
          ...batch,
          groups: [{ ...batch.groups[0], rows: [{ ...bank, source: { ...bank.source, [field]: 'synthetic' } }] }],
        }).success,
      ).toBe(false);
    }
    expect(
      importInput.safeParse({ ...batch, groups: [{ ...batch.groups[0], rows: Array(51).fill(bank) }] }).success,
    ).toBe(false);
  });

  it('reviews multiple accounts as one unit and permits transaction-only imports', async () => {
    const { batch, review } = fixture();
    const second = fixture();

    batch.groups.push({ ...second.batch.groups[0], budgets: [] });
    const digest = await importDigest(batch);
    const saved = reviewImport(emptyLedger(), batch, digest, [review, { ...second.review, budgets: [] }]);

    expect(saved.accounts).toHaveLength(2);
    expect(saved.movements).toHaveLength(2);
    expect(saved.budgets).toHaveLength(2);
  });
});
