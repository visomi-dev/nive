import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  addAccount,
  emptyLedger,
  ledgerSchema,
  enrollmentLifetime,
  proposalLifetime,
  type Capability,
  type Ledger,
  type RuntimeCall,
  type RuntimeResult,
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
const work: { id: string; call: RuntimeCall } = {
  id: 'c078651f-2a79-428e-b773-83fb80e12660',
  call: { capability: 'prepare-import', input },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { resolve, promise };
}

async function setup(grants: Capability[] = ['prepare-import'], unlocked = true, initial = emptyLedger()) {
  const ready = signal(unlocked);
  const ledger = signal(initial);
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
  let request: { task: typeof work; reply: ReturnType<typeof deferred<RuntimeResult>> } | undefined;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/next')) {
        const task = request?.task ?? null;

        return Response.json({ work: task, expiresAt: Date.now() + enrollmentLifetime });
      }

      if (url.endsWith('/reply')) {
        const body = JSON.parse(String(init.body)) as { result: RuntimeResult };

        request?.reply.resolve(body.result);
        request = undefined;
      }

      return new Response(null, { status: 204 });
    }),
  );
  const agent = TestBed.inject(LocalAgent);

  await agent.connect('1'.repeat(64), grants);

  const submit = (call: RuntimeCall = work.call) => {
    const reply = deferred<RuntimeResult>();

    request = { task: { ...work, call }, reply };

    return reply.promise;
  };

  return { agent, ledger, ready, session, update, submit };
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

  await expect(f.submit()).resolves.toEqual({ error });

  expect(f.agent.importProposal()).toBeNull();
  expect(f.update).not.toHaveBeenCalled();
});

it.each(['reject', 'lock', 'revoke', 'proposal expiry', 'grant expiry'])(
  'rechecks authority after review on %s',
  async (reason) => {
    const f = await setup();

    await expect(f.submit()).resolves.toMatchObject({ status: 'pending' });

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

it('replays the original proposal after approving an edit and reconnecting', async () => {
  const accountId = 'b9d75762-922a-4525-96dc-2d34448ad465';
  const initial = addAccount(emptyLedger(), accountId, { name: 'Test account', currency: 'MXN', openingMinor: '0' });
  const f = await setup(['prepare-movement'], true, initial);
  const movement = {
    accountId,
    kind: 'expense' as const,
    amountMinor: '122',
    date: '2026-11-04',
    note: 'Test original',
  };
  const call = { capability: 'prepare-movement' as const, input: { requestId: input.requestId, movement } };
  const edited = { ...movement, amountMinor: '245', note: 'Test correction' };

  await expect(f.submit(call)).resolves.toMatchObject({ status: 'pending' });

  expect(f.ledger().movements).toHaveLength(0);

  await f.agent.approve(f.agent.review(edited));

  f.ledger.set(ledgerSchema.parse(JSON.parse(JSON.stringify(f.ledger()))));
  f.agent.revoke();

  await f.agent.connect('2'.repeat(64), ['prepare-movement']);

  await expect(f.submit(call)).resolves.toMatchObject({ proposalId: input.requestId, status: 'applied' });

  await expect(f.submit({ ...call, input: { ...call.input, movement: edited } })).resolves.toEqual({
    error: 'conflict',
  });

  expect(f.ledger().movements).toEqual([
    { id: input.requestId, movement: edited, proposalDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
  ]);

  expect(f.update).toHaveBeenCalledTimes(1);
});
