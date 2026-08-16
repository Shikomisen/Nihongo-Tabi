/**
 * integration-test.mjs — drives the real end-to-end loop headlessly.
 *
 * Imports the actual app modules (content → quiz → deck → srs) with just
 * enough of a browser shimmed in: fetch backed by the filesystem, and a
 * localStorage shim so store.js exercises its fallback path.
 *
 * This is the check that the loop the README cares about — browse →
 * placement quiz → study → SRS review — actually holds together, without
 * needing a browser.
 *
 *   node tools/integration-test.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- browser shims (must be installed before importing app code) ---------- */

const mem = new Map();
globalThis.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
};

globalThis.fetch = async (path) => {
  const file = resolve(ROOT, String(path));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};

const { loadContent } = await import('../js/content.js');
const deck = await import('../js/deck.js');
const srs = await import('../js/srs.js');
const quiz = await import('../js/quiz.js');

/* ---------- harness ---------- */

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ---------- 1. content loads ---------- */

console.log('\n1. Content layer');

const content = await loadContent();
check('manifest + all categories load', content.categories.length === 10, `${content.categories.length} categories`);
check('no category failed to load', content.categories.every((c) => !c.missing));
check('phrase index is populated', content.phrases.size > 100, `${content.phrases.size} phrases`);
check('categories are in trip-relevance order',
  content.categories.map((c) => c.order).join(',') === '1,2,3,4,5,6,7,8,9,10',
  content.categories.map((c) => c.id).join(' → '));

/* ---------- 2. placement quiz ---------- */

console.log('\n2. Placement quiz (§6a)');

const items = await quiz.buildPlacementSet();
check('quiz pulls ~15-20 cards', items.length >= 15 && items.length <= 20, `${items.length} cards`);

const covered = new Set(items.map((i) => i.categoryId));
check('quiz spans all 10 categories', covered.size === 10, `${covered.size} covered`);
check('quiz samples both ends of each category',
  content.categories.every((cat) => {
    const picks = items.filter((i) => i.categoryId === cat.id);
    return picks.length === 2 && picks[0].difficulty <= picks[1].difficulty;
  }));

// Simulate an anime-derived learner: strong on greetings/small talk,
// weak on the functional categories. Exactly the lopsidedness §6a describes.
const answers = {};
for (const item of items) {
  const strong = ['greetings', 'smalltalk'].includes(item.categoryId);
  answers[item.id] = strong
    ? quiz.ANSWERS.KNOWN
    : item.difficulty <= 2 ? quiz.ANSWERS.RECOGNISED : quiz.ANSWERS.UNKNOWN;
}

const result = await quiz.applyPlacement(items, answers);
check('placement is recorded as done', result.done === true);
check('per-category scores computed', Object.keys(result.perCategory).length === 10);
check('strong category scores high', result.perCategory.greetings.score === 1, String(result.perCategory.greetings.score));
check('weak category scores low', result.perCategory.airport.score < 0.5, String(result.perCategory.airport.score));
check('onboarding gate now passes', await deck.isOnboarded());

/* ---------- 3. deck seeding ---------- */

console.log('\n3. Deck seeding (§7 — week 1 only)');

const settings = await deck.getSettings();
check('only week-1 categories activated', settings.activeCategories.length === 4, settings.activeCategories.join(', '));
check('week-1 categories are 1-4',
  settings.activeCategories.sort().join(',') === 'airport,greetings,numbers,transport');

const allCards = await deck.getDeck();
check('deck populated from week-1 categories', allCards.length >= 88, `${allCards.length} cards`);

const knownGreeting = items.find((i) => i.categoryId === 'greetings');
const seededCard = await deck.getCard(knownGreeting.id);
check('"I know this" card was seeded forward, not queued today',
  seededCard.state === 'review' && seededCard.due > Date.now(),
  `due in ${Math.round((seededCard.due - Date.now()) / srs.DAY)} days`);

const greetingCards = allCards.filter((c) => c.categoryId === 'greetings');
const seededByCategory = greetingCards.filter((c) => c.state === 'review');
check('a strong category seeds its easy cards forward too',
  seededByCategory.length > 2, `${seededByCategory.length} of ${greetingCards.length} seeded`);

const airportCards = allCards.filter((c) => c.categoryId === 'airport');
check('a weak category starts entirely from scratch',
  airportCards.every((c) => c.state === 'new'), `${airportCards.length} cards, all new`);

/* ---------- 4. study session ---------- */

console.log('\n4. Study / review loop');

const queue = await deck.queue();
check('queue is capped by the new-card limit',
  queue.length <= settings.newPerDay + 5, `${queue.length} cards, limit ${settings.newPerDay}`);
check('queue is non-empty on day one', queue.length > 0);

const first = queue[0];
const graded = await deck.grade(first.id, srs.GRADE.GOOD);
check('grading advances the card', graded.reps === 1 && graded.interval === 1, `interval ${graded.interval}d`);
check('graded card is no longer due today', graded.due > Date.now());

const lapse = await deck.grade(queue[1].id, srs.GRADE.AGAIN);
check('failing a card keeps it in today\'s session', lapse.due - Date.now() < srs.DAY, `back in ${Math.round((lapse.due - Date.now()) / 60000)} min`);

const stats = await deck.todayStats();
check('daily stats recorded', stats.reviews === 2 && stats.again === 1, `${stats.reviews} reviews, ${stats.again} again`);

/* ---------- 5. persistence ---------- */

console.log('\n5. Persistence');

const reread = await deck.getCard(first.id);
check('graded state survives a re-read', reread.reps === 1 && reread.interval === 1);
check('storage fell back to localStorage cleanly', mem.size > 0, `${mem.size} keys written`);

/* ---------- 6. adding a category later ---------- */

console.log('\n6. Progressive rollout');

const before = (await deck.getDeck()).length;
const added = await deck.activateCategory('hotel');
const after = (await deck.getDeck()).length;
check('adding a category grows the deck', after === before + added.added, `+${added.added} cards`);
check('newly added category is active', await deck.isActive('hotel'));

// deckSummary() is deliberately scoped to *active* categories, while
// getDeck() returns every card — the placement quiz seeds two cards from
// each of the ten categories, including ones not yet rolled out (§7).
const active = new Set((await deck.getSettings()).activeCategories);
const activeCount = (await deck.getDeck()).filter((c) => active.has(c.categoryId)).length;

const summary = await deck.deckSummary();
check('deck summary is scoped to active categories only',
  summary.total === activeCount && summary.total < after,
  `${summary.total} active of ${after} stored`);
check('cards for not-yet-rolled-out categories are parked, not queued',
  (await deck.queue()).every((c) => active.has(c.categoryId)));

/* ---------- 7. scenario trees ---------- */

console.log('\n7. Scenario dialogue trees');

const { loadScenario, scenariosFor } = await import('../js/content.js');

check('scenarios are listed in the manifest', (content.manifest.scenarios || []).length === 6,
  `${(content.manifest.scenarios || []).length} scenarios`);

for (const entry of content.manifest.scenarios || []) {
  const sc = await loadScenario(entry.id);

  // Walk the tree picking the first "good" option at every node, which is
  // the path a competent speaker would take. It must reach a terminal node.
  let node = sc.nodes[sc.start];
  let steps = 0;
  let usedPhrases = 0;
  while (node && !node.end && steps < 25) {
    const opt = node.options.find((o) => o.quality === 'good') || node.options[0];
    if (opt.phraseId) {
      if (content.phrases.has(opt.phraseId)) usedPhrases++;
      else { check(`${entry.id}: option references a real phrase`, false, opt.phraseId); }
    }
    node = sc.nodes[opt.next];
    steps++;
  }
  check(`${entry.id}: the natural path reaches an ending`, Boolean(node?.end), `${steps} turns`);
  check(`${entry.id}: reuses phrases from the deck rather than duplicating text`, usedPhrases > 0,
    `${usedPhrases} phrase references on that path`);

  // Every branch, including the awkward and wrong ones, must lead somewhere.
  const dangling = Object.entries(sc.nodes).flatMap(([id, n]) =>
    (n.options || []).filter((o) => !sc.nodes[o.next]).map((o) => `${id}→${o.next}`));
  check(`${entry.id}: no dangling branches`, dangling.length === 0, dangling.join(', '));
}

const shoppingScenarios = await scenariosFor('shopping');
check('scenarios resolve by category', shoppingScenarios.length === 1 && shoppingScenarios[0].id === 'conbini');

/* ---------- result ---------- */

console.log(
  failures
    ? `\n✗ ${failures} of ${checks} integration checks failed\n`
    : `\n✓ all ${checks} integration checks passed — browse → quiz → study → review → scenarios loop is intact\n`
);
process.exit(failures ? 1 : 0);
