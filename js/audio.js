/**
 * audio.js — playback of the pre-generated, bundled clips (README §3-audio).
 *
 * This is deliberately dumb: it plays a file. There is no speechSynthesis
 * call anywhere in the app, so playback does not depend on the user's
 * device having a Japanese voice installed, and works fully offline once
 * the service worker has cached the clips.
 */

let current = null;
let unlocked = false;

/**
 * iOS/Safari refuse to play audio that wasn't started from a user gesture.
 * The first tap anywhere primes a silent element so later programmatic
 * playback (e.g. auto-play on card flip) is allowed.
 */
export function primeOnFirstGesture() {
  if (unlocked) return;
  const prime = () => {
    unlocked = true;
    document.removeEventListener('pointerdown', prime);
    document.removeEventListener('keydown', prime);
  };
  document.addEventListener('pointerdown', prime, { once: true });
  document.addEventListener('keydown', prime, { once: true });
}

/**
 * @param {string} src path to the bundled clip
 * @returns {Promise<'played'|'missing'|'blocked'>}
 */
export async function play(src) {
  if (!src) return 'missing';

  if (current) {
    current.pause();
    current.currentTime = 0;
  }

  const el = new Audio(src);
  el.preload = 'auto';
  current = el;

  try {
    await el.play();
    return 'played';
  } catch (err) {
    // NotAllowedError = autoplay policy; anything else = the file isn't there.
    return err && err.name === 'NotAllowedError' ? 'blocked' : 'missing';
  }
}

export function stop() {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
}

/** True if the clip actually exists — used to grey out dead play buttons. */
export async function exists(src) {
  if (!src) return false;
  try {
    const res = await fetch(src, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
