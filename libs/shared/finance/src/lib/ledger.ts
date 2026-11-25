import { z } from 'zod';

// Nive v6 represents money as canonical signed minor-unit strings.
export const currency = z.enum(['MXN', 'USD', 'EUR', 'JPY', 'KWD']);
export type Currency = z.infer<typeof currency>;
const precision: Record<Currency, number> = { MXN: 2, USD: 2, EUR: 2, JPY: 0, KWD: 3 };
const signedMinor = z.string().regex(/^(0|-?[1-9][0-9]{0,17})$/);
const positiveMinor = z.string().regex(/^[1-9][0-9]{0,17}$/);
const label = z.string().trim().min(1).max(80);
const note = z.string().trim().max(140);

export const period = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);

const accountSchema = z.strictObject({
  id: z.uuid(),
  name: label,
  currency,
  openingMinor: signedMinor,
});

export const accountInput = accountSchema.omit({ id: true });

const movementFields = {
  accountId: z.uuid(),
  amountMinor: positiveMinor,
  date: z.iso.date(),
  note,
};

export const movementInput = z.discriminatedUnion('kind', [
  z.strictObject({ ...movementFields, kind: z.enum(['income', 'expense']) }),
  z.strictObject({ ...movementFields, kind: z.literal('transfer'), destinationId: z.uuid() }),
]);
export type MovementInput = z.infer<typeof movementInput>;

const movementRecord = z.strictObject({ id: z.uuid(), movement: movementInput });

export const ledgerSchema = z.strictObject({
  version: z.literal(1),
  accounts: z.array(accountSchema).max(100),
  movements: z.array(movementRecord).max(1000),
});
export type Ledger = z.infer<typeof ledgerSchema>;
export const emptyLedger = (): Ledger => ({ version: 1, accounts: [], movements: [] });

export function parseMoney(decimal: string, code: Currency): string {
  const digits = precision[code];

  if (!/^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,3})?$/.test(decimal)) {
    throw new Error('amount_invalid');
  }

  const negative = decimal.startsWith('-');
  const [whole, fraction = ''] = (negative ? decimal.slice(1) : decimal).split('.');

  if (fraction.length > digits) {
    throw new Error('amount_invalid');
  }

  const value = BigInt(whole) * BigInt('1' + '0'.repeat(digits)) + BigInt(fraction.padEnd(digits, '0') || '0');

  return signedMinor.parse((negative ? -value : value).toString());
}

export function formatMoney(amount: string, code: Currency): string {
  const digits = precision[code];
  const factor = BigInt('1' + '0'.repeat(digits));
  const value = BigInt(amount);
  const absolute = value < BigInt(0) ? -value : value;
  const fraction = digits ? '.' + (absolute % factor).toString().padStart(digits, '0') : '';

  return (value < BigInt(0) ? '-' : '') + (absolute / factor).toString() + fraction;
}

export function addAccount(ledger: Ledger, id: string, input: z.infer<typeof accountInput>): Ledger {
  if (ledger.accounts.some((account) => account.id === id)) {
    throw new Error('account_duplicate');
  }

  return ledgerSchema.parse({ ...ledger, accounts: [...ledger.accounts, accountSchema.parse({ ...input, id })] });
}

export function validateMovement(ledger: Ledger, input: MovementInput): MovementInput {
  const movement = movementInput.parse(input);
  const source = ledger.accounts.find((account) => account.id === movement.accountId);

  if (!source) {
    throw new Error('account_missing');
  }

  if (movement.kind === 'transfer') {
    const destination = ledger.accounts.find((account) => account.id === movement.destinationId);

    if (!destination || source.id === destination.id || source.currency !== destination.currency) {
      throw new Error('transfer_invalid');
    }
  }

  return movement;
}

export function sameMovement(left: MovementInput, right: MovementInput): boolean {
  return JSON.stringify(movementInput.parse(left)) === JSON.stringify(movementInput.parse(right));
}

export function postMovement(ledger: Ledger, id: string, input: MovementInput): Ledger {
  const movement = validateMovement(ledger, input);
  const existing = ledger.movements.find((record) => record.id === id);

  if (existing) {
    if (!sameMovement(existing.movement, movement)) {
      throw new Error('movement_conflict');
    }

    return ledger;
  }

  return ledgerSchema.parse({ ...ledger, movements: [...ledger.movements, movementRecord.parse({ id, movement })] });
}

const total = z.string().regex(/^(0|-?[1-9][0-9]{0,22})$/);

export const summarySchema = z.strictObject({
  month: period,
  accounts: z.array(z.strictObject({ id: z.uuid(), name: label, currency, balanceMinor: total })).max(100),
  totals: z.array(z.strictObject({ currency, incomeMinor: total, expenseMinor: total })).max(5),
});

export function summarize(ledger: Ledger, month: string): z.infer<typeof summarySchema> {
  const amounts = new Map(ledger.accounts.map((account) => [account.id, BigInt(account.openingMinor)]));
  const totals = new Map<Currency, { income: bigint; expense: bigint }>(
    ledger.accounts.map((account) => [account.currency, { income: BigInt(0), expense: BigInt(0) }]),
  );
  const currencies = new Map(ledger.accounts.map((account) => [account.id, account.currency]));

  for (const { movement } of ledger.movements) {
    const amount = BigInt(movement.amountMinor);
    const source = amounts.get(movement.accountId);
    const code = currencies.get(movement.accountId);

    if (source === undefined || code === undefined) {
      throw new Error('account_missing');
    }

    amounts.set(movement.accountId, source + (movement.kind === 'income' ? amount : -amount));

    if (movement.kind === 'transfer') {
      const destination = amounts.get(movement.destinationId);

      if (destination === undefined || code !== currencies.get(movement.destinationId)) {
        throw new Error('transfer_invalid');
      }

      amounts.set(movement.destinationId, destination + amount);
    } else if (movement.date.startsWith(month + '-')) {
      totals.get(code)![movement.kind] += amount;
    }
  }

  return summarySchema.parse({
    month,
    accounts: ledger.accounts.map(({ id, name, currency }) => ({
      id,
      name,
      currency,
      balanceMinor: amounts.get(id)!.toString(),
    })),
    totals: [...totals].map(([currency, { income, expense }]) => ({
      currency,
      incomeMinor: income.toString(),
      expenseMinor: expense.toString(),
    })),
  });
}
