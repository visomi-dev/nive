import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { addAccount, emptyLedger, type Ledger } from '@nive/finance';
import { VaultError, type KeyDomain } from '@visomi-stack/shared-db';

import { Session } from '../../auth/session/session';
import { ClientDatabase } from '../../shared/db/database';
import { VaultSession } from '../../shared/vault/vault-session';

import { LedgerStore } from './ledger-store';

async function setup() {
  const ownerId = 'f3fb5025-6b05-4450-b65a-c9c5cfcd40ab';
  const accountId = 'b9d75762-922a-4525-96dc-2d34448ad465';
  const externalChange = addAccount(emptyLedger(), accountId, {
    name: 'Remote test account',
    currency: 'MXN',
    openingMinor: '0',
  });
  let saved: Ledger | undefined;
  const storage = { getUnit: vi.fn(), putUnit: vi.fn(), close: vi.fn() };
  const vault = {
    localBinding: async (key: KeyDomain) => ({ key, ownerId, method: 'passkey-prf' }),
    connect: vi.fn(),
    lockContext: vi.fn(),
    isSelected: () => true,
    isOpen: () => true,
    readTextEnvelope: async () => JSON.stringify(saved),
    prepare: vi.fn(),
  };

  const externalSave = () => {
    saved = externalChange;
    storage.getUnit.mockResolvedValue({
      context: {
        key: {
          product: 'nive',
          domain: 'personal-ledger',
          scope: { kind: 'tenant', tenantId: ownerId },
          generation: 1,
        },
        target: { kind: 'tenant', tenantId: ownerId },
        objectId: '8d1d93a7-0c32-4cea-9e21-729ba9e87cc1',
        schemaVersion: 1,
        revision: 1,
        kind: 'snapshot',
        previousCheckpoint: null,
      },
    });
  };

  TestBed.configureTestingModule({
    providers: [
      LedgerStore,
      { provide: DOCUMENT, useValue: { defaultView: { isSecureContext: true, location: { hostname: 'localhost' } } } },
      {
        provide: Session,
        useValue: { user: () => ({ id: ownerId }), full: () => true, cancellation: () => new AbortController().signal },
      },
      { provide: ClientDatabase, useValue: { vault: async () => storage } },
      { provide: VaultSession, useValue: vault },
    ],
  });
  const store = TestBed.inject(LedgerStore);

  await store.open();

  return { store, storage, externalSave, externalChange };
}

it('refreshes the ledger when an approval rejects the saved snapshot as stale', async () => {
  const { store, storage, externalSave, externalChange } = await setup();
  const before = store.ledger();

  externalSave();

  await expect(
    store.update((current) => {
      if (JSON.stringify(current) !== JSON.stringify(before)) {
        throw new Error('stale_review');
      }

      return current;
    }),
  ).rejects.toThrow('stale_review');

  expect(store.ledger()).toEqual(externalChange);
  expect(storage.putUnit).not.toHaveBeenCalled();
});

it('refreshes after a concurrent write wins the revision check', async () => {
  const { store, storage, externalSave, externalChange } = await setup();

  storage.putUnit.mockImplementation(async () => {
    externalSave();

    throw new VaultError('revision-conflict');
  });

  await expect(store.update((ledger) => ({ ...ledger }))).rejects.toMatchObject({ code: 'revision-conflict' });

  expect(store.ledger()).toEqual(externalChange);
  expect(storage.putUnit).toHaveBeenCalledTimes(1);
});
