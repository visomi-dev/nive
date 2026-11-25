import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { emptyLedger } from '@nive/finance';

import { Navigation } from '../../shared/navigation';

import { LedgerStore } from './ledger-store';
import { LocalAgent, type ImportProposal } from './local-agent';
import { PersonalFinance } from './personal';

it('keeps the open local importer mounted when an agent batch arrives', async () => {
  const proposal = signal<ImportProposal | null>(null);

  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  TestBed.overrideComponent(PersonalFinance, {
    set: {
      providers: [
        { provide: LocalAgent, useValue: { importProposal: proposal, proposal: () => null, connected: () => false } },
        { provide: LedgerStore, useValue: { ledger: emptyLedger, ready: () => true, detect: vi.fn() } },
        { provide: Navigation, useValue: { headingFocus: () => null } },
      ],
    },
  });
  const fixture = TestBed.createComponent(PersonalFinance);

  await fixture.whenStable();

  const host = fixture.nativeElement as HTMLElement;
  const importer = host.querySelector('app-local-import details') as HTMLDetailsElement;

  importer.open = true;
  const id = crypto.randomUUID();

  proposal.set({
    id,
    digest: 'd'.repeat(64),
    expiresAt: Date.now() + 60_000,
    batch: {
      requestId: id,
      groups: [
        {
          account: null,
          budgets: [],
          rows: [
            {
              source: { format: 'csv', row: 2 },
              kind: null,
              date: null,
              currency: null,
              amountMinor: null,
              note: '',
              category: null,
              needsReview: true,
            },
          ],
        },
      ],
    },
  });

  await fixture.whenStable();

  expect(host.querySelector('app-import-review')).not.toBeNull();
  expect(host.querySelector('app-local-import details')).toBe(importer);
  expect(importer.open).toBe(true);
});
