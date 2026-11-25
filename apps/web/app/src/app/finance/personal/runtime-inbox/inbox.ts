import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  bearer,
  deviceChallenge,
  deviceMessage,
  hex,
  importDigest,
  inboxLabel,
  inboxState,
  localWebOrigin,
  movementDigest,
  openDeviceMessage,
  pairingControlKey,
  postMovement,
  readOnlyCopy,
  runtimeCall,
  runtimeUrl,
  sealDeviceMessage,
  unhex,
  type Capability,
  type DeviceOperation,
  type InboxEnrollment,
  type MovementInput,
  type ImportBatch,
  type Ledger,
} from '@nive/finance';

import { Session } from '../../../auth/session/session';
import { LedgerStore } from '../ledger-store';

type Status = 'applied' | 'rejected';
type Reviewed = { before: Ledger; after: Ledger };
type Proposal = { enrollmentId: string; id: string; digest: string } & (
  { capability: 'prepare-import'; batch: ImportBatch } | { capability: 'prepare-movement'; movement: MovementInput }
);

@Service({ autoProvided: false })
export class Inbox {
  private readonly document = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);
  private readonly session = inject(Session);
  private readonly store = inject(LedgerStore);

  private readonly pending = signal<Proposal | null>(null);

  readonly enrollment = computed(() => this.store.ledger()?.runtimeInbox);

  private readonly currentProposal = computed(() => {
    const current = this.enrollment();
    const pending = this.pending();

    return pending && current?.id === pending.enrollmentId && !current.revoked ? pending : null;
  });

  private refreshSequence = 0;

  readonly online = signal(false);
  readonly expiresAt = signal(0);

  readonly proposal = computed(() => {
    const proposal = this.currentProposal();

    return proposal?.capability === 'prepare-import' ? proposal : null;
  });
  readonly movementProposal = computed(() => {
    const proposal = this.currentProposal();

    return proposal?.capability === 'prepare-movement' ? proposal : null;
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
      secureControl: true as const,
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

    const pair = { id: enrollment.id, channel: enrollment.channel, keyProof: hex(new Uint8Array(keyProof)) };

    await this.finishRequest('pair', enrollment, pair, check, code);

    await this.refresh();
  }

  async authorize(grants: Capability[]): Promise<void> {
    const check = await this.authority();
    const enrollment = this.enrollment();

    if (!enrollment || enrollment.revoked || !check()) {
      throw new Error('locked');
    }

    if (enrollment.secureControl) {
      const snapshot = await this.copy(grants);
      const canPrepare = grants.some((grant) => grant !== 'read-summary');

      await this.finishRequest(
        'authorize',
        enrollment,
        {
          capabilities: grants,
          snapshot,
          proposalKey: canPrepare ? enrollment.key : undefined,
        },
        check,
      );
    } else {
      await this.finishRequest('authorize', enrollment, enrollment.key, check);
    }

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

    await this.finishRequest('revoke', enrollment, {}, check);

    await this.store.update((ledger) => {
      if (ledger.runtimeInbox?.id !== enrollment.id || !ledger.runtimeInbox.revoked) {
        throw new Error('stale_review');
      }

      return { ...ledger, runtimeInbox: undefined };
    }, check);
  }

  async decide(id: string, digest: string, status: Status, reviewed?: Reviewed): Promise<void> {
    await this.recordDecision(id, digest, status, reviewed?.before, reviewed ? () => reviewed.after : undefined);
  }

  async decideMovement(
    proposal: NonNullable<ReturnType<Inbox['movementProposal']>>,
    reviewed?: { before: Ledger; movement: MovementInput },
  ): Promise<void> {
    await this.recordDecision(
      proposal.id,
      proposal.digest,
      reviewed ? 'applied' : 'rejected',
      reviewed?.before,
      reviewed ? (ledger) => postMovement(ledger, proposal.id, reviewed.movement, proposal.digest) : undefined,
    );
  }

  async refresh(): Promise<void> {
    const enrollment = this.enrollment();

    if (!enrollment || enrollment.revoked || !localWebOrigin(this.document.defaultView?.location.origin)) {
      return;
    }

    const request = ++this.refreshSequence;

    try {
      const ready = this.store.guardReady();
      const currentRequest = () => request === this.refreshSequence && ready() && !this.destroy.destroyed;
      const remote = await this.status(enrollment, currentRequest);
      const state = inboxState.parse(remote);

      if (this.enrollment() !== enrollment || !currentRequest()) {
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
        await this.finishRequest('finish', enrollment, enrollment.decision, currentRequest);

        return;
      }

      const crypto = this.document.defaultView!.crypto;
      const key = await crypto.subtle.importKey('raw', unhex(enrollment.key), 'AES-GCM', false, ['decrypt']);
      const clear = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: unhex(sealed.iv),
          additionalData: inboxLabel(enrollment.id, sealed.id, sealed.capability),
        },
        key,
        unhex(sealed.ciphertext),
      );
      let call: ReturnType<typeof runtimeCall.parse>;

      try {
        call = runtimeCall.parse({
          capability: sealed.capability ?? 'prepare-import',
          input: JSON.parse(new TextDecoder().decode(clear)),
        });
      } finally {
        new Uint8Array(clear).fill(0);
      }

      if (call.capability === 'read-summary' || call.input.requestId !== sealed.id) {
        throw new Error('invalid');
      }

      const digest = await this.digest(call);

      if (this.enrollment() !== enrollment || !currentRequest()) {
        return;
      }

      const ledger = this.store.ledger()!;
      const replay =
        call.capability === 'prepare-movement'
          ? ledger.movements.some((record) => record.id === sealed.id && record.proposalDigest === digest)
          : ledger.imports.some((record) => record.id === sealed.id && record.digest === digest);

      if (replay) {
        await this.finishRequest('finish', enrollment, { id: sealed.id, status: 'applied' }, currentRequest);

        this.pending.set(null);

        return;
      }

      const current = this.pending();

      if (
        current?.enrollmentId !== enrollment.id ||
        current.id !== sealed.id ||
        current.digest !== digest ||
        current.capability !== call.capability
      ) {
        const common = { enrollmentId: enrollment.id, id: sealed.id, digest };

        this.pending.set(
          call.capability === 'prepare-import'
            ? { ...common, capability: call.capability, batch: call.input }
            : { ...common, capability: call.capability, movement: call.input.movement },
        );
      }
    } catch {
      if (request === this.refreshSequence && this.enrollment() === enrollment && !this.destroy.destroyed) {
        this.online.set(false);
        this.expiresAt.set(0);
      }
    }
  }

  private async recordDecision(
    id: string,
    digest: string,
    status: Status,
    before?: Ledger,
    update?: (ledger: Ledger) => Ledger,
  ): Promise<void> {
    const check = await this.authority();
    const enrollment = this.enrollment();
    const proposal = this.currentProposal();

    if (
      !proposal ||
      proposal.id !== id ||
      proposal.digest !== digest ||
      !enrollment ||
      !check() ||
      (status === 'applied' && !update)
    ) {
      throw new Error('unavailable');
    }

    const decision = { id, status };

    await this.store.update((ledger) => {
      if (
        ledger.runtimeInbox?.id !== enrollment.id ||
        ledger.runtimeInbox.revoked ||
        ledger.runtimeInbox.decision?.id === id ||
        (before && JSON.stringify(ledger) !== JSON.stringify(before))
      ) {
        throw new Error('stale_review');
      }

      return { ...(update?.(ledger) ?? ledger), runtimeInbox: { ...ledger.runtimeInbox, decision } };
    }, check);

    this.pending.set(null);

    // The encrypted local receipt also lets refresh acknowledge a lost loopback response.
    await this.refresh();
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

  private digest(call: Exclude<ReturnType<typeof runtimeCall.parse>, { capability: 'read-summary' }>): Promise<string> {
    return call.capability === 'prepare-import' ? importDigest(call.input) : movementDigest(call.input.movement);
  }

  private async copy(grants: Capability[]) {
    if (!grants.includes('read-summary')) {
      return;
    }

    const { ledger, revision } = await this.store.runtimeSnapshot();

    return { ledger: readOnlyCopy(ledger), revision, capturedAt: new Date().toISOString() };
  }

  private async status(enrollment: InboxEnrollment, ready: () => boolean): Promise<unknown> {
    if (enrollment.secureControl) {
      const result = await this.control('status', enrollment.channel, {}, ready);

      if (result && typeof result === 'object' && 'revoked' in result && result.revoked === true) {
        this.pending.set(null);

        throw new Error('revoked');
      }

      return result;
    }

    const response = await this.request('/inbox/status', {}, enrollment.channel);

    if (!response.ok) {
      if (response.status === 403 && this.enrollment() === enrollment && !this.destroy.destroyed) {
        this.pending.set(null);
      }

      throw new Error('unavailable');
    }

    return response.json() as Promise<unknown>;
  }

  private async finishRequest(
    operation: DeviceOperation,
    enrollment: InboxEnrollment,
    data: unknown,
    allowed: () => boolean,
    code?: string,
  ): Promise<void> {
    if (enrollment.secureControl) {
      const secret = await this.controlSecret(enrollment, code);
      const answer = await this.control(operation, secret, data, allowed);

      if (answer && typeof answer === 'object' && 'ok' in answer && answer.ok === true) {
        return;
      }
    } else if (allowed()) {
      const response = await this.request('/inbox/' + operation, data, code ?? enrollment.channel);

      if (response.status === 204) {
        return;
      }
    }

    throw new Error('unavailable');
  }

  private async controlSecret(enrollment: InboxEnrollment, code?: string): Promise<string> {
    return code ? pairingControlKey(this.document.defaultView!.crypto, code) : enrollment.channel;
  }

  private async control(
    operation: DeviceOperation,
    secret: string,
    data: unknown,
    allowed: () => boolean,
  ): Promise<unknown> {
    const crypto = this.document.defaultView!.crypto;
    const challengeResponse = await this.request('/device/challenge', {});

    if (!challengeResponse.ok || !allowed()) {
      throw new Error('unavailable');
    }

    const offered: unknown = await challengeResponse.json();
    const challenge = deviceChallenge.parse(offered);
    const sealed = await sealDeviceMessage(crypto, secret, { operation, ...challenge }, 'request', data);

    if (!allowed()) {
      throw new Error('locked');
    }

    const response = await this.request('/device/control', sealed);

    if (!response.ok || !allowed()) {
      throw new Error('unavailable');
    }

    const returned: unknown = await response.json();
    const answer = deviceMessage.parse(returned);

    if (answer.operation !== operation || answer.challenge !== challenge.challenge) {
      throw new Error('invalid');
    }

    return openDeviceMessage(crypto, secret, answer, 'response');
  }

  private request(path: string, data: unknown, token?: string): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/json' });

    if (token) {
      headers.set('authorization', 'Bearer ' + token);
    }

    return fetch(runtimeUrl + path, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers,
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
