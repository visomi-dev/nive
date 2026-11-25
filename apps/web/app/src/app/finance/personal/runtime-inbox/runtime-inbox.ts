import { DatePipe } from '@angular/common';
import { Component, inject, output, signal } from '@angular/core';
import { capabilities, type Ledger } from '@nive/finance';

import { Button, Card, Heading, Input, Text } from '../../../ui';
import { ImportReview } from '../import-review/import-review';

import { Inbox } from './inbox';

type Reviewed = { before: Ledger; after: Ledger };

@Component({
  selector: 'app-runtime-inbox',
  imports: [Button, Card, DatePipe, Heading, ImportReview, Input, Text],
  templateUrl: './runtime-inbox.html',
})
export class RuntimeInbox {
  protected readonly inbox = inject(Inbox);

  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  readonly applied = output<Reviewed>();

  protected pair(event: Event, form: HTMLFormElement): void {
    event.preventDefault();
    const data = new FormData(form);

    if (event.isTrusted && data.has('consent')) {
      form.reset();
      void this.run(() => this.inbox.pair(String(data.get('code') ?? '')));
    }
  }

  protected authorize(event: Event, form: HTMLFormElement): void {
    event.preventDefault();

    if (event.isTrusted) {
      void this.run(() => {
        const grants = this.inbox.enrollment()?.secureControl
          ? new FormData(form).getAll('capability')
          : ['prepare-import'];

        return this.inbox.authorize(capabilities.parse(grants));
      });
    }
  }

  protected revoke(event: Event): void {
    if (event.isTrusted) {
      void this.run(() => this.inbox.revoke());
    }
  }

  protected refresh(): void {
    void this.run(() => this.inbox.refresh());
  }

  protected approve(id: string, digest: string, reviewed: Reviewed): void {
    void this.run(async () => {
      await this.inbox.decide(id, digest, 'applied', reviewed);

      this.applied.emit(reviewed);
    });
  }

  protected reject(id: string, digest: string): void {
    void this.run(() => this.inbox.decide(id, digest, 'rejected'));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.failed.set(false);

    try {
      await action();
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
