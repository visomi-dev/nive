import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
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

import { BringMovements, type ImportStep } from '../../onboarding/bring-movements/bring-movements';
import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Heading, Input, LinkButton, Select, Text } from '../../ui';

import { ImportReview } from './import-review/import-review';
import { RuntimeInbox } from './runtime-inbox/runtime-inbox';
import { LocalImport } from './local-import/local-import';
import { LedgerStore } from './ledger-store';
import { LocalAgent, type ImportProposal } from './local-agent';

@Component({
  selector: 'app-personal-finance',
  imports: [
    ImportReview,
    LocalImport,
    RuntimeInbox,
    BringMovements,
    NavigationHeading,
    Button,
    Card,
    Heading,
    Input,
    LinkButton,
    RouterLink,
    Select,
    Text,
  ],
  providers: [LedgerStore, LocalAgent],
  templateUrl: './personal.html',
})
export class PersonalFinance {
  private readonly document = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);

  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  private readonly desktop = signal(false);
  private readonly previewEnabled = signal(false);

  protected readonly store = inject(LedgerStore);
  protected readonly agent = inject(LocalAgent);

  protected readonly importResult = signal<{ accounts: boolean; movements: boolean; budgets: boolean } | null>(null);
  protected readonly busy = signal(false);
  protected readonly feedback = signal<'error' | 'saved' | 'rejected' | null>(null);
  protected readonly month = signal('');

  protected readonly local = computed(() => this.desktop() && this.previewEnabled());
  protected readonly requested = computed((): ImportStep | null => {
    const value = this.params()?.get('setup');

    return value === 'choose' || value === 'local' || value === 'agent' ? value : null;
  });
  protected readonly emptyWorkspace = computed(() => {
    const ledger = this.store.ledger();

    return ledger
      ? !ledger.accounts.length && !ledger.movements.length && !ledger.budgets.length
      : this.store.configured() === false;
  });
  protected readonly setup = computed(() => {
    const requested = this.requested();

    if (!this.emptyWorkspace() || this.importResult()) {
      return null;
    }

    return requested === 'agent' && !this.local() ? 'choose' : requested;
  });
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

  protected detectVault(): void {
    void this.handle(() => this.store.detect());
  }

  protected lock(): void {
    this.store.lock();
    this.reviewed.set(null);
    this.importResult.set(null);
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

    if (
      !event.isTrusted ||
      !this.local() ||
      !input.has('consent') ||
      (this.setup() === 'agent' && (!this.store.ready() || !input.has('import')))
    ) {
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

      this.showImportResult(value);
    });
  }

  protected showImportResult({ before, after }: { before: Ledger; after: Ledger }): void {
    this.importResult.set({
      accounts: JSON.stringify(before.accounts) !== JSON.stringify(after.accounts),
      movements: JSON.stringify(before.movements) !== JSON.stringify(after.movements),
      budgets: JSON.stringify(before.budgets) !== JSON.stringify(after.budgets),
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

  private async detectAgentPreview(): Promise<void> {
    try {
      const response = await fetch('/api/personal/local-agent', { cache: 'no-store', redirect: 'error' });

      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const config: unknown = await response.json();

        if (!this.destroy.destroyed) {
          this.previewEnabled.set(
            Boolean(config && typeof config === 'object' && 'enabled' in config && config.enabled === true),
          );
        }
      }
    } catch {
      // A missing preview leaves local file import available.
    }
  }

  private readonly initialize = afterNextRender(() => {
    const view = this.document.defaultView;

    if (localWebOrigin(view?.location.origin) && view?.PublicKeyCredential) {
      const desktop = view.matchMedia('(min-width: 48rem) and (any-pointer: fine)');
      const update = () => this.desktop.set(desktop.matches);

      update();
      desktop.addEventListener('change', update);
      this.destroy.onDestroy(() => desktop.removeEventListener('change', update));
      void this.detectAgentPreview();
    }

    const today = new Date();

    this.month.set(today.getFullYear().toString() + '-' + String(today.getMonth() + 1).padStart(2, '0'));
    this.detectVault();
  });
}
