import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Session } from '../auth/session/session';

import { welcomeEntry, welcomeGuard } from './welcome-entry';

@Component({ template: '' })
class TestPage {}

describe('first-use entry', () => {
  const user = { id: 'new-account', email: 'new@example.test', emailVerified: true };
  const full = signal(true);

  async function open(info?: object) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'home', component: TestPage },
          { path: 'welcome', component: TestPage, canActivate: [welcomeGuard] },
        ]),
        { provide: Session, useValue: { full, user: signal(user) } },
      ],
    });

    await RouterTestingHarness.create('/home');

    const router = TestBed.inject(Router);

    await router.navigateByUrl('/welcome', { info });

    return router;
  }

  beforeEach(() => full.set(true));

  it('admits the just-verified registration and sends a later visit home', async () => {
    const router = await open(welcomeEntry(user.id));

    expect(router.url).toBe('/welcome');

    await router.navigateByUrl('/home');

    await router.navigateByUrl('/welcome');

    expect(router.url).toBe('/home');
  });

  it.each([undefined, welcomeEntry('another-account')])(
    'rejects absent or unrelated registration evidence',
    async (info) => {
      const router = await open(info);

      expect(router.url).toBe('/home');
    },
  );

  it('requires a confirmed full session even with matching registration evidence', async () => {
    full.set(false);

    const router = await open(welcomeEntry(user.id));

    expect(router.url).toBe('/home');
  });
});
