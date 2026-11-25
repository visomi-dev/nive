import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';
import { emptyLedger, ledgerSchema, type Ledger } from '@nive/finance';
import {
  dataAad,
  vaultUnitId,
  VaultError,
  type DataContext,
  type KeyDomain,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import { createPrfCredential } from '@visomi-stack/web-frontend-db';

import { Session } from '../../auth/session/session';
import { ClientDatabase } from '../../shared/db/database';
import { VaultSession } from '../../shared/vault/vault-session';

const ledgerId = '8d1d93a7-0c32-4cea-9e21-729ba9e87cc1';

function ledgerKey(ownerId: string): KeyDomain {
  return { product: 'nive', domain: 'personal-ledger', scope: { kind: 'tenant', tenantId: ownerId }, generation: 1 };
}

function context(key: KeyDomain, revision: number): DataContext {
  return {
    key,
    target: key.scope,
    objectId: ledgerId,
    schemaVersion: 1,
    revision,
    kind: 'snapshot',
    previousCheckpoint: null,
  };
}

@Service({ autoProvided: false })
export class LedgerStore {
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(Session);
  private readonly database = inject(ClientDatabase);
  private readonly vault = inject(VaultSession);
  private readonly destroyRef = inject(DestroyRef);

  private readonly binding = signal<WrappingContext | null>(null);
  private readonly contents = signal<{ ledger: Ledger; revision: number } | null>(null);

  private readonly lifetime = new AbortController();
  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.lifetime.abort();
    this.lock();
  });

  private opening: AbortController | undefined;

  readonly configured = signal<boolean | null>(null);

  readonly ready = computed(() => {
    const binding = this.binding();

    return Boolean(binding && this.vault.isSelected(binding) && this.vault.isOpen(binding));
  });
  readonly ledger = computed(() => (this.ready() ? (this.contents()?.ledger ?? null) : null));

  async detect(): Promise<void> {
    const ownerId = this.session.user()?.id;

    if (ownerId && this.session.full() && !this.lifetime.signal.aborted) {
      const binding = await this.vault.localBinding(ledgerKey(ownerId));

      this.configured.set(Boolean(binding));
    }
  }

  async open(): Promise<void> {
    const ownerId = this.session.user()?.id;
    const view = this.document.defaultView;

    if (!ownerId || !view?.isSecureContext || !this.session.full() || this.opening || this.lifetime.signal.aborted) {
      throw new VaultError('unavailable');
    }

    const opening = new AbortController();

    this.opening = opening;
    const signal = AbortSignal.any([opening.signal, this.lifetime.signal, this.session.cancellation()]);
    const key = ledgerKey(ownerId);
    let selected: WrappingContext | undefined;

    try {
      const existing = await this.vault.localBinding(key);

      signal.throwIfAborted();

      if (existing) {
        if (existing.method !== 'passkey-prf') {
          throw new VaultError('unavailable');
        }

        selected = existing;
      } else {
        const storage = await this.database.vault(ownerId, signal);

        try {
          const unit = await storage.getUnit(vaultUnitId(ownerId, context(key, 1)));

          if (unit) {
            throw new VaultError('recovery-required');
          }
        } finally {
          storage.close();
        }
        const methodId = await createPrfCredential(
          {
            origin: view.location.origin,
            rpId: view.location.hostname,
            credentials: view.navigator.credentials,
            crypto: view.crypto,
          },
          signal,
        );

        selected = {
          key,
          ownerId,
          deviceId: view.crypto.randomUUID(),
          origin: view.location.origin,
          method: 'passkey-prf',
          methodId,
        };
      }

      signal.throwIfAborted();
      this.binding.set(selected);

      await this.vault.connect(selected, view.location.hostname, !existing);

      signal.throwIfAborted();
      this.configured.set(true);

      await this.refresh();
    } catch (error) {
      if (selected) {
        this.vault.lockContext(selected);
      }

      throw error;
    } finally {
      this.opening = undefined;
    }
  }

  lock(): void {
    this.opening?.abort();
    const binding = this.binding();

    if (binding) {
      this.vault.lockContext(binding);
    }

    this.binding.set(null);
    this.contents.set(null);
  }

  async refresh(): Promise<Ledger> {
    const binding = this.active();
    const storage = await this.database.vault(binding.ownerId, this.lifetime.signal);

    try {
      const snapshot = await this.read(binding, storage);

      this.publish(snapshot);

      return snapshot.ledger;
    } finally {
      storage.close();
    }
  }

  async update(transform: (ledger: Ledger) => Ledger, authorized = () => true): Promise<void> {
    const binding = this.active();
    const storage = await this.database.vault(binding.ownerId, this.lifetime.signal);
    const allowed = () => {
      this.current(binding);

      if (!authorized()) {
        throw new VaultError('stale-operation');
      }
    };

    try {
      const { ledger, revision } = await this.read(binding, storage);

      allowed();
      const updated = transform(ledger);
      const savedRevision = updated === ledger ? revision : revision + 1;

      if (updated !== ledger) {
        const next = context(binding.key, savedRevision);
        const encrypted = await this.vault.prepare(next, JSON.stringify(updated));

        allowed();

        await storage.putUnit(vaultUnitId(binding.ownerId, next), revision, encrypted, allowed);
      }

      this.current(binding);
      this.publish({ ledger: updated, revision: savedRevision });
    } finally {
      storage.close();
    }
  }

  private active(): WrappingContext {
    const binding = this.binding();

    if (!binding || !this.ready() || this.lifetime.signal.aborted) {
      throw new VaultError('locked');
    }

    return binding;
  }

  private current(binding: WrappingContext): void {
    if (this.active() !== binding) {
      throw new VaultError('stale-operation');
    }
  }

  private publish(snapshot: { ledger: Ledger; revision: number }): void {
    if ((this.contents()?.revision ?? -1) <= snapshot.revision) {
      this.contents.set(snapshot);
    }
  }

  private async read(binding: WrappingContext, storage: Awaited<ReturnType<ClientDatabase['vault']>>) {
    const envelope = await storage.getUnit(vaultUnitId(binding.ownerId, context(binding.key, 1)));

    this.current(binding);

    if (!envelope) {
      return { ledger: emptyLedger(), revision: 0 };
    }

    const revision = envelope.context.revision;

    if (dataAad(envelope.context) !== dataAad(context(binding.key, revision))) {
      throw new VaultError('corrupt');
    }

    const text = await this.vault.readTextEnvelope(envelope);

    this.current(binding);

    return { ledger: ledgerSchema.parse(JSON.parse(text) as unknown), revision };
  }

  private readonly clearLocked = effect(() => {
    if (!this.ready()) {
      this.contents.set(null);
    }
  });
}
