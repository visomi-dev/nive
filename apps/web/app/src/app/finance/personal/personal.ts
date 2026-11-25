import { DOCUMENT } from '@angular/common';
import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import {
  accountInput,
  addAccount,
  currency,
  categorySpending,
  categoryMovements,
  type Ledger,
  type ImportSource,
  formatMoney,
  localWebOrigin,
  movementInput,
  parseMoney,
  period,
  summarize,
  type Capability,
  type MovementInput,
} from '@nive/finance';

import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Heading, Input, Select, Text } from '../../ui';

import { ImportReview } from './import-review';
import { LocalImport } from './local-import';
import { LedgerStore } from './ledger-store';
import { LocalAgent, type ImportProposal } from './local-agent';

@Component({
  selector: 'app-personal-finance',
  imports: [ImportReview, LocalImport, NavigationHeading, Button, Card, Heading, Input, Select, Text],
  providers: [LedgerStore, LocalAgent],
  templateUrl: './personal.html',
})
export class PersonalFinance {
  private readonly document = inject(DOCUMENT);

  protected readonly store = inject(LedgerStore);
  protected readonly agent = inject(LocalAgent);

  protected readonly local = signal(false);
  protected readonly busy = signal(false);
  protected readonly feedback = signal<'error' | 'saved' | 'rejected' | null>(null);
  protected readonly month = signal('');

  protected readonly summary = computed(() => {
    const ledger = this.store.ledger();
    const month = period.safeParse(this.month());

    return ledger && month.success ? summarize(ledger, month.data) : null;
  });

  protected readonly reviewed = signal<ReturnType<LocalAgent['review']> | null>(null);
  protected readonly visibleReview = computed(() => {
    const review = this.reviewed();
    const ledger = this.store.ledger();

    if (!review || !ledger || this.agent.proposal() !== review.proposal) {
      return null;
    }

    const movement = review.movement;
    const account = ledger.accounts.find((value) => value.id === movement.accountId);
    const destination =
      movement.kind === 'transfer' ? ledger.accounts.find((value) => value.id === movement.destinationId) : undefined;

    return account ? { movement, account, destination } : null;
  });

  protected readonly evidence = categoryMovements;
  protected readonly spending = categorySpending;
  protected readonly format = formatMoney;
  protected readonly currencies = currency.options;

  protected open(): void {
    void this.handle(() => this.store.open());
  }

  protected lock(): void {
    this.store.lock();
    this.reviewed.set(null);
    this.feedback.set(null);
  }

  protected accountLabel(id: string): string {
    const item = this.store.ledger()?.accounts.find((account) => account.id === id);

    return item ? item.name + ' (' + item.currency + ')' : '';
  }

  protected sourceText(source: ImportSource): string {
    return [source.format.toUpperCase(), source.document, source.sheet, source.row, source.page, source.reference]
      .filter(Boolean)
      .join(' · ');
  }

  protected displayAmount(accountId: string, amount: string): string {
    const account = this.store.ledger()?.accounts.find((candidate) => candidate.id === accountId);

    return account ? formatMoney(amount, account.currency) : '';
  }

  protected movementName(kind: MovementInput['kind']): string {
    switch (kind) {
      case 'income':
        return $localize`:@@personalKindIncome:Income`;
      case 'expense':
        return $localize`:@@personalKindExpense:Expense`;
      case 'transfer':
        return $localize`:@@personalKindTransfer:Transfer`;
    }
  }

  protected connect(event: Event, form: HTMLFormElement): void {
    event.preventDefault();
    const input = new FormData(form);

    if (!event.isTrusted || !input.has('consent')) {
      return;
    }

    const requested: Capability[] = [];

    if (input.has('read')) {
      requested.push('read-summary');
    }

    if (input.has('import')) {
      requested.push('prepare-import');
    }

    if (input.has('prepare')) {
      requested.push('prepare-movement');
    }

    const code = String(input.get('pairing') ?? '');

    form.reset();
    void this.handle(() => this.agent.connect(code, requested));
  }

  protected createAccount(event: Event, form: HTMLFormElement): void {
    event.preventDefault();

    if (!event.isTrusted) {
      return;
    }

    void this.handle(async () => {
      const input = new FormData(form);
      const code = currency.parse(input.get('currency'));
      const account = accountInput.parse({
        name: input.get('name'),
        currency: code,
        openingMinor: parseMoney(String(input.get('opening') ?? ''), code),
      });
      const id = this.document.defaultView!.crypto.randomUUID();

      await this.store.update((ledger) => addAccount(ledger, id, account));

      form.reset();
      this.feedback.set('saved');
    });
  }

  protected review(event: Event, form: HTMLFormElement): void {
    event.preventDefault();

    if (!event.isTrusted) {
      return;
    }

    this.feedback.set(null);
    this.reviewed.set(null);

    try {
      const input = new FormData(form);
      const accountId = input.get('account');
      const account = this.store.ledger()?.accounts.find((candidate) => candidate.id === accountId);

      if (!account) {
        throw new Error('account_missing');
      }

      const kind = input.get('kind');
      const movement = movementInput.parse({
        accountId,
        kind,
        amountMinor: parseMoney(String(input.get('amount') ?? ''), account.currency),
        date: input.get('date'),
        note: input.get('note'),
        ...(kind === 'transfer' ? { destinationId: input.get('destination') } : {}),
      });

      this.reviewed.set(this.agent.review(movement));
    } catch {
      this.feedback.set('error');
    }
  }

  protected approve(event: Event): void {
    const reviewed = this.reviewed();

    if (reviewed && this.visibleReview() && event.isTrusted) {
      void this.handle(async () => {
        await this.agent.approve(reviewed);

        this.reviewed.set(null);
        this.feedback.set('saved');
      });
    }
  }

  protected approveImport(proposal: ImportProposal, value: { before: Ledger; after: Ledger }): void {
    void this.handle(async () => {
      await this.agent.approveImport(proposal, value.before, value.after);

      this.feedback.set('saved');
    });
  }

  protected rejectImport(): void {
    void this.handle(() => {
      this.agent.reject();
      this.feedback.set('rejected');
    });
  }

  protected reject(event: Event): void {
    if (event.isTrusted) {
      void this.handle(() => {
        this.agent.reject();
        this.reviewed.set(null);
        this.feedback.set('rejected');
      });
    }
  }

  private async handle(action: () => void | Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.feedback.set(null);

    try {
      await action();
    } catch {
      this.feedback.set('error');
    } finally {
      this.busy.set(false);
    }
  }

  private readonly initialize = afterNextRender(() => {
    this.local.set(Boolean(localWebOrigin(this.document.defaultView?.location.origin)));
    const today = new Date();

    this.month.set(today.getFullYear().toString() + '-' + String(today.getMonth() + 1).padStart(2, '0'));
    void this.handle(() => this.store.detect());
  });
}
