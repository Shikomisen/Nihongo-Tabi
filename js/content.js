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
 * Loads the manifest and every category file it lists.
 * Returns { manifest, categories: [...], phrases: Map<id, phrase>, byCategory: Map }
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

  const phrases = new Map();
  const byCategory = new Map();

  for (const cat of loaded) {
    byCategory.set(cat.id, cat);
    for (const p of cat.phrases) {
      phrases.set(p.id, { ...p, categoryId: cat.id, categoryTitle: cat.title });
    }
  }

  cache = { manifest, categories: loaded, phrases, byCategory };
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
  const { manifest, categories } = await loadContent();
  const files = [
    'content/manifest.json',
    ...manifest.categories.map((c) => c.file),
    ...(manifest.scenarios || []).map((s) => s.file),
  ];
  const audio = [];
  for (const cat of categories) {
    for (const p of cat.phrases) if (p.audio) audio.push(p.audio);
  }
  return { files, audio };
}
