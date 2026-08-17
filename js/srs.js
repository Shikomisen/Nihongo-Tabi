/**
 * srs.js — SM-2 spaced repetition, implemented directly (README §3).
 *
 * Deliberately not over-engineered: classic SM-2 intervals with a short
 * same-session learning step for lapses, so a card you just failed comes
 * back before you leave the review screen.
 *
 * A card record looks like:
 *   {
 *     id, categoryId,
 *     kind,       // 'phrase' | 'character' — keeps the two decks separate
 *     difficulty, // 1-5, copied from content so the queue can order new cards
 *     ease,       // SM-2 easiness factor, floor 1.3
 *     interval,   // days
 *     reps,       // consecutive successful reviews
 *     lapses,
 *     due,        // epoch ms
 *     state,      // 'new' | 'learning' | 'review'
 *     introduced, // epoch ms, first time it entered the deck
 *     lastReview, // epoch ms
 *     seededBy,   // 'placement' | 'study' | null — provenance, for debugging
 *   }
 *
 * `kind` defaults to 'phrase' so records written before the Characters
 * section existed keep working untouched.
 */

export const DAY = 86400000;
export const MIN = 60000;

export const GRADE = {
  AGAIN: 0, // "No idea"      -> SM-2 quality 0
  HARD: 3,  // "Shaky"        -> quality 3
  GOOD: 4,  // "Got it"       -> quality 4
  EASY: 5,  // "Too easy"     -> quality 5
};

const LEARNING_STEP = 10 * MIN;

export const KIND = { PHRASE: 'phrase', CHARACTER: 'character' };

export function newCard(id, categoryId, now = Date.now(), opts = {}) {
  const { kind = KIND.PHRASE, difficulty = 3 } = opts;
  return {
    id,
    categoryId,
    kind,
    difficulty,
    ease: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: now,
    state: 'new',
    introduced: now,
    lastReview: null,
    seededBy: null,
  };
}

/**
 * Seed a card as already-known, skipping the early intervals.
 * Used by the placement quiz (README §6a) so week 1 isn't spent on
 * material that's already retained.
 *
 * @param {number} intervalDays starting interval
 */
export function seedKnown(id, categoryId, intervalDays, ease = 2.6, now = Date.now(), opts = {}) {
  return {
    ...newCard(id, categoryId, now, opts),
    ease,
    interval: intervalDays,
    reps: 2,
    state: 'review',
    due: now + intervalDays * DAY,
    lastReview: now,
    seededBy: 'placement',
  };
}

/**
 * Apply a grade to a card and return the updated record.
 * Pure — callers persist the result themselves.
 */
export function review(card, quality, now = Date.now()) {
  const c = { ...card };
  c.lastReview = now;

  if (quality < 3) {
    // Lapse. Back to a short learning step, keep the card's history.
    c.reps = 0;
    c.lapses += 1;
    c.interval = 0;
    c.state = 'learning';
    c.due = now + LEARNING_STEP;
    c.ease = Math.max(1.3, c.ease - 0.2);
    return c;
  }

  // Successful recall — standard SM-2 interval ladder.
  if (c.reps === 0) c.interval = 1;
  else if (c.reps === 1) c.interval = 6;
  else c.interval = Math.round(c.interval * c.ease);

  c.reps += 1;
  c.state = 'review';

  // SM-2 easiness update.
  const q = quality;
  c.ease = Math.max(1.3, c.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  // "Too easy" on a card that keeps coming back too often gets a nudge.
  if (q === GRADE.EASY && c.interval > 1) c.interval = Math.round(c.interval * 1.3);

  c.due = now + c.interval * DAY;
  return c;
}

/** Cards whose due time has passed, excluding brand-new ones. */
export function dueCards(cards, now = Date.now()) {
  return cards.filter((c) => c.state !== 'new' && c.due <= now);
}

/** Cards that have never been studied. */
export function newCards(cards) {
  return cards.filter((c) => c.state === 'new');
}

/**
 * Build a review queue: everything due, plus up to `newLimit` new cards,
 * ordered so due material comes first and new material is interleaved
 * behind it.
 */
export function buildQueue(cards, { newLimit = 10, now = Date.now() } = {}) {
  const due = dueCards(cards, now).sort((a, b) => a.due - b.due);
  // New cards come easiest-first. This matters most for the kana sets:
  // adding hiragana introduces 104 cards at once, and the 46 base
  // characters have to arrive before the yōon combinations built from them.
  const fresh = newCards(cards)
    .sort((a, b) => (a.difficulty ?? 3) - (b.difficulty ?? 3) || a.introduced - b.introduced)
    .slice(0, newLimit);
  return [...due, ...fresh];
}

/** Split a mixed deck by kind — phrases and characters never share a queue. */
export function ofKind(cards, kind) {
  return cards.filter((c) => (c.kind ?? KIND.PHRASE) === kind);
}

/** Human-readable "next review in …" for the UI. */
export function formatInterval(card) {
  if (card.state === 'new') return 'new';
  const ms = card.due - Date.now();
  if (ms <= 0) return 'now';
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} hr`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  return `${Math.round(days / 30)} mo`;
}

/** Preview of what each grade button would schedule, for the answer screen. */
export function gradePreviews(card, now = Date.now()) {
  return Object.fromEntries(
    Object.entries(GRADE).map(([name, q]) => [name, formatInterval(review(card, q, now))])
  );
}

/** Aggregate stats for the home screen. */
export function summarise(cards, now = Date.now()) {
  return {
    total: cards.length,
    due: dueCards(cards, now).length,
    new: newCards(cards).length,
    learning: cards.filter((c) => c.state === 'learning').length,
    review: cards.filter((c) => c.state === 'review').length,
    mature: cards.filter((c) => c.interval >= 21).length,
  };
}
