import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { reviewImport, type Ledger, type ImportBatch, type ReviewedGroup } from '@nive/finance';

import { Button, Heading } from '../../../ui';
import { ImportAccount } from '../import-account/import-account';

type Plan = { before: Ledger; group: ReviewedGroup };

@Component({
  selector: 'app-import-review',
  imports: [ImportAccount, Button, Heading],
  template: `
    <section class="space-y-4">
      <h2 appUI uiSize="md" i18n="@@importHeading">Review import and budget plan</h2>

      @for (group of batch().groups; track group; let i = $index) {
        <app-import-account [group]="group" [busy]="busy()" (reviewed)="record(i, $event)" />
      }

      @if (invalid()) {
        <p role="alert" i18n="@@importStale">
          Review each account again. Use one group per account and check for changes in the vault.
        </p>
      }

      <button appUI type="button" [disabled]="busy() || !complete()" (click)="approve($event)" i18n="@@importApprove">
        Approve and save batch
      </button>

      <button
        appUI
        variant="secondary"
        type="button"
        [disabled]="busy()"
        (click)="reject($event)"
        i18n="@@personalReject"
      >
        Reject proposal
      </button>
    </section>
  `,
})
export class ImportReview {
  readonly batch = input.required<ImportBatch>();
  protected readonly plans = linkedSignal(() => this.batch().groups.map((): Plan | null => null));
  protected readonly invalid = signal(false);

  protected readonly complete = computed(() => this.plans().every((plan) => plan !== null));

  readonly digest = input.required<string>();
  readonly busy = input(false);
  readonly approved = output<{ before: Ledger; after: Ledger }>();
  readonly rejected = output<void>();

  protected record(index: number, plan: Plan | null): void {
    this.plans.update((plans) => plans.map((item, i) => (i === index ? plan : item)));
    this.invalid.set(false);
  }

  protected reject(event: Event): void {
    if (event.isTrusted) {
      this.rejected.emit();
    }
  }

  protected approve(event: Event): void {
    const plans = this.plans();

    if (!event.isTrusted || !plans.every((plan) => plan !== null)) {
      return;
    }

    try {
      const before = plans[0].before;

      if (!plans.every((plan) => plan.before === before || JSON.stringify(plan.before) === JSON.stringify(before))) {
        throw new Error('stale_review');
      }

      const after = reviewImport(
        before,
        this.batch(),
        this.digest(),
        plans.map((plan) => plan.group),
      );

      this.approved.emit({ before, after });
    } catch {
      this.invalid.set(true);
    }
  }
}
