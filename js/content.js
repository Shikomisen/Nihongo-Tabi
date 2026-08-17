/**
 * content.js — content loader (README §3a).
 *
 * The app never hardcodes a category. Everything comes from
 * content/manifest.json, so adding a category is: drop in a JSON file,
 * add one manifest line. No app code changes.
 */

let cache = null;

const SUPPORTED_SCHEMA = 1;

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

/**
 * Character sets (hiragana / katakana / kanji) are stored in the same
 * phrase-shaped schema so every existing component — the flashcard
 * session, japaneseNode's ruby rendering, the furigana/romaji toggles,
 * the audio button — renders them with no special-casing.
 *
 * The only thing synthesised here is a display `english` for kana, which
 * genuinely has no meaning to show; the JSON keeps `english: null` and
 * `meaning` preserves whatever the file actually declared.
 */
function normaliseCharacter(c, set) {
  return {
    ...c,
    kind: 'character',
    categoryId: set.id,
    categoryTitle: set.title,
    script: set.script,
    meaning: c.english ?? null,
    english: c.english ?? `reads “${c.romaji}”`,
  };
}

/**
 * Loads the manifest, every category file, and every character set.
 * Returns { manifest, categories, characterSets, phrases, characters,
 *           byCategory, bySet }
 *
 * `phrases` is the lookup-by-id index for anything studiable, characters
 * included — that is what lets the review session find a card's content
 * without caring which deck it came from.
 */
export async function loadContent() {
  if (cache) return cache;

  const manifest = await fetchJSON('content/manifest.json');
  if (manifest.schemaVersion > SUPPORTED_SCHEMA) {
    console.warn(
      `Content schemaVersion ${manifest.schemaVersion} is newer than this app supports (${SUPPORTED_SCHEMA}). Rendering anyway.`
    );
  }

  const entries = [...manifest.categories].sort((a, b) => a.order - b.order);

  const loaded = await Promise.all(
    entries.map(async (entry) => {
      try {
        const data = await fetchJSON(entry.file);
        return { ...entry, ...data, phrases: data.phrases || [], missing: false };
      } catch (err) {
        // A category file that fails to load must not take the app down.
        console.error(err);
        return { ...entry, phrases: [], missing: true };
      }
    })
  );

  const setEntries = [...(manifest.characterSets || [])].sort((a, b) => a.order - b.order);

  const loadedSets = await Promise.all(
    setEntries.map(async (entry) => {
      try {
        const data = await fetchJSON(entry.file);
        return { ...entry, ...data, characters: data.characters || [], missing: false };
      } catch (err) {
        console.error(err);
        return { ...entry, characters: [], groups: [], missing: true };
      }
    })
  );

  const phrases = new Map();
  const characters = new Map();
  const byCategory = new Map();
  const bySet = new Map();

  for (const cat of loaded) {
    byCategory.set(cat.id, cat);
    for (const p of cat.phrases) {
      phrases.set(p.id, { ...p, kind: 'phrase', categoryId: cat.id, categoryTitle: cat.title });
    }
  }

  for (const set of loadedSets) {
    const normalised = set.characters.map((c) => normaliseCharacter(c, set));
    bySet.set(set.id, { ...set, characters: normalised });
    for (const c of normalised) {
      characters.set(c.id, c);
      phrases.set(c.id, c); // shared id index — see the note above
    }
  }

  cache = {
    manifest,
    categories: loaded,
    characterSets: [...bySet.values()],
    phrases,
    characters,
    byCategory,
    bySet,
  };
  return cache;
}

export async function getPhrase(id) {
  const { phrases } = await loadContent();
  return phrases.get(id);
}

export async function getCategory(id) {
  const { byCategory } = await loadContent();
  return byCategory.get(id);
}

export async function getCharacterSet(id) {
  const { bySet } = await loadContent();
  return bySet.get(id);
}

export async function getCharacter(id) {
  const { characters } = await loadContent();
  return characters.get(id);
}

/**
 * Kana laid out as the traditional grid: rows are consonants, columns are
 * vowels. Returns [{ row, cells: [character|null, …] }] with gaps left as
 * null so や・ゆ・よ and わ・を line up under the right vowel columns.
 */
export function gridFor(set, group = 'base') {
  const inGroup = set.characters.filter((c) => c.group === group);
  const columns = ['a', 'i', 'u', 'e', 'o'];

  // Whether a row sits on the vowel grid is decided per row, not per group.
  // や・ゆ・よ and わ・を genuinely have vowel-column holes worth showing;
  // ん (column "n"), yōon (ya/yu/yo) and extended katakana do not sit on the
  // grid at all, and reserving five vowel slots for them would emit a
  // screenful of empty cells.
  const order = [];
  const byRow = new Map();

  for (const c of inGroup) {
    if (!byRow.has(c.row)) { byRow.set(c.row, []); order.push(c.row); }
    byRow.get(c.row).push(c);
  }

  return order.map((row) => {
    const chars = byRow.get(row);
    if (!chars.some((c) => columns.includes(c.column))) return { row, cells: chars };

    const cells = columns.map(() => null);
    for (const c of chars) {
      const idx = columns.indexOf(c.column);
      if (idx >= 0) cells[idx] = c;
      else cells.push(c);
    }
    return { row, cells };
  });
}

/** Scenario trees are loaded on demand — they're only needed on one screen. */
const scenarioCache = new Map();

export async function loadScenario(id) {
  if (scenarioCache.has(id)) return scenarioCache.get(id);
  const { manifest } = await loadContent();
  const entry = manifest.scenarios?.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown scenario: ${id}`);
  const data = await fetchJSON(entry.file);
  const merged = { ...entry, ...data };
  scenarioCache.set(id, merged);
  return merged;
}

export async function scenariosFor(categoryId) {
  const { manifest } = await loadContent();
  return (manifest.scenarios || []).filter((s) => s.category === categoryId);
}

/** Every asset the service worker should precache for offline use. */
export async function assetList() {
  const { manifest, categories, characterSets } = await loadContent();
  const files = [
    'content/manifest.json',
    ...manifest.categories.map((c) => c.file),
    ...(manifest.characterSets || []).map((s) => s.file),
    ...(manifest.scenarios || []).map((s) => s.file),
  ];
  const audio = [];
  for (const cat of categories) {
    for (const p of cat.phrases) if (p.audio) audio.push(p.audio);
  }
  for (const set of characterSets) {
    for (const c of set.characters) if (c.audio) audio.push(c.audio);
  }
  return { files, audio };
}
