import { describe, expect, it } from 'vitest';

import {
  addAccount,
  emptyLedger,
  formatMoney,
  parseMoney,
  postMovement,
  summarize,
  type MovementInput,
} from './ledger';

const first = '8010c7b7-d62f-4471-8163-c208e75666d1';
const second = '8010c7b7-d62f-4471-8163-c208e75666d2';
const third = '8010c7b7-d62f-4471-8163-c208e75666d3';
const movementId = 'd64e561b-2dd7-4efb-b251-6afdf7c1b623';
const incomeId = 'd64e561b-2dd7-4efb-b251-6afdf7c1b624';
const transferId = 'd64e561b-2dd7-4efb-b251-6afdf7c1b625';
const opening = { name: 'Synthetic account', currency: 'MXN', openingMinor: '9007199254740993' } as const;
const movement = {
  accountId: first,
  kind: 'expense',
  amountMinor: '24',
  date: '2024-02-29',
  note: 'Synthetic record',
} satisfies MovementInput;

describe('personal ledger', () => {
  it('parses and formats exact amounts with currency precision', () => {
    expect(parseMoney('90071992547409.93', 'MXN')).toBe('9007199254740993');
    expect(formatMoney('-9007199254740993', 'MXN')).toBe('-90071992547409.93');
    expect(parseMoney('-0.000', 'KWD')).toBe('0');
    expect(parseMoney('0.001', 'KWD')).toBe('1');
    expect(() => parseMoney('0.1', 'JPY')).toThrow();
    expect(() => parseMoney('1e5', 'MXN')).toThrow();
  });

  it('counts income and expenses in the chosen month and excludes transfers', () => {
    let ledger = addAccount(emptyLedger(), first, opening);

    ledger = addAccount(ledger, second, { ...opening, openingMinor: '0' });
    ledger = postMovement(ledger, movementId, movement);
    ledger = postMovement(ledger, incomeId, { ...movement, kind: 'income', amountMinor: '13', date: '2024-03-01' });
    ledger = postMovement(ledger, transferId, {
      ...movement,
      kind: 'transfer',
      destinationId: second,
      amountMinor: '7',
    });

    const summary = summarize(ledger, '2024-02');

    expect(summary.accounts.map((account) => account.balanceMinor)).toEqual(['9007199254740975', '7']);
    expect(summary.totals).toEqual([{ currency: 'MXN', incomeMinor: '0', expenseMinor: '24' }]);
    expect(summarize(ledger, '2024-03').totals[0]?.incomeMinor).toBe('13');
  });

  it('rejects an invalid date, an account outside the workspace, and cross-currency transfers', () => {
    let ledger = addAccount(emptyLedger(), first, opening);

    ledger = addAccount(ledger, second, { ...opening, currency: 'USD', openingMinor: '0' });

    expect(() => postMovement(ledger, movementId, { ...movement, date: '2023-02-29' })).toThrow();
    expect(() => postMovement(ledger, movementId, { ...movement, accountId: third })).toThrow('account_missing');
    expect(() => postMovement(ledger, movementId, { ...movement, kind: 'transfer', destinationId: second })).toThrow(
      'transfer_invalid',
    );
  });

  it('only replays an operation ID when the exact normalized movement matches', () => {
    const ledger = postMovement(addAccount(emptyLedger(), first, opening), movementId, movement);

    expect(postMovement(ledger, movementId, { ...movement, note: 'Synthetic record ' })).toBe(ledger);
    expect(() => postMovement(ledger, movementId, { ...movement, amountMinor: '25' })).toThrow('movement_conflict');
    expect(ledger.movements).toHaveLength(1);
  });
});
