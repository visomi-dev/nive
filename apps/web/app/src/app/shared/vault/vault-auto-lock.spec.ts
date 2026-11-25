import { watchVaultActivity } from './vault-auto-lock';

it('keeps the deadline while hidden and ignores synthetic background activity', () => {
  vi.useFakeTimers();
  const lock = vi.fn();
  const activity = watchVaultActivity(document, lock);

  try {
    vi.advanceTimersByTime(240_000);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(59_999);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lock).toHaveBeenCalledOnce();
  } finally {
    activity.stop();
    vi.useRealTimers();
  }
});

it('reports expiration before suspended timers run and locks when the tab returns', () => {
  vi.useFakeTimers();
  const lock = vi.fn();
  const activity = watchVaultActivity(document, lock);

  try {
    vi.setSystemTime(Date.now() + 300_000);
    expect(activity.expired()).toBe(true);
    expect(lock).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(lock).toHaveBeenCalledOnce();
  } finally {
    activity.stop();
    vi.useRealTimers();
  }
});
