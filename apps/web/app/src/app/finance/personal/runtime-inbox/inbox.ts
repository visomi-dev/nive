import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  bearer,
  importDigest,
  importInput,
  inboxLabel,
  inboxState,
  localWebOrigin,
  runtimeUrl,
  type ImportBatch,
  type Ledger,
} from '@nive/finance';

import { Session } from '../../../auth/session/session';
import { LedgerStore } from '../ledger-store';

type Status = 'applied' | 'rejected';
type Reviewed = { before: Ledger; after: Ledger };
type Route = 'pair' | 'authorize' | 'status' | 'finish' | 'revoke';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(value.length / 2);

  for (let index = 0; index < result.length; index++) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return result;
}

@Service({ autoProvided: false })
export class Inbox {
  private readonly document = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);
  private readonly session = inject(Session);
  private readonly store = inject(LedgerStore);

  private readonly pending = signal<{ enrollmentId: string; batch: ImportBatch; digest: string } | null>(null);

  readonly online = signal(false);
  readonly expiresAt = signal(0);

  readonly enrollment = computed(() => this.store.ledger()?.runtimeInbox);
  readonly proposal = computed(() => {
    const current = this.enrollment();
    const pending = this.pending();

    return pending && current?.id === pending.enrollmentId && !current.revoked ? pending : null;
  });

  async pair(value: string): Promise<void> {
    const code = bearer.parse(value.trim());
    const check = await this.authority();
    const crypto = this.document.defaultView!.crypto;
    const current = this.enrollment();

    if (current?.revoked || this.online()) {
      throw new Error('enrollment_exists');
    }

    const enrollment = current ?? {
      id: crypto.randomUUID(),
      channel: hex(crypto.getRandomValues(new Uint8Array(32))),
      key: hex(crypto.getRandomValues(new Uint8Array(32))),
      revoked: false,
    };
    const keyProof = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(enrollment.key));

    if (!current) {
      await this.store.update((ledger) => {
        if (ledger.runtimeInbox) {
          throw new Error('enrollment_exists');
        }

        return { ...ledger, runtimeInbox: enrollment };
      }, check);
    }

    if (!check()) {
      throw new Error('locked');
    }

    await this.finishRequest('pair', code, {
      id: enrollment.id,
      channel: enrollment.channel,
      keyProof: hex(new Uint8Array(keyProof)),
    });

    await this.refresh();
  }

  async authorize(): Promise<void> {
    const check = await this.authority();
    const enrollment = this.enrollment();

    if (!enrollment || enrollment.revoked || !check()) {
      throw new Error('locked');
    }

    await this.finishRequest('authorize', enrollment.channel, enrollment.key);

    await this.refresh();
  }

  async revoke(): Promise<void> {
    const check = await this.authority();
    const enrollment = this.enrollment();

    if (!enrollment) {
      return;
    }

    await this.store.update((ledger) => {
      if (ledger.runtimeInbox?.id !== enrollment.id) {
        throw new Error('stale_review');
      }

      return { ...ledger, runtimeInbox: { ...ledger.runtimeInbox, revoked: true } };
    }, check);

    this.pending.set(null);
    this.online.set(false);
    this.expiresAt.set(0);

    await this.finishRequest('revoke', enrollment.channel, {});

    await this.store.update((ledger) => {
      if (ledger.runtimeInbox?.id !== enrollment.id || !ledger.runtimeInbox.revoked) {
        throw new Error('stale_review');
      }

      return { ...ledger, runtimeInbox: undefined };
    }, check);
  }

  async decide(id: string, digest: string, status: Status, reviewed?: Reviewed): Promise<void> {
    const check = await this.authority();
    const enrollment = this.enrollment();
    const proposal = this.proposal();

    if (
      !proposal ||
      proposal.batch.requestId !== id ||
      proposal.digest !== digest ||
      !enrollment ||
      !check() ||
      (status === 'applied' && !reviewed)
    ) {
      throw new Error('unavailable');
    }

    const decision = { id, status };

    await this.store.update((ledger) => {
      if (
        ledger.runtimeInbox?.id !== enrollment.id ||
        ledger.runtimeInbox.revoked ||
        ledger.runtimeInbox.decision?.id === id ||
        (reviewed && JSON.stringify(ledger) !== JSON.stringify(reviewed.before))
      ) {
        throw new Error('stale_review');
      }

      return { ...(reviewed?.after ?? ledger), runtimeInbox: { ...ledger.runtimeInbox, decision } };
    }, check);

    this.pending.set(null);

    // The encrypted local receipt also lets refresh acknowledge a lost loopback response.
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const enrollment = this.enrollment();

    if (!enrollment || enrollment.revoked) {
      return;
    }

    try {
      this.store.requireReady();

      const response = await this.request('status', enrollment.channel, {});

      if (!response.ok) {
        if (response.status === 403 && this.enrollment() === enrollment && !this.destroy.destroyed) {
          this.pending.set(null);
        }

        throw new Error('unavailable');
      }

      const value: unknown = await response.json();
      const state = inboxState.parse(value);

      if (this.enrollment() !== enrollment) {
        return;
      }

      this.store.requireReady();
      this.online.set(true);
      this.expiresAt.set(state.expiresAt);
      const sealed = state.proposal;

      if (!sealed) {
        this.pending.set(null);

        return;
      }

      if (enrollment.decision?.id === sealed.id) {
        await this.finishRequest('finish', enrollment.channel, enrollment.decision);

        return;
      }

      const crypto = this.document.defaultView!.crypto;
      const key = await crypto.subtle.importKey('raw', bytes(enrollment.key), 'AES-GCM', false, ['decrypt']);
      const clear = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes(sealed.iv),
          additionalData: inboxLabel(enrollment.id, sealed.id),
        },
        key,
        bytes(sealed.ciphertext),
      );
      let batch: ImportBatch;

      try {
        batch = importInput.parse(JSON.parse(new TextDecoder().decode(clear)));
      } finally {
        new Uint8Array(clear).fill(0);
      }

      if (batch.requestId !== sealed.id) {
        throw new Error('invalid');
      }

      const digest = await importDigest(batch);

      if (this.enrollment() === enrollment && !this.destroy.destroyed) {
        this.store.requireReady();
        const current = this.pending();

        if (
          current?.enrollmentId !== enrollment.id ||
          current.batch.requestId !== batch.requestId ||
          current.digest !== digest
        ) {
          this.pending.set({ enrollmentId: enrollment.id, batch, digest });
        }
      }
    } catch {
      if (this.enrollment() === enrollment && !this.destroy.destroyed) {
        this.online.set(false);
        this.expiresAt.set(0);
      }
    }
  }

  private async authority(): Promise<() => boolean> {
    const ready = this.store.guardReady();
    const owner = this.session.user()?.id;

    await this.session.load(true);

    this.store.requireReady();
    const version = this.session.operationVersion();
    const current = () =>
      Boolean(
        owner &&
        !this.destroy.destroyed &&
        localWebOrigin(this.document.defaultView?.location.origin) &&
        this.session.full() &&
        this.session.user()?.id === owner &&
        version === this.session.operationVersion() &&
        !this.session.cancellation().aborted &&
        ready(),
      );

    if (!current()) {
      throw new Error('permission_denied');
    }

    return current;
  }

  private async finishRequest(route: Route, token: string, data: unknown): Promise<void> {
    const response = await this.request(route, token, data);

    if (response.status !== 204) {
      throw new Error('unavailable');
    }
  }

  private request(route: Route, token: string, data: unknown): Promise<Response> {
    return fetch(runtimeUrl + '/inbox/' + route, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(3500),
    });
  }

  private readonly checkOnReturn = afterNextRender(() => {
    const events = new AbortController();

    this.document.addEventListener(
      'visibilitychange',
      () => {
        if (this.document.visibilityState === 'visible') {
          void this.refresh();
        }
      },
      { signal: events.signal },
    );

    this.destroy.onDestroy(() => events.abort());
  });

  private readonly resume = effect(() => {
    this.enrollment();
    untracked(() => void this.refresh());
  });
}
