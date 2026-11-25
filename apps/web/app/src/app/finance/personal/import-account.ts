import { Component, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  currency,
  formatMoney,
  importMatches,
  parseMoney,
  reviewGroup,
  categorySpending,
  type ReviewedGroup,
  type ImportGroup,
  type Currency,
  type ImportRow,
  type Ledger,
  type ReviewedRow,
} from '@nive/finance';

import { Button, Card, Input, Select } from '../../ui';

import { LedgerStore } from './ledger-store';

type DraftRow = {
  id: string;
  original: ImportRow;
  amount: string;
  code: Currency | '';
  date: string;
  kind: ImportRow['kind'];
  category: string;
  note: string;
  choice: string;
};

@Component({
  selector: 'app-import-account',
  imports: [FormsModule, Button, Card, Input, Select],
  templateUrl: './import-account.html',
})
export class ImportAccount {
  protected readonly store = inject(LedgerStore);

  readonly group = input.required<ImportGroup>();
  protected readonly account = linkedSignal(() => {
    const proposed = this.group().account;
    const existing = untracked(() => this.store.ledger()?.accounts ?? []);

    if (proposed && 'id' in proposed) {
      return existing.find((item) => item.id === proposed.id)?.id ?? '';
    }

    const matches = existing.filter((item) => item.name === proposed?.name && item.currency === proposed.currency);

    return matches.length === 1 ? matches[0].id : proposed && !matches.length ? 'new' : '';
  });
  protected readonly draft = linkedSignal(() => {
    const batch = this.group();
    const account = batch.account && 'name' in batch.account ? batch.account : null;

    return {
      id: crypto.randomUUID(),
      name: account?.name ?? '',
      code: account?.currency ?? ('' as Currency | ''),
      opening:
        account?.currency && account.openingMinor !== null ? formatMoney(account.openingMinor, account.currency) : '',
      budgets: batch.budgets.map((line) => ({ ...line, include: true, months: line.basisMonths.join(', ') })),
      rows: batch.rows.map((original): DraftRow => ({
        id: crypto.randomUUID(),
        original,
        date: original.date ?? '',
        code: original.currency ?? '',
        amount: original.amountMinor && original.currency ? formatMoney(original.amountMinor, original.currency) : '',
        category: original.category ?? '',
        note: original.note,
        kind: original.kind,
        choice: '',
      })),
    };
  });
  protected readonly preview = signal<{ before: Ledger; after: Ledger; rows: ReviewedRow[]; accountId: string } | null>(
    null,
  );
  protected readonly invalid = signal(false);

  protected readonly positive = /^[1-9][0-9]{0,17}$/;
  protected readonly currencies = currency.options;
  protected readonly format = formatMoney;
  protected readonly spending = categorySpending;

  readonly reviewed = output<{ before: Ledger; group: ReviewedGroup } | null>();
  readonly busy = input(false);

  protected sourceLabel(row: ImportRow): string {
    const source = row.source;

    return [
      source.format.toUpperCase(),
      source.document,
      source.sheet,
      source.row ? $localize`:@@importRowLabel:Row` + ' ' + source.row : '',
      source.page ? $localize`:@@importPageLabel:Page` + ' ' + source.page : '',
      source.reference,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected candidates(row: DraftRow, index: number) {
    const ledger = this.store.ledger();

    if (!ledger) {
      return [];
    }

    const value = this.rowValue(row);
    const saved = importMatches(ledger, this.account(), value).map(({ id, movement, sources }) => ({
      id,
      label: [
        movement.date,
        movement.note,
        this.displayMinor(movement.amountMinor),
        ...(sources ?? []).map((s) => s.reference),
      ]
        .filter(Boolean)
        .join(' · '),
    }));
    const earlier = this.draft().rows.filter(
      (candidate, otherIndex) =>
        index !== otherIndex &&
        candidate.choice === 'post' &&
        candidate.code === row.code &&
        this.rowValue(candidate).amountMinor === value.amountMinor &&
        value.amountMinor !== null,
    );

    return [
      ...saved,
      ...earlier.map((item) => ({ id: item.id, label: this.sourceLabel(item.original) + ' · ' + item.note })),
    ];
  }

  protected displayMinor(amount: string): string {
    const code =
      this.account() === 'new'
        ? this.draft().code
        : this.store.ledger()?.accounts.find(({ id }) => id === this.account())?.currency;

    return code ? code + ' ' + formatMoney(amount, code) : amount;
  }

  protected review(event: Event): void {
    event.preventDefault();
    const before = this.store.ledger();

    if (!event.isTrusted || !before) {
      return;
    }

    this.invalid.set(false);

    try {
      const draft = this.draft();
      const accountId = this.account() === 'new' ? draft.id : this.account();
      const account =
        this.account() === 'new'
          ? {
              name: draft.name,
              currency: currency.parse(draft.code),
              openingMinor: parseMoney(draft.opening, currency.parse(draft.code)),
            }
          : null;
      const rows = draft.rows.map((item): ReviewedRow => {
        if (!item.choice) {
          throw new Error('decision_required');
        }

        const action = item.choice === 'post' || item.choice === 'skip' ? item.choice : 'link';

        return { id: item.id, row: this.rowValue(item), decision: { action, targetId: item.choice } };
      });
      const budgets = draft.budgets
        .filter((line) => line.include)
        .map(({ month, category, limitMinor, months }) => ({
          month,
          category,
          limitMinor,
          basisMonths: months.split(',').map((value) => value.trim()),
        }));
      const group = { accountId, account, rows, budgets };
      const after = reviewGroup(before, this.group(), group);

      this.reviewed.emit({ before, group });
      this.preview.set({ before, after, rows, accountId });
    } catch {
      this.invalid.set(true);
    }
  }

  protected basis(months: string): string[] {
    return months.split(',').map((month) => month.trim());
  }

  protected edit(): void {
    this.preview.set(null);
    this.reviewed.emit(null);
  }

  private rowValue(item: DraftRow): ImportRow {
    let amountMinor: string | null = null;

    try {
      if (item.code) {
        amountMinor = parseMoney(item.amount, item.code);
      }
    } catch {
      // Keep an incomplete edit visible until review validates it.
    }

    return {
      ...item.original,
      currency: item.code || null,
      date: item.date || null,
      kind: item.kind,
      category: item.category.trim() || null,
      note: item.note,
      amountMinor,
    };
  }
}
