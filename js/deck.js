/**
 * deck.js — the bridge between content, SRS state and storage.
 *
 * Owns settings, which categories are active in the deck, and the
 * introduce/grade operations. Screens talk to this, never to store.js
 * directly.
 */

import * as store from './store.js';
import * as srs from './srs.js';
import { loadContent, getCharacterSet } from './content.js';

const DEFAULT_SETTINGS = {
  furigana: true,
  romaji: true,          // README §6: off by default after week 1 — see maybeRetireRomaji()
  textScale: 1,
  newPerDay: 10,
  newCharsPerDay: 15,    // characters are faster to review than phrases
  activeCategories: [],  // filled at placement time
  activeCharacterSets: [], // opt-in from the Characters screen
  autoPlayAudio: true,
  installedAt: null,
  romajiRetired: false,
};

let settingsCache = null;

export async function getSettings() {
  if (settingsCache) return settingsCache;
  const saved = (await store.get('meta', 'settings')) || {};
  settingsCache = { ...DEFAULT_SETTINGS, ...saved };
  if (!settingsCache.installedAt) {
    settingsCache.installedAt = Date.now();
    await store.set('meta', 'settings', settingsCache);
  }
  return settingsCache;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  settingsCache = { ...current, ...patch };
  await store.set('meta', 'settings', settingsCache);
  return settingsCache;
}

/**
 * README §6: romaji off by default after week 1. Rather than silently
 * yanking it, this flips the default once and tells the caller so the UI
 * can mention it. The user can turn it straight back on in settings.
 */
export async function maybeRetireRomaji() {
  const s = await getSettings();
  if (s.romajiRetired || !s.installedAt) return false;
  const weekOne = 7 * srs.DAY;
  if (Date.now() - s.installedAt < weekOne) return false;
  await saveSettings({ romaji: false, romajiRetired: true });
  return true;
}

/* ---------- placement ---------- */

export async function getPlacement() {
  return (await store.get('meta', 'placement')) || null;
}

export async function savePlacement(result) {
  await store.set('meta', 'placement', result);
  return result;
}

export async function isOnboarded() {
  const p = await getPlacement();
  return Boolean(p && p.done);
}

/* ---------- deck ---------- */

export async function getDeck() {
  const cards = await store.getAll('srs');
  return cards.filter(Boolean);
}

export async function getCard(id) {
  return store.get('srs', id);
}

export async function putCard(card) {
  await store.set('srs', card.id, card);
  return card;
}

/**
 * Introduce every phrase in a category into the deck.
 *
 * Placement results shape the starting interval: a category the user
 * clearly already has gets its easy cards seeded forward instead of
 * starting from zero (README §6a). Cards already in the deck are left
 * untouched.
 */
export async function activateCategory(categoryId) {
  const { byCategory } = await loadContent();
  const cat = byCategory.get(categoryId);
  if (!cat) return { added: 0, seeded: 0 };

  const placement = await getPlacement();
  const score = placement?.perCategory?.[categoryId]?.score ?? 0;
  const existing = new Set((await getDeck()).map((c) => c.id));

  const now = Date.now();
  const entries = [];
  let seeded = 0;

  for (const p of cat.phrases) {
    if (existing.has(p.id)) continue;
    const difficulty = p.difficulty ?? 3;
    const opts = { kind: srs.KIND.PHRASE, difficulty };

    let card;
    if (score >= 0.75 && difficulty <= 2) {
      card = srs.seedKnown(p.id, categoryId, 4, 2.6, now, opts);
      seeded++;
    } else if (score >= 0.5 && difficulty <= 1) {
      card = srs.seedKnown(p.id, categoryId, 2, 2.5, now, opts);
      seeded++;
    } else {
      card = srs.newCard(p.id, categoryId, now, opts);
    }
    entries.push([card.id, card]);
  }

  await store.setMany('srs', entries);

  const s = await getSettings();
  if (!s.activeCategories.includes(categoryId)) {
    await saveSettings({ activeCategories: [...s.activeCategories, categoryId] });
  }

  return { added: entries.length, seeded };
}

export async function deactivateCategory(categoryId) {
  const s = await getSettings();
  await saveSettings({ activeCategories: s.activeCategories.filter((c) => c !== categoryId) });
}

export async function isActive(categoryId) {
  const s = await getSettings();
  return s.activeCategories.includes(categoryId);
}

/* ---------- character sets ---------- */

/**
 * Introduce a character set into the deck.
 *
 * Mirrors activateCategory, including placement-driven seeding: someone
 * who already reads kana shouldn't be made to grind 104 cards from zero.
 * Cards are tagged kind:'character' so they never enter the phrase queue.
 */
export async function activateCharacterSet(setId) {
  const set = await getCharacterSet(setId);
  if (!set) return { added: 0, seeded: 0 };

  const placement = await getPlacement();
  const score = placement?.perCategory?.[setId]?.score ?? 0;
  const existing = new Set((await getDeck()).map((c) => c.id));

  const now = Date.now();
  const entries = [];
  let seeded = 0;

  for (const c of set.characters) {
    if (existing.has(c.id)) continue;
    const difficulty = c.difficulty ?? 3;
    const opts = { kind: srs.KIND.CHARACTER, difficulty };

    let card;
    if (score >= 0.75 && difficulty <= 2) {
      card = srs.seedKnown(c.id, setId, 4, 2.6, now, opts);
      seeded++;
    } else if (score >= 0.5 && difficulty <= 1) {
      card = srs.seedKnown(c.id, setId, 2, 2.5, now, opts);
      seeded++;
    } else {
      card = srs.newCard(c.id, setId, now, opts);
    }
    entries.push([card.id, card]);
  }

  await store.setMany('srs', entries);

  const s = await getSettings();
  if (!s.activeCharacterSets.includes(setId)) {
    await saveSettings({ activeCharacterSets: [...s.activeCharacterSets, setId] });
  }

  return { added: entries.length, seeded };
}

export async function deactivateCharacterSet(setId) {
  const s = await getSettings();
  await saveSettings({ activeCharacterSets: s.activeCharacterSets.filter((c) => c !== setId) });
}

export async function isSetActive(setId) {
  const s = await getSettings();
  return s.activeCharacterSets.includes(setId);
}

/** Review queue for characters only — never mixed with the phrase queue. */
export async function characterQueue(setId = null) {
  const s = await getSettings();
  const chars = srs.ofKind(await getDeck(), srs.KIND.CHARACTER);
  const scoped = setId
    ? chars.filter((c) => c.categoryId === setId)
    : chars.filter((c) => s.activeCharacterSets.includes(c.categoryId));
  return srs.buildQueue(scoped, { newLimit: s.newCharsPerDay });
}

export async function characterSummary() {
  const s = await getSettings();
  const chars = srs.ofKind(await getDeck(), srs.KIND.CHARACTER);
  return srs.summarise(chars.filter((c) => s.activeCharacterSets.includes(c.categoryId)));
}

export async function setProgress(setId) {
  const chars = srs.ofKind(await getDeck(), srs.KIND.CHARACTER);
  return srs.summarise(chars.filter((c) => c.categoryId === setId));
}

/** Grade a card and persist. Returns the updated record. */
export async function grade(cardId, quality) {
  const card = await getCard(cardId);
  if (!card) return null;
  const updated = srs.review(card, quality, Date.now());
  await putCard(updated);
  await bumpStat(quality, updated.kind ?? srs.KIND.PHRASE);
  return updated;
}

/* ---------- daily stats ---------- */

const todayKey = () => new Date().toISOString().slice(0, 10);

const EMPTY_DAY = { reviews: 0, again: 0, charReviews: 0, charAgain: 0 };

/**
 * Phrase and character reviews are counted separately so the "done today"
 * figure on the home screen stays a phrase figure — 40 kana drills
 * shouldn't make it look like you did your phrase reviews.
 */
async function bumpStat(quality, kind) {
  const key = todayKey();
  const stats = (await store.get('meta', 'stats')) || {};
  const day = { ...EMPTY_DAY, ...(stats[key] || {}) };

  if (kind === srs.KIND.CHARACTER) {
    day.charReviews += 1;
    if (quality < 3) day.charAgain += 1;
  } else {
    day.reviews += 1;
    if (quality < 3) day.again += 1;
  }

  stats[key] = day;
  await store.set('meta', 'stats', stats);
}

export async function todayStats() {
  const stats = (await store.get('meta', 'stats')) || {};
  // Spread over EMPTY_DAY so records written before characters existed
  // still report zeroes rather than undefined.
  return { ...EMPTY_DAY, ...(stats[todayKey()] || {}) };
}

export async function streak() {
  const stats = (await store.get('meta', 'stats')) || {};
  const studied = (day) => Boolean(day && ((day.reviews || 0) + (day.charReviews || 0)));

  let count = 0;
  const d = new Date();
  // Today only counts if something was actually reviewed; otherwise start
  // counting back from yesterday so an untouched today doesn't zero it.
  if (!studied(stats[d.toISOString().slice(0, 10)])) d.setDate(d.getDate() - 1);
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (studied(stats[key])) { count++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return count;
}

/** Review queue for the "due today" screen. Phrases only. */
export async function queue() {
  const s = await getSettings();
  const phrases = srs.ofKind(await getDeck(), srs.KIND.PHRASE);
  const active = new Set(s.activeCategories);
  const scoped = phrases.filter((c) => active.has(c.categoryId));
  return srs.buildQueue(scoped, { newLimit: s.newPerDay });
}

export async function deckSummary() {
  const s = await getSettings();
  const phrases = srs.ofKind(await getDeck(), srs.KIND.PHRASE);
  const active = new Set(s.activeCategories);
  return srs.summarise(phrases.filter((c) => active.has(c.categoryId)));
}

export async function categoryProgress(categoryId) {
  const deck = srs.ofKind(await getDeck(), srs.KIND.PHRASE)
    .filter((c) => c.categoryId === categoryId);
  return srs.summarise(deck);
}

export async function resetEverything() {
  await store.clearAll();
  settingsCache = null;
}
