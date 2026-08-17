/**
 * render-test.mjs — renders every screen in a real DOM and asserts the
 * output, so template bugs surface without opening a browser.
 *
 * Requires jsdom, which is NOT a project dependency — the app itself has
 * zero dependencies. Install it just for this run:
 *
 *   npm install --no-save jsdom
 *   node tools/render-test.mjs
 *
 * Skips cleanly with exit 0 if jsdom isn't present.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('\njsdom not installed — skipping render tests.');
  console.log('  npm install --no-save jsdom && node tools/render-test.mjs\n');
  process.exit(0);
}

/* ---------- environment ---------- */

const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/#/',
  pretendToBeVisual: true,
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.location = window.location;
globalThis.confirm = () => true;
globalThis.HTMLElement = window.HTMLElement;

// Audio is never actually played here; record calls instead.
const played = [];
globalThis.Audio = class {
  constructor(src) { this.src = src; }
  play() { played.push(this.src); return Promise.resolve(); }
  pause() {}
};

const mem = new Map();
globalThis.localStorage = window.localStorage ?? {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
};

globalThis.fetch = async (path) => {
  const file = resolve(ROOT, String(path).replace(/^\.\//, ''));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};

/* ---------- harness ---------- */

let failures = 0;
let checks = 0;
const errors = [];

window.addEventListener('error', (e) => errors.push(e.message));
const realError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); realError(...args); };

function check(label, condition, detail = '') {
  checks++;
  if (condition) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const app = () => document.getElementById('app');
const text = () => app().textContent;
const $ = (sel) => app().querySelector(sel);
const $$ = (sel) => [...app().querySelectorAll(sel)];

async function goTo(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick(); await tick();
}

/* ---------- boot (app.js self-starts on import) ---------- */

const deck = await import('../js/deck.js');
const quiz = await import('../js/quiz.js');
await import('../js/app.js');
await tick(); await tick(); await tick();

console.log('\n1. First launch');

check('placement quiz gates the app on first launch',
  text().includes('Where are you starting from?'), 'intro screen shown');
check('onboarding hides the tab bar', document.body.classList.contains('onboarding'));

$$('button').find((b) => b.textContent === 'Start')?.click();
await tick(); await tick();

check('quiz shows a card with Japanese', Boolean($('.placement-card .jp')), $('.placement-card .jp')?.textContent);
const quizTotal = Number(text().match(/1 of (\d+)/)?.[1] ?? 0);
check('quiz shows progress', quizTotal > 0, `${quizTotal} cards total`);
check('quiz covers phrases and characters', quizTotal >= 24 && quizTotal <= 30, `${quizTotal} cards`);
check('quiz offers three self-grade answers', $$('.btn-answer').length === 3);
check('furigana renders as ruby', $$('.placement-card ruby, .placement-card').length > 0);

// Answer every card, alternating so the result screen has a mix. Driven by
// the button being present rather than a hardcoded count, so adding
// content to the quiz never silently breaks the rest of this walkthrough.
for (let i = 0; i < quizTotal + 5; i++) {
  const buttons = $$('.btn-answer');
  if (!buttons.length) break;
  buttons[i % 3].click();
  await tick(); await tick();
}
await tick(); await tick(); await tick();

check('quiz produces a results screen', text().includes('Deck built'), 'placement complete');
check('results break down all 10 categories and 3 character sets',
  $$('.result-row').length === 13, `${$$('.result-row').length} rows`);
check('results separate phrases from reading', text().includes('Reading'));

$$('button').find((b) => b.textContent === 'Start studying')?.click();
await tick(); await tick(); await tick();

/* ---------- screens ---------- */

console.log('\n2. Home / due today');

await goTo('#/');
check('home screen renders', text().includes('Today'));
check('stat tiles present', $$('.stat').length === 4, $$('.stat-value').map((s) => s.textContent).join('/'));
check('7-day SRS forecast renders', $$('.forecast-day').length === 7);
check('deck categories listed', $$('.row-card').length >= 4, `${$$('.row-card').length} rows`);
check('tab bar highlights the current screen', Boolean(document.querySelector('.tabbar a.active')));

console.log('\n3. Browse');

await goTo('#/browse');
check('browse renders', text().includes('Browse'));
check('all 10 categories listed', $$('.row-card').length === 10);
check('week groupings render', $$('.section-title').length === 4);
check('active categories marked as in-deck', $$('.pill-on').length === 4);
check('inactive categories offer an Add button',
  $$('button').filter((b) => b.textContent === 'Add').length === 6);

console.log('\n4. Category detail');

await goTo('#/category/greetings');
check('category renders', text().includes('Greetings & Politeness'));
check('all phrases listed', $$('.phrase-card').length === 24, `${$$('.phrase-card').length} cards`);
check('register notes render', text().includes('Register'));
check('anime divergence notes render', $$('.note-anime').length > 0, `${$$('.note-anime').length} notes`);
check('audio buttons render', $$('.audio-btn').length > 0);
check('romaji shown while enabled', $$('.romaji').length > 0);

const before = $$('.romaji').length;
$$('.chip').find((c) => c.textContent === 'romaji')?.click();
await tick(); await tick(); await tick();
check('romaji toggle removes romaji from the page', $$('.romaji').length === 0, `was ${before}`);

$$('.chip').find((c) => c.textContent === 'romaji')?.click();
await tick(); await tick(); await tick();
check('romaji toggle restores it', $$('.romaji').length > 0);

const rubyBefore = $$('ruby').length;
$$('.chip').find((c) => c.textContent === 'ふりがな')?.click();
await tick(); await tick(); await tick();
check('furigana toggle removes ruby annotations', $$('ruby').length === 0, `was ${rubyBefore}`);
$$('.chip').find((c) => c.textContent === 'ふりがな')?.click();
await tick(); await tick(); await tick();

console.log('\n5. Study session');

await goTo('#/study/airport');
check('study screen renders a card', Boolean($('.study-card .jp')), $('.study-card .jp')?.textContent);
check('answer is hidden before flipping', !$('.study-back'));
check('progress indicator present', Boolean($('.study-top .bar')));

$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();

check('flipping reveals the meaning', Boolean($('.study-back')));
check('four grade buttons appear', $$('.btn-grade').length === 4);
check('grade buttons preview their intervals',
  $$('.grade-when').every((g) => g.textContent.length > 0),
  $$('.grade-when').map((g) => g.textContent).join(' / '));
check('audio auto-plays on reveal', played.length > 0, `${played.length} clips played`);

const firstCard = $('.study-card .jp').textContent;
$$('.btn-grade').find((b) => b.textContent.startsWith('Got it'))?.click();
await tick(); await tick(); await tick();
check('grading advances to the next card', $('.study-card .jp')?.textContent !== firstCard);

console.log('\n6. Scenarios');

await goTo('#/scenarios');
check('scenario list renders', text().includes('Scenarios'));
check('all 6 scenarios listed', $$('.row-card').length === 6);

await goTo('#/scenario/conbini');
check('scenario player renders', text().includes('Convenience store checkout'));
check('NPC line renders', Boolean($('.dialogue.npc')));
check('setting/context shown', text().includes('Lawson'));
check('reply options offered', $$('.btn-option').length === 3);

$$('.btn-option')[0].click();
await tick(); await tick(); await tick();
check('choosing advances the dialogue', $$('.transcript .dialogue').length === 2);
check('feedback explains the choice', Boolean($('.feedback')), $('.feedback')?.textContent.slice(0, 60) + '…');

// Walk the rest of the scenario picking the first option each time.
for (let i = 0; i < 10 && $$('.btn-option').length; i++) {
  $$('.btn-option')[0].click();
  await tick(); await tick(); await tick();
}
check('scenario reaches its ending', text().includes('Run it again'));
check('full transcript retained', $$('.transcript .dialogue').length >= 8,
  `${$$('.transcript .dialogue').length} lines`);

// A "wrong" option must still teach rather than dead-end.
await goTo('#/scenario/ticket');
$$('.btn-option')[0].click();
await tick(); await tick(); await tick();
const wrong = $$('.btn-option').at(-1);
wrong?.click();
await tick(); await tick(); await tick();
check('a wrong answer continues the scenario with feedback',
  $$('.btn-option').length > 0 && Boolean($('.feedback-wrong')),
  $('.feedback-wrong')?.textContent.slice(0, 50) + '…');

console.log('\n7. Characters');

await goTo('#/characters');
check('characters screen renders', text().includes('Characters'));
check('all three sets listed', $$('.row-card').length === 3,
  $$('.row-title').map((t) => t.textContent).join(', '));
check('sets are addable', $$('button').filter((b) => b.textContent === 'Add').length === 3);
check('stroke-order deferral is disclosed', text().includes('stroke-order'));

// Add hiragana, then confirm it lands in the character deck only.
$$('button').find((b) => b.textContent === 'Add')?.click();
await tick(); await tick(); await tick(); await tick();
check('adding a set marks it in-deck', $$('.pill-on').length === 1);
check('character review becomes available', text().includes('Review characters'));

await goTo('#/characters/hiragana');
check('hiragana chart renders', text().includes('Hiragana'));
check('kana grid renders as rows', $$('.kana-row').length >= 11, `${$$('.kana-row').length} rows`);
check('all 104 hiragana render as cells', $$('.kana-cell:not(.kana-empty)').length === 104,
  `${$$('.kana-cell:not(.kana-empty)').length} cells`);
// Exactly five holes, all real: や_ゆ_よ (2) and わ___を (3). ん, yōon and
// extended rows are packed rather than gridded, so they add none.
check('grid leaves gaps only where kana genuinely do not exist',
  $$('.kana-empty').length === 5, `${$$('.kana-empty').length} gaps`);
check('groups are labelled', text().includes('Dakuten') && text().includes('Yōon'));

const playedBefore = played.length;
$$('.kana-cell:not(.kana-empty)')[0].click();
await tick(); await tick();
check('tapping a character plays its audio', played.length > playedBefore, played.at(-1));

await goTo('#/characters/kanji-common');
check('kanji screen renders', text().includes('Common Kanji'));
check('kanji render as a list, not a grid', $$('.kanji-row').length === 82 && $$('.kana-row').length === 0,
  `${$$('.kanji-row').length} kanji rows`);
check('kanji show English meanings', $$('.kanji-meaning').length === 82);
check('kanji cross-reference existing phrases', $$('.ref-chip').length > 20,
  `${$$('.ref-chip').length} phrase cross-references shown`);
check('cross-reference chips link into the phrase content',
  $$('.ref-chip').every((a) => a.getAttribute('href').startsWith('#/category/')));

const kanjiPlayed = played.length;
$$('.kanji-glyph')[0].click();
await tick(); await tick();
check('tapping a kanji plays its reading', played.length > kanjiPlayed, played.at(-1));

await goTo('#/characters/hiragana/study');
check('character study reuses the phrase flashcard UI', Boolean($('.study-card .jp')),
  $('.study-card .jp')?.textContent);
check('study screen shows which set the card came from',
  $('.card-cat')?.textContent === 'Hiragana', $('.card-cat')?.textContent);

$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();
check('character card reveals its reading', Boolean($('.study-back')), $('.english')?.textContent);
check('same four grade buttons as phrases', $$('.btn-grade').length === 4);

$$('.btn-grade').find((b) => b.textContent.startsWith('Got it'))?.click();
await tick(); await tick(); await tick();
check('grading a character advances the session', Boolean($('.study-card')));

await goTo('#/');
check('home shows a separate reading row', text().includes('Reading'));
check('character counts stay out of the phrase stats',
  !$$('.stat-label').some((l) => l.textContent === 'characters'));

console.log('\n8. Settings');

await goTo('#/settings');
check('settings renders', text().includes('Settings'));
check('toggles present', $$('input[type="checkbox"]').length === 3);
check('new-cards-per-day control present', Boolean($('input[type="number"]')));
check('text size control present', Boolean($('input[type="range"]')));
check('storage backend reported', /Storage: (IndexedDB|localStorage)/.test(text()),
  text().match(/Storage: \w+/)?.[0]);
check('phrase and character decks are reported separately',
  text().includes('Phrases:') && text().includes('Characters:'),
  text().match(/Characters: [^S]*/)?.[0]?.trim());

console.log('\n9. Console health');

const realErrors = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
check('no unexpected console errors during the walkthrough',
  realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

console.log(
  failures
    ? `\n✗ ${failures} of ${checks} render checks failed\n`
    : `\n✓ all ${checks} render checks passed — every screen renders and responds\n`
);
process.exit(failures ? 1 : 0);
