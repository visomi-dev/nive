import { Component, DestroyRef, inject, signal } from '@angular/core';
import { importDigest, importInput, type ImportBatch, type ImportRow, type Ledger } from '@nive/finance';

import { Button, Select } from '../../../ui';
import { ImportReview } from '../import-review/import-review';
import { LedgerStore } from '../ledger-store';

import { columns, mapCsv, readCfdi, readCsv, type Mapping } from './import-files';

@Component({
  selector: 'app-local-import',
  imports: [Button, Select, ImportReview],
  template: `
    <details>
      <summary i18n="@@importLocal">Import CSV or CFDI on this device</summary>

      @if (proposal(); as value) {
        <app-import-review
          [batch]="value.batch"
          [digest]="value.digest"
          [busy]="busy()"
          (approved)="save($event)"
          (rejected)="clear()"
        />
      } @else {
        <label
          ><span i18n="@@importFile">Local CSV or CFDI 4.0 XML</span>

          <input type="file" accept=".csv,.xml" [disabled]="busy()" (change)="select($event)" />
        </label>

        @if (records(); as table) {
          <form #form class="grid gap-2 sm:grid-cols-3" (submit)="map($event, form)">
            @for (field of fields; track field) {
              <label
                >{{ field
                }}<select appUI [name]="field">
                  <option value="-1" i18n="@@importUnmapped">Unmapped</option>

                  @for (column of table[0]; track $index) {
                    <option [value]="$index" [selected]="column.trim().toLowerCase() === field">
                      {{ column }} ({{ $index + 1 }})
                    </option>
                  }
                </select></label
              >
            }

            <button appUI type="submit" i18n="@@importMap">Review mapped rows</button>
          </form>
        }
      }

      @if (error()) {
        <p role="alert" i18n="@@importLocalError">Check the file format, the 50-row limit and your open vault.</p>
      }

      @if (duplicate()) {
        <p role="status" i18n="@@importAlreadyApplied">This batch is already in the vault.</p>
      }

      @if (saved()) {
        <p role="status" i18n="@@personalSaved">Saved in your personal vault.</p>
      }
    </details>
  `,
})
export class LocalImport {
  private readonly store = inject(LedgerStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly records = signal<string[][] | null>(null);
  protected readonly proposal = signal<{ batch: ImportBatch; digest: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal(false);
  protected readonly duplicate = signal(false);
  protected readonly saved = signal(false);

  protected readonly fields = columns;

  protected async select(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!event.isTrusted || !file || this.busy()) {
      return;
    }

    input.value = '';
    this.clear();
    this.busy.set(true);

    try {
      if (file.size > 256 * 1024) {
        throw new Error('size_limit');
      }

      const buffer = await file.arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);

      if (this.destroyRef.destroyed || !this.store.ready()) {
        return;
      }

      if (file.name.toLowerCase().endsWith('.csv')) {
        this.records.set(readCsv(text));
      } else {
        await this.prepare([readCfdi(text)]);
      }
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async map(event: Event, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const records = this.records();

    if (!records || !event.isTrusted) {
      return;
    }

    const data = new FormData(form);
    const mapping = Object.fromEntries(columns.map((field) => [field, Number(data.get(field))])) as Mapping;

    try {
      await this.prepare(mapCsv(records, mapping));
    } catch {
      this.error.set(true);
    }
  }

  protected clear(): void {
    this.proposal.set(null);
    this.records.set(null);
    this.error.set(false);
    this.saved.set(false);
    this.duplicate.set(false);
  }

  protected async save(value: { before: Ledger; after: Ledger }): Promise<void> {
    const active = this.proposal();

    if (!active || this.busy()) {
      return;
    }

    this.busy.set(true);

    try {
      await this.store.update(
        (ledger) => {
          if (JSON.stringify(ledger) !== JSON.stringify(value.before)) {
            throw new Error('stale_review');
          }

          return value.after;
        },
        () => !this.destroyRef.destroyed && this.proposal() === active,
      );

      this.clear();
      this.saved.set(true);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  private async prepare(rows: ImportRow[]): Promise<void> {
    const batch = importInput.parse({ requestId: crypto.randomUUID(), groups: [{ account: null, rows, budgets: [] }] });
    const digest = await importDigest(batch);

    if (!this.destroyRef.destroyed && this.store.ready()) {
      this.records.set(null);
      const duplicate = this.store.ledger()?.imports.some((entry) => entry.digest === digest) ?? false;

      this.duplicate.set(duplicate);

      if (!duplicate) {
        this.proposal.set({ batch, digest });
      }
    }
  }
}
