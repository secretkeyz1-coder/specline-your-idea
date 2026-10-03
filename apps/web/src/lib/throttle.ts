/**
 * Run `fn` at most once per `ms`: the first call runs at once, calls inside
 * the window collapse into one trailing run at its end, so the last change is
 * never lost. The clock is injectable for tests.
 */
export type Clock = {
  now: () => number;
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realClock: Clock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function throttle(fn: () => void, ms: number, clock: Clock = realClock): (() => void) & { cancel: () => void } {
  let last = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  const fire = () => {
    timer = null;
    last = clock.now();
    fn();
  };
  const call = () => {
    const wait = last + ms - clock.now();
    if (wait <= 0) {
      if (timer !== null) clock.clear(timer);
      fire();
    } else if (timer === null) {
      timer = clock.set(fire, wait);
    }
  };
  return Object.assign(call, {
    cancel: () => {
      if (timer !== null) clock.clear(timer);
      timer = null;
    },
  });
}
