import { clamp, wordProgress } from './timed-lyrics.mjs';

// Colour follows the media position directly. Motion has its own, slower
// envelope, so a short word never produces a faster jump or delays its colour.
export function wordVisualState(word, now, fallbackEnd) {
  const end = word.end ?? fallbackEnd ?? word.time + 1;
  const elapsed = Number.isFinite(word.time) ? now - word.time : -Infinity;
  const ingress = clamp(elapsed / .7, 0, 1);
  return {
    progress: wordProgress({ ...word, end }, now),
    opacity: clamp(elapsed / .045, 0, 1),
    lift: 1.08 * ingress * ingress * (3 - 2 * ingress),
  };
}
