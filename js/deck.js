/**
 * deck.js — the bridge between content, SRS state and storage.
 *
 * Owns settings, which categories are active in the deck, and the
 * introduce/grade operations. Screens talk to this, never to store.js
 * directly.
 */

import * as store from './store.js';
import * as srs from './srs.js';
import { loadContent } from './content.js';

const DEFAULT_SETTINGS = {
  furigana: true,
  romaji: true,          // README §6: off by default after week 1 — see maybeRetireRomaji()
  textScale: 1,
  newPerDay: 10,
  activeCategories: [],  // filled at placement time
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

    let card;
    if (score >= 0.75 && difficulty <= 2) {
      card = srs.seedKnown(p.id, categoryId, 4, 2.6, now);
      seeded++;
    } else if (score >= 0.5 && difficulty <= 1) {
      card = srs.seedKnown(p.id, categoryId, 2, 2.5, now);
      seeded++;
    } else {
      card = srs.newCard(p.id, categoryId, now);
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

/** Grade a card and persist. Returns the updated record. */
export async function grade(cardId, quality) {
  const card = await getCard(cardId);
  if (!card) return null;
  const updated = srs.review(card, quality, Date.now());
  await putCard(updated);
  await bumpStat(quality);
  return updated;
}

/* ---------- daily stats ---------- */

const todayKey = () => new Date().toISOString().slice(0, 10);

async function bumpStat(quality) {
  const key = todayKey();
  const stats = (await store.get('meta', 'stats')) || {};
  const day = stats[key] || { reviews: 0, again: 0 };
  day.reviews += 1;
  if (quality < 3) day.again += 1;
  stats[key] = day;
  await store.set('meta', 'stats', stats);
}

export async function todayStats() {
  const stats = (await store.get('meta', 'stats')) || {};
  return stats[todayKey()] || { reviews: 0, again: 0 };
}

export async function streak() {
  const stats = (await store.get('meta', 'stats')) || {};
  let count = 0;
  const d = new Date();
  // Today only counts if something was actually reviewed; otherwise start
  // counting back from yesterday so an untouched today doesn't zero it.
  if (!stats[d.toISOString().slice(0, 10)]?.reviews) d.setDate(d.getDate() - 1);
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (stats[key]?.reviews) { count++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return count;
}

/** Review queue for the "due today" screen. */
export async function queue() {
  const s = await getSettings();
  const deck = await getDeck();
  const active = new Set(s.activeCategories);
  const scoped = deck.filter((c) => active.has(c.categoryId));
  return srs.buildQueue(scoped, { newLimit: s.newPerDay });
}

export async function deckSummary() {
  const s = await getSettings();
  const deck = await getDeck();
  const active = new Set(s.activeCategories);
  return srs.summarise(deck.filter((c) => active.has(c.categoryId)));
}

export async function categoryProgress(categoryId) {
  const deck = (await getDeck()).filter((c) => c.categoryId === categoryId);
  return srs.summarise(deck);
}

export async function resetEverything() {
  await store.clearAll();
  settingsCache = null;
}
