import { TestBed } from '@angular/core/testing';

import type { SessionSnapshot } from '../session/models';

import { Journey } from './journey';

const created: SessionSnapshot = {
  authenticated: true,
  user: { id: 'new-account', email: 'new@example.test', emailVerified: false },
  method: 'password',
  access: 'unverified',
  nextStep: 'verify_email',
};
const verified: SessionSnapshot = {
  ...created,
  user: { ...created.user!, emailVerified: true },
  access: 'full',
  nextStep: null,
};

function journey(): Journey {
  return TestBed.configureTestingModule({ providers: [Journey] }).inject(Journey);
}

it('distinguishes a confirmed registration from verifying an existing account', () => {
  const flow = journey();

  expect(flow.verifiedSignupAccount(verified)).toBeUndefined();

  flow.recordSignup(created);
  expect(flow.verifiedSignupAccount(created)).toBeUndefined();
  expect(
    flow.verifiedSignupAccount({ ...verified, user: { ...verified.user!, id: 'different-account' } }),
  ).toBeUndefined();

  expect(flow.verifiedSignupAccount(verified)).toBe('new-account');

  flow.clear();
  expect(flow.verifiedSignupAccount(verified)).toBeUndefined();
});
