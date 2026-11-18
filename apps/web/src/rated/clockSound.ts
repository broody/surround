// The clock's sounds, made with Web Audio so no files load: a soft tick each
// second of a warning and a two-note chime when byo-yomi begins or a period is
// used up. On by default; the choice is this browser's.

const KEY = "surround.clock-sound";

export function readClockSound(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeClockSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Without storage the choice lasts for this page.
  }
}

let context: AudioContext | null = null;

function tone(frequency: number, ms: number, volume: number, delay = 0) {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime + delay / 1000;
    const end = start + ms / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  } catch {
    // No audio (or not yet allowed): the clock still flashes.
  }
}

/** One second of a warning; higher on the last period. */
export const tick = (last: boolean) => tone(last ? 1320 : 880, 60, 0.05);

/** Byo-yomi began, or a period was used up. */
export const chime = () => {
  tone(660, 140, 0.06);
  tone(990, 200, 0.06, 150);
};
