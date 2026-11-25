const idleMs = 5 * 60_000;

/** The wall-clock deadline also applies when the browser suspends timers. */
export function watchVaultActivity(document: Document, lock: () => void) {
  const view = document.defaultView;

  if (!view) {
    return { expired: () => false, stop: () => undefined };
  }

  let wallDeadline = Date.now() + idleMs;
  let monotonicDeadline = performance.now() + idleMs;
  let timer: number;
  const remaining = () => Math.min(wallDeadline - Date.now(), monotonicDeadline - performance.now());
  const expired = () => remaining() <= 0;
  const check = () => {
    view.clearTimeout(timer);

    if (expired()) {
      lock();
    } else {
      timer = view.setTimeout(check, remaining());
    }
  };
  const activity = (event: Event) => {
    if (expired()) {
      check();
    } else if (event.isTrusted && document.visibilityState !== 'hidden') {
      wallDeadline = Date.now() + idleMs;
      monotonicDeadline = performance.now() + idleMs;
    }
  };
  const events = new AbortController();

  for (const type of ['pointerdown', 'keydown', 'input', 'wheel']) {
    document.addEventListener(type, activity, { passive: true, signal: events.signal });
  }
  view.addEventListener('pagehide', lock, { signal: events.signal });
  view.addEventListener('pageshow', check, { signal: events.signal });
  view.addEventListener('focus', check, { signal: events.signal });
  document.addEventListener('visibilitychange', check, { signal: events.signal });
  check();

  return {
    expired,
    stop: () => {
      events.abort();
      view.clearTimeout(timer);
    },
  };
}
