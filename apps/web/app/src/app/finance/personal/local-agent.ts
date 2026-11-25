import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';
import {
  bearer,
  capabilities,
  enrollmentLifetime,
  localWebOrigin,
  postMovement,
  proposalLifetime,
  runtimeUrl,
  runtimeWork,
  sameMovement,
  summarize,
  validateMovement,
  type Capability,
  type MovementInput,
  type RuntimeCall,
  type RuntimeResult,
} from '@nive/finance';
import { z } from 'zod';

import { Session } from '../../auth/session/session';

import { LedgerStore } from './ledger-store';

type Link = {
  token: string;
  ownerId: string;
  sessionVersion: number;
  expiresAt: number;
  grants: readonly Capability[];
  cancellation: AbortController;
};
type Proposal = {
  id: string;
  movement: MovementInput;
  expiresAt: number;
};
type Receipt = { original: MovementInput; status: 'pending' | 'rejected' | 'applied' | 'expired' };
type ReviewedProposal = { proposal: Proposal; movement: MovementInput };
const next = z.strictObject({ work: runtimeWork.nullable(), expiresAt: z.number().int().positive() });

@Service({ autoProvided: false })
export class LocalAgent {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(Session);
  private readonly store = inject(LedgerStore);

  private readonly connection = signal<Link | null>(null);
  private readonly pending = signal<Proposal | null>(null);

  private readonly receipts = new Map<string, Receipt>();
  private readonly cleanup = this.destroyRef.onDestroy(() => this.revoke());

  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly connected = computed(() => this.connection() !== null);
  readonly grants = computed(() => this.connection()?.grants ?? []);

  readonly proposal = this.pending.asReadonly();

  async connect(value: string, requested: Capability[]): Promise<void> {
    const code = bearer.parse(value.trim());
    const grants = capabilities.parse(requested);
    const view = this.document.defaultView;
    const ownerId = this.session.user()?.id;

    if (!view || !localWebOrigin(view.location.origin) || !ownerId || this.connection() || this.destroyRef.destroyed) {
      throw new Error('unavailable');
    }

    await this.session.load(true);

    if (!this.session.full() || this.session.user()?.id !== ownerId || this.destroyRef.destroyed) {
      throw new Error('permission_denied');
    }

    const token = Array.from(view.crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const link: Link = {
      token,
      ownerId,
      sessionVersion: this.session.operationVersion(),
      expiresAt: Date.now() + enrollmentLifetime,
      grants,
      cancellation: new AbortController(),
    };
    const response = await this.request(
      '/pair',
      code,
      { channel: token, capabilities: grants },
      link.cancellation.signal,
    );

    if (response.status !== 204) {
      throw new Error('unavailable');
    }

    if (!this.sameSession(link)) {
      this.disconnect(link);

      throw new Error('permission_denied');
    }

    this.connection.set(link);
    this.schedule(link, 0);
  }

  revoke(): void {
    const link = this.connection();

    if (link) {
      this.disconnect(link);
    }
  }

  review(input: MovementInput): ReviewedProposal {
    const proposal = this.usableProposal();

    return { proposal, movement: validateMovement(this.store.ledger()!, input) };
  }

  async approve(review: ReviewedProposal): Promise<void> {
    const link = this.connection();

    if (!link || this.usableProposal() !== review.proposal) {
      throw new Error('expired');
    }

    await this.session.load(true);

    const authorized = () =>
      this.current(link) &&
      link.grants.includes('prepare-movement') &&
      this.store.ready() &&
      this.pending() === review.proposal &&
      Date.now() < review.proposal.expiresAt;

    if (!authorized()) {
      throw new Error('permission_denied');
    }

    await this.store.update((ledger) => postMovement(ledger, review.proposal.id, review.movement), authorized);

    const receipt = this.receipts.get(review.proposal.id);

    if (receipt) {
      receipt.status = 'applied';
    }

    this.pending.set(null);
  }

  reject(): void {
    const proposal = this.usableProposal();

    this.receipts.get(proposal.id)!.status = 'rejected';
    this.pending.set(null);
  }

  private usableProposal(): Proposal {
    const link = this.connection();
    const proposal = this.pending();

    if (!link || !this.current(link) || !this.store.ledger() || !proposal || Date.now() >= proposal.expiresAt) {
      throw new Error('expired');
    }

    return proposal;
  }

  private sameSession(link: Link): boolean {
    return (
      !this.destroyRef.destroyed &&
      this.session.full() &&
      this.session.user()?.id === link.ownerId &&
      this.session.operationVersion() === link.sessionVersion &&
      !this.session.cancellation().aborted
    );
  }

  private current(link: Link): boolean {
    return (
      this.connection() === link &&
      !link.cancellation.signal.aborted &&
      Date.now() < link.expiresAt &&
      this.sameSession(link)
    );
  }

  private disconnect(link: Link): void {
    if (this.connection() === link) {
      this.connection.set(null);
      clearTimeout(this.timer);
      this.pending.set(null);
      this.receipts.clear();
    }

    link.cancellation.abort();
    void this.request('/revoke', link.token, {}, undefined).catch(() => undefined);
  }

  private schedule(link: Link, delay = 400): void {
    this.timer = setTimeout(() => void this.poll(link), delay);
  }

  private async poll(link: Link): Promise<void> {
    if (!this.current(link)) {
      this.disconnect(link);

      return;
    }

    const signal = link.cancellation.signal;

    try {
      const response = await this.request('/next', link.token, {}, signal);

      if (!response.ok) {
        throw new Error('unavailable');
      }

      const payload: unknown = await response.json();
      const state = next.parse(payload);

      link.expiresAt = Math.min(link.expiresAt, state.expiresAt);

      if (!this.current(link)) {
        this.disconnect(link);

        return;
      }

      this.expireProposal();

      if (state.work) {
        const result = await this.run(link, state.work.call);

        if (!this.current(link)) {
          this.disconnect(link);

          return;
        }

        // A lock between reading and returning prevents release of the projection.
        const reply = this.store.ready() ? result : { error: 'locked' };

        await this.request('/reply', link.token, { id: state.work.id, result: reply }, signal);
      }
    } catch {
      this.disconnect(link);

      return;
    }

    if (this.current(link)) {
      this.schedule(link);
    }
  }

  private async run(link: Link, call: RuntimeCall): Promise<RuntimeResult> {
    if (!link.grants.includes(call.capability)) {
      return { error: 'permission_denied' };
    }

    if (!this.store.ready()) {
      return { error: 'locked' };
    }

    await this.session.load(true);

    if (!this.current(link)) {
      return { error: 'permission_denied' };
    }

    try {
      const ledger = await this.store.refresh();

      if (!this.current(link) || !this.store.ready()) {
        return { error: 'locked' };
      }

      if (call.capability === 'read-summary') {
        return summarize(ledger, call.input.month);
      }

      const { requestId, movement } = call.input;
      const receipt = this.receipts.get(requestId);

      if (receipt) {
        if (!sameMovement(receipt.original, movement)) {
          return { error: 'conflict' };
        }

        return receipt.status === 'expired' ? { error: 'expired' } : { proposalId: requestId, status: receipt.status };
      }

      const duplicate = ledger.movements.find((entry) => entry.id === requestId);

      if (duplicate) {
        return sameMovement(duplicate.movement, movement)
          ? { proposalId: requestId, status: 'applied' }
          : { error: 'conflict' };
      }

      if (this.pending() || this.receipts.size >= 100) {
        return { error: 'busy' };
      }

      const valid = validateMovement(ledger, movement);

      this.receipts.set(requestId, { original: valid, status: 'pending' });
      this.pending.set({ id: requestId, movement: valid, expiresAt: Date.now() + proposalLifetime });

      return { proposalId: requestId, status: 'pending' };
    } catch {
      return { error: this.store.ready() ? 'invalid' : 'locked' };
    }
  }

  private expireProposal(): void {
    const proposal = this.pending();

    if (proposal && (!this.store.ready() || Date.now() >= proposal.expiresAt)) {
      this.receipts.get(proposal.id)!.status = 'expired';
      this.pending.set(null);
    }
  }

  private request(path: '/pair' | '/next' | '/reply' | '/revoke', token: string, body: unknown, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(3500);

    return fetch(runtimeUrl + path, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }

  private readonly invalidate = effect(() => {
    const link = this.connection();

    if (link && !this.sameSession(link)) {
      this.disconnect(link);
    } else if (!this.store.ready()) {
      this.expireProposal();
    }
  });
}
