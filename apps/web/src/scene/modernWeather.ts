const TAU = Math.PI * 2;
export const CLOUD_SPAN = 420;
export const CLOUD_SPEED = 0.85;

// Read local wall time afresh: timezone/system-clock changes and tab suspension
// must not accumulate drift. Ignore milliseconds to retain the one-second tick.
export function roomClock(now: Date = new Date()) {
  const seconds =
    (now.getHours() % 12) * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return {
    second: ((seconds % 60) / 60) * TAU,
    minute: ((seconds % 3600) / 3600) * TAU,
    hour: ((seconds % 43200) / 43200) * TAU,
  };
}

export function roomCloudOffset(time: number) {
  return (((time * CLOUD_SPEED) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN;
}

// The lower canopy remains planted behind the sill; only upper leaves flex.
export function roomTreeOffset(row: number, height: number, time: number) {
  const reach = Math.max(0, Math.min(1, 1 - row / height));
  if (reach === 0) return 0;
  return (
    reach *
    reach *
    (Math.sin(time * 0.65 + reach * 1.4) * 2.2 +
      Math.sin(time * 1.47 + reach * 3) * 0.6)
  );
}
