import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { Session } from '../auth/session/session';

const registrationAccount = Symbol();

export function welcomeEntry(accountId: string): object {
  return { [registrationAccount]: accountId };
}

export const welcomeGuard: CanActivateFn = () => {
  const router = inject(Router);
  const session = inject(Session);
  // Router info belongs to the current navigation and is never written to browser history.
  const info = router.currentNavigation()?.extras.info;

  return session.full() &&
    typeof info === 'object' &&
    info !== null &&
    registrationAccount in info &&
    info[registrationAccount] === session.user()?.id
    ? true
    : router.parseUrl('/home');
};
