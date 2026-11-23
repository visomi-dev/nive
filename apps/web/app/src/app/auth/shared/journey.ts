import { Service, signal } from '@angular/core';

import type { Pending, SessionSnapshot } from '../session/models';

export type ChallengePurpose = 'password' | 'email' | 'google' | 'reset' | 'recovery';
export type Challenge = Pending & { purpose: ChallengePurpose; factor?: 'email' | 'totp'; sentAt: number };

@Service({ autoProvided: false })
export class Journey {
  private readonly current = signal<Challenge | null>(null);

  // A successful registration response is the evidence that this identity is new.
  private registeredAccount: string | undefined;

  readonly challenge = this.current.asReadonly();

  start(purpose: ChallengePurpose, pending: Pending & { factor?: 'email' | 'totp' }): void {
    this.current.set({ ...pending, purpose, sentAt: Date.now() });
  }

  recordSignup(session: SessionSnapshot): void {
    this.registeredAccount = session.access === 'unverified' ? session.user?.id : undefined;
  }

  verifiedSignupAccount(session: SessionSnapshot): string | undefined {
    const user = session.user;

    return session.access === 'full' && user?.emailVerified && user.id === this.registeredAccount ? user.id : undefined;
  }

  clear(): void {
    this.current.set(null);
    this.registeredAccount = undefined;
  }
}
