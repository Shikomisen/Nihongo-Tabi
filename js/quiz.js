/**
 * quiz.js — onboarding placement quiz (README §6a).
 *
 * Offline, no AI call. Pulls two sample cards from each of the 10
 * categories (one easy, one harder) for 20 self-graded items, then uses
 * the result to decide where each card enters the SRS deck.
 *
 * Self-graded on purpose: typing answers is slow, and the thing being
 * measured is "do you already have this", not production accuracy.
 */

import { loadContent } from './content.js';
import { el, clear, japaneseNode, phraseBlock } from './render.js';
import * as deck from './deck.js';
import * as srs from './srs.js';
import * as audio from './audio.js';

export const ANSWERS = {
  KNOWN: 'known',        // could say it unprompted
  RECOGNISED: 'seen',    // would understand it, couldn't produce it
  UNKNOWN: 'unknown',    // new
};

const WEIGHT = { known: 1, seen: 0.5, unknown: 0 };

/**
 * Two per category: the easiest available and the hardest available.
 * Anime-derived knowledge is lopsided — sampling both ends of each
 * category is what exposes the lopsidedness.
 */
export async function buildPlacementSet() {
  const { categories } = await loadContent();
  const picked = [];

  for (const cat of categories) {
    const pool = [...cat.phrases].sort((a, b) => (a.difficulty ?? 3) - (b.difficulty ?? 3));
    if (!pool.length) continue;
    const easy = pool[0];
    const hard = pool[pool.length - 1];
    picked.push({ ...easy, categoryId: cat.id, categoryTitle: cat.title });
    if (hard.id !== easy.id) {
      picked.push({ ...hard, categoryId: cat.id, categoryTitle: cat.title });
    }
  }

  return picked;
}

/**
 * Turn raw answers into a per-category score and seed the SRS deck.
 *
 * Per README §6a: cards answered "known" enter at a later interval;
 * "recognised" and "unknown" start at the normal first interval.
 */
export async function applyPlacement(items, answers) {
  const perCategory = {};

  for (const item of items) {
    const a = answers[item.id] ?? ANSWERS.UNKNOWN;
    const bucket = (perCategory[item.categoryId] ??= {
      known: 0, seen: 0, unknown: 0, n: 0, score: 0,
    });
    bucket[a] += 1;
    bucket.n += 1;
  }

  for (const bucket of Object.values(perCategory)) {
    bucket.score = bucket.n
      ? (bucket.known * WEIGHT.known + bucket.seen * WEIGHT.seen) / bucket.n
      : 0;
  }

  const totals = Object.values(perCategory).reduce(
    (acc, b) => ({ known: acc.known + b.known, seen: acc.seen + b.seen, n: acc.n + b.n }),
    { known: 0, seen: 0, n: 0 }
  );
  const overall = totals.n ? (totals.known + totals.seen * 0.5) / totals.n : 0;

  const result = { done: true, at: Date.now(), answers, perCategory, overall };
  await deck.savePlacement(result);

  // Seed the sampled cards themselves before category activation, so
  // activateCategory() sees them as already present and leaves them alone.
  const now = Date.now();
  for (const item of items) {
    const a = answers[item.id] ?? ANSWERS.UNKNOWN;
    const card = a === ANSWERS.KNOWN
      ? srs.seedKnown(item.id, item.categoryId, 6, 2.6, now)
      : srs.newCard(item.id, item.categoryId, now);
    await deck.putCard(card);
  }

  // README §7: week 1 is categories 1-4 only. Don't front-load all ten.
  const { categories } = await loadContent();
  for (const cat of categories.filter((c) => (c.week ?? 1) === 1)) {
    await deck.activateCategory(cat.id);
  }

  return result;
}

export function levelLabel(overall) {
  if (overall >= 0.75) return 'Strong start';
  if (overall >= 0.45) return 'Partial — lopsided, as expected';
  if (overall >= 0.2) return 'Early beginner';
  return 'Starting fresh';
}

/* ---------- screen ---------- */

export async function renderPlacement(root, { onDone }) {
  const items = await buildPlacementSet();
  const answers = {};
  let index = 0;

  const view = el('div', { class: 'screen placement' });
  root.append(view);

  function renderIntro() {
    clear(view);
    view.append(
      el('div', { class: 'placement-intro' },
        el('h1', {}, 'Where are you starting from?'),
        el('p', { class: 'lede' },
          `${items.length} quick cards across all ten categories. For each one, ` +
          'say whether you already have it. Nothing is typed and nothing is scored ' +
          'against you — it only decides where each card enters your review deck.'),
        el('p', { class: 'muted' },
          'Anime-derived Japanese is usually real but lopsided: strong passive vocabulary, ' +
          'casual register, gaps in the functional phrases nobody says on screen. ' +
          'This is looking for those gaps, not testing you.'),
        el('button', { class: 'btn btn-primary btn-lg', onclick: () => { index = 0; renderCard(); } },
          'Start'),
        el('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            // Skipping is legitimate — treat everything as unknown.
            await applyPlacement(items, {});
            onDone();
          },
        }, 'Skip — I\'m a complete beginner')
      )
    );
  }

  function renderCard() {
    if (index >= items.length) return renderResults();
    const item = items[index];
    clear(view);

    view.append(
      el('div', { class: 'placement-progress' },
        el('div', { class: 'bar' },
          el('div', { class: 'bar-fill', style: `width:${(index / items.length) * 100}%` })),
        el('div', { class: 'muted small' }, `${index + 1} of ${items.length} · ${item.categoryTitle}`)
      ),
      el('div', { class: 'placement-card' },
        japaneseNode(item, { furigana: true }),
        el('div', { class: 'romaji' }, item.romaji),
        el('button', {
          class: 'btn btn-ghost audio-inline',
          onclick: () => audio.play(item.audio),
        }, '🔊 Listen'),
        el('details', { class: 'reveal' },
          el('summary', {}, 'Show meaning'),
          el('div', { class: 'english' }, item.english))
      ),
      el('div', { class: 'placement-actions' },
        el('button', { class: 'btn btn-answer known', onclick: () => answer(ANSWERS.KNOWN) },
          el('strong', {}, 'I know this'), el('span', {}, 'could say it myself')),
        el('button', { class: 'btn btn-answer seen', onclick: () => answer(ANSWERS.RECOGNISED) },
          el('strong', {}, 'I recognise it'), el('span', {}, "understand it, couldn't say it")),
        el('button', { class: 'btn btn-answer unknown', onclick: () => answer(ANSWERS.UNKNOWN) },
          el('strong', {}, 'New to me'), el('span', {}, 'start from the beginning'))
      ),
      index > 0
        ? el('button', { class: 'btn btn-ghost back', onclick: () => { index--; renderCard(); } }, '← Back')
        : null
    );
  }

  function answer(value) {
    answers[items[index].id] = value;
    index++;
    renderCard();
  }

  async function renderResults() {
    clear(view);
    view.append(el('div', { class: 'loading' }, 'Building your deck…'));

    const result = await applyPlacement(items, answers);
    const { categories } = await loadContent();
    const summary = await deck.deckSummary();

    clear(view);
    view.append(
      el('div', { class: 'placement-results' },
        el('h1', {}, 'Deck built'),
        el('p', { class: 'lede' },
          `${levelLabel(result.overall)} — ${Math.round(result.overall * 100)}% of the sample already familiar.`),
        el('div', { class: 'result-grid' },
          categories.map((cat) => {
            const b = result.perCategory[cat.id];
            const pct = b ? Math.round(b.score * 100) : 0;
            return el('div', { class: 'result-row' },
              el('span', { class: 'result-name' }, `${cat.icon || ''} ${cat.title}`),
              el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` })),
              el('span', { class: 'result-pct' }, `${pct}%`));
          })),
        el('p', { class: 'muted' },
          `Categories 1-4 are loaded and ready (${summary.total} cards, ${summary.review} seeded forward ` +
          'because you already had them). The remaining categories unlock from the browse screen ' +
          'as the weeks go on — loading all ten at once would bury you in reviews.'),
        el('button', { class: 'btn btn-primary btn-lg', onclick: onDone }, 'Start studying')
      )
    );
  }

  renderIntro();
}
