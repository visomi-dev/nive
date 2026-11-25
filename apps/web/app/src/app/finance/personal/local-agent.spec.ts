import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  emptyLedger,
  enrollmentLifetime,
  proposalLifetime,
  type Capability,
  type Ledger,
  type RuntimeCall,
} from '@nive/finance';

import { Session } from '../../auth/session/session';

import { LedgerStore } from './ledger-store';
import { LocalAgent } from './local-agent';

const input = {
  requestId: 'e02485ad-b1bc-4f91-89ac-c92526a5077e',
  groups: [
    {
      account: null,
      budgets: [],
      rows: [
        {
          source: { format: 'csv' as const, row: 2 },
          date: null,
          currency: null,
          kind: null,
          amountMinor: null,
          note: '',
          category: null,
          needsReview: true,
        },
      ],
    },
  ],
};
const work = {
  id: 'c078651f-2a79-428e-b773-83fb80e12660',
  call: { capability: 'prepare-import', input } satisfies RuntimeCall,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { resolve, promise };
}

async function setup(grants: Capability[] = ['prepare-import'], unlocked = true) {
  const ready = signal(unlocked);
  const ledger = signal(emptyLedger());
  const session = {
    user: () => ({ id: 'synthetic-owner' }),
    full: () => true,
    operationVersion: () => 1,
    cancellation: () => new AbortController().signal,
    load: vi.fn().mockResolvedValue(undefined),
  };
  const update = vi.fn(async (transform: (current: Ledger) => Ledger, authorized: () => boolean) => {
    if (!authorized()) {
      throw new Error('stale_operation');
    }

    ledger.set(transform(ledger()));
  });

  TestBed.configureTestingModule({
    providers: [
      LocalAgent,
      { provide: Session, useValue: session },
      { provide: LedgerStore, useValue: { ready, ledger, refresh: () => Promise.resolve(ledger()), update } },
      {
        provide: DOCUMENT,
        useValue: { defaultView: { location: { origin: 'http://localhost:18184' }, crypto: globalThis.crypto } },
      },
    ],
  });
  const reply = deferred<{ error?: string; status?: string }>();
  const expiresAt = Date.now() + enrollmentLifetime;
  let sent = false;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/next')) {
        const item = sent ? null : work;

        sent = true;

        return Response.json({ work: item, expiresAt });
      }

      if (url.endsWith('/reply')) {
        const body = JSON.parse(String(init.body)) as { result: { error?: string; status?: string } };

        reply.resolve(body.result);
      }

      return new Response(null, { status: 204 });
    }),
  );
  const agent = TestBed.inject(LocalAgent);

  await agent.connect('1'.repeat(64), grants);

  const result = await reply.promise;

  return { agent, ledger, ready, session, update, result };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { grants: ['read-summary'] as Capability[], ready: true, error: 'permission_denied' },
  { grants: ['prepare-import'] as Capability[], ready: false, error: 'locked' },
])('requires an import grant and open vault before queuing', async ({ grants, ready, error }) => {
  const f = await setup(grants, ready);

  expect(f.result).toEqual({ error });
  expect(f.agent.importProposal()).toBeNull();
  expect(f.update).not.toHaveBeenCalled();
});

it.each(['reject', 'lock', 'revoke', 'proposal expiry', 'grant expiry'])(
  'rechecks authority after review on %s',
  async (reason) => {
    const f = await setup();

    expect(f.result).toMatchObject({ status: 'pending' });
    const proposal = f.agent.importProposal()!;
    const before = f.ledger();
    // Hold the session revalidation between the click and the write.
    const pending = deferred<void>();

    f.session.load.mockReturnValueOnce(pending.promise);
    const approval = f.agent.approveImport(proposal, before, before);

    if (reason === 'reject') {
      f.agent.reject();
    }

    if (reason === 'lock') {
      f.ready.set(false);
    }

    if (reason === 'revoke') {
      f.agent.revoke();
    }

    if (reason.endsWith('expiry')) {
      vi.spyOn(Date, 'now').mockReturnValue(
        Date.now() + (reason === 'grant expiry' ? enrollmentLifetime : proposalLifetime) + 1,
      );
    }

    pending.resolve();

    await expect(approval).rejects.toThrow();

    expect(f.update).not.toHaveBeenCalled();
    expect(f.ledger()).toEqual(emptyLedger());
  },
);
