# Nihongo Tabi — Dev README
*(working title — rename freely)*

A study tool for **survival-level conversational Japanese**, built by a
solo dev, for personal use, with a hard deadline: usable within 1-2 days,
feature-complete enough to actually learn from within **28 days** before
departure.

This drives every decision below. Anything that doesn't directly serve
"learn to have simple, non-awkward conversations in Japan, fast" gets cut
or deferred.

---

## 0. Reality Check

The full vision (native Flutter apps for Windows/Android/iOS/macOS,
bundled native-speaker audio, live AI chat) is real but multi-week. The
build below is deliberately scoped to what a solo dev can ship in 1-2
days: a **PWA (installable web app)** — runs today in the browser on both
Windows and Android, installs to the home screen, no store submission, no
native build chain. Native ports are Phase 2 (§9), not a blocker.

---

## 1. Execution Directive for Claude Code

- **Target model:** Claude Opus 5, high thinking effort, for
  architecture, the SRS scheduler, and the content JSON schema. Sonnet 5
  is fine for repetitive content entry once the schema is set.
- **Do not stop to ask clarifying questions.** All open decisions have
  been made below. Where a genuinely new decision comes up during build,
  make the most reasonable call, keep moving, and log it in a running
  `ASSUMPTIONS.md` at the repo root so it can be revisited later.
- Work through the Day 1 checklist to completion, then Day 2, in order.
  Prioritize a working end-to-end loop (browse → study → review) over
  polish at every step — a rough version of everything beats a perfect
  version of one piece.

---

## 2. MVP Build Plan

**Day 1 — working skeleton + first content + placement quiz:**
- [ ] Static web app shell: category browser → phrase list → flashcard view
- [ ] IndexedDB for progress + SRS state (localStorage fallback if simpler)
- [ ] SRS scheduler (SM-2 — don't over-engineer)
- [ ] Audio pre-generation script (build-time, see §3-audio) run for
      categories 1-4, bundled audio files wired to phrase playback
- [ ] Content for categories 1-4 (see §6) — enough to start studying same day
- [ ] **Onboarding placement quiz** (see §6a) — runs before first study session
- [ ] PWA manifest + service worker (offline-capable, installable)
- [ ] Runs via local dev server; add a one-command deploy script to a
      free static host (GitHub Pages by default) so it's reachable on
      the phone without manual file transfer

**Day 2 — depth + remaining core:**
- [ ] Scenario dialogue trees (branching, static JSON) for loaded categories
- [ ] Furigana toggle, romaji toggle
- [ ] Remaining categories 5-10 stubbed in (thin coverage of everything
      beats deep coverage of a few)
- [ ] "Due today" home screen driven by the SRS scheduler

**Explicitly deferred (not blocking, add later if time allows):**
- Live AI conversation practice / AI-assisted placement (needs backend proxy)
- Native Windows/Android/iOS/macOS builds
- Bundled professionally-recorded audio
- Cloud sync

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App shell | Plain HTML/CSS/JS or a lightweight framework (Svelte/vanilla) | Zero build-chain overhead |
| Storage | IndexedDB (small wrapper) | Offline, no backend |
| Audio | **Pre-generated audio files, bundled with the app** | See §3a-audio below — real files, not a live device call |
| Offline/install | Service worker + Web App Manifest | Installable PWA on Windows and Android today |
| SRS | SM-2, implemented directly | Simple, testable |
| Content | Static JSON, one file per category, **versioned schema** | See §3a |
| Hosting | Local dev server + one-command deploy to GitHub Pages (or equivalent) | Reachable from phone without cabling files |

### 3-audio. Audio: Generated Once, Bundled, Not Live

**This is a build-time step, not a runtime dependency.** A script runs
once during content creation, synthesizes every phrase in the curriculum
to an actual audio file (mp3/ogg), and saves it alongside that phrase's
entry in the content JSON. The app just plays the file — no live TTS
call at runtime, no dependency on the end user's device having a
Japanese voice installed.

- Use whatever TTS the build environment has available for the one-time
  generation pass — a free TTS library/API (e.g. gTTS) if internet is
  available at build time, or a local/offline synthesizer (e.g.
  eSpeak-NG) if not. Claude Code's call to make; either is fine since it
  runs once, not per-user.
- Output: one short audio file per phrase ID, referenced by filename in
  that phrase's JSON entry. A few hundred short clips is realistically a
  few MB total — trivial to bundle and cache via the service worker.
- **Practical effect on setup:** the "download Japanese TTS voices on
  your devices" prep step is no longer required for the app to work —
  that was only needed under the live-TTS approach. No harm in still
  having a Japanese voice installed, just not a dependency anymore.
- Quality note: pre-rendered synthesized audio is good for pronunciation
  shape and pitch pattern, not a full substitute for real listening
  practice. Worth supplementing with outside native audio (podcasts,
  YouTube) regardless of this app.
- Real native-speaker recordings replacing the synthesized set remains a
  Phase 2 upgrade (§9) — same file-based playback mechanism, just swap
  the source audio files later with no app-code changes needed.

---

## 3a. Content Architecture (Scalability)

Content must be fully decoupled from app logic so the app can grow after
launch without code changes:

- One JSON file per category (`content/airport.json`, etc.), a shared
  schema (id, Japanese, furigana, romaji, English, register notes,
  audio-hint, tags, difficulty).
- A single `manifest.json` listing active category files — adding a
  category means adding a file + one manifest line, not touching app code.
- Scenario trees follow the same pattern: one JSON file per scenario,
  referencing phrase IDs from the category files rather than duplicating
  text.
- Schema includes a `schemaVersion` field from day one so future content
  format changes don't break old data.
- This same structure is what would let a future language pack (beyond
  Japanese) or a native Flutter port reuse the content wholesale — the
  content layer shouldn't need to know what's rendering it.

---

## 4. Learning Experience

1. **Onboarding placement quiz** — see §6a, runs once at first launch.
2. **Flashcards + SRS** — core daily loop.
3. **Scenario dialogue trees** — full exchanges, not isolated phrases.

*(Live AI chat is a future pillar — see §9.)*

---

## 5. Offline-First Architecture

- App shell + all content JSON + all bundled audio files cached via
  service worker on first load.
- Audio plays from bundled files — no network call, no dependency on the
  device's own TTS voice being installed.
- All progress/SRS/quiz-result state stored client-side.
- Zero backend required for the full Day 1/2 MVP (the audio-generation
  script is a one-time build step, not something the running app does).

---

## 6. Content Scope & Priority Order

Register: polite form (です/ます) throughout — consistent and safe.
Casual forms (which anime-derived knowledge likely already covers) are
introduced later as recognition-only, explicitly flagged as "you may
already know this from media, here's when it's actually appropriate."

Load order (trip-relevance, not alphabetical):

1. Greetings & politeness norms
2. Numbers, time, money
3. Airport & immigration
4. Transportation (trains, taxis, buses)
5. Directions & getting lost
6. Hotel check-in/out
7. Restaurants & ordering food (incl. allergies/dietary restrictions)
8. Shopping & payments
9. Emergencies & health
10. Small talk (extended)

Per-phrase: furigana toggle, romaji toggle (off by default after week 1),
register notes — specifically calling out where anime Japanese diverges
from real polite usage (e.g. dramatic/masculine speech patterns common in
anime that would sound odd or brusque from a polite tourist).

### 6a. Onboarding & Level Calibration

Anime-derived Japanese knowledge tends to be real but lopsided — strong
passive vocabulary, register/politeness patterns often skewed casual or
dramatic, gaps in practical/functional phrases nobody says in a show.

MVP calibration (offline, no AI call needed):
- On first launch, a short placement quiz pulls ~15-20 sample cards
  spread across all 10 categories.
- Self-graded ("did you know this?") rather than typed-answer, to keep
  it fast.
- Known cards get inserted into the SRS deck at a later starting
  interval instead of the beginning, so the app doesn't waste week 1 on
  material already retained.
- Unknown or "recognized but wouldn't produce" cards start at the normal
  first interval.

Optional future enhancement (Phase 2, not blocking): a one-shot Claude
API call at onboarding where the user free-types what they know, and
Claude suggests a calibrated starting configuration and flags likely
register mismatches from anime exposure. Requires network once and a
minimal backend proxy — worth adding once the core app is stable, not
before.

---

## 7. 28-Day Study & Content Rollout

| Week | Build focus | Study focus |
|---|---|---|
| **1 (Days 1-7)** | Categories 1-4 loaded, placement quiz run Day 1 | Greetings, numbers/time/money, airport, transport |
| **2 (Days 8-14)** | Categories 5-6 added, scenario trees fleshed out | Directions, hotel — keep reviewing week 1 via SRS |
| **3 (Days 15-21)** | Categories 7-8 added | Restaurants, shopping — SRS load is cumulative now |
| **4 (Days 22-28)** | Categories 9-10 added, polish only if time allows | Emergencies, small talk, **heavy review** — consolidation week, not new material |

Don't front-load all 10 categories into the SRS deck at once — introduce
2-3 categories a week to keep daily review time bounded.

---

## 8. Non-Functional Requirements

- App launch + usable state in under 2 seconds, offline.
- Adjustable text size, furigana/romaji toggles double as accessibility features.
- No data leaves the device in the MVP — no backend, so this is automatic.

---

## 9. Phase 2+ — Long-Term Vision (Post-Trip, Not Blocking)

- Native builds: Flutter recommended for Windows/Android/iOS/macOS —
  Skia rendering handles furigana/CJK layout well, one codebase across
  all four targets.
- Bundled native-speaker audio to replace/supplement TTS.
- Live AI conversation practice via Claude API (backend proxy for the key).
- AI-assisted onboarding calibration (see §6a).
- Cloud sync/backup of progress.
- Additional language packs, enabled by the content architecture in §3a.

---

## 10. Remaining Open Question

- App name/branding — still a placeholder, purely cosmetic, doesn't
  block building anything.

---

## 11. Characters — Reading (added after the MVP)

A top-level section alongside the category browser, covering the writing
system itself. Reading unlocks the rest of the app: furigana, signage, and
menus all stop being opaque.

**Sets** (one JSON file each, listed in `manifest.json → characterSets`,
same versioned-schema rules as §3a):

| Set | File | Count | Scope |
|---|---|---|---|
| Hiragana | `content/hiragana.json` | 104 | 46 base + 25 dakuten/handakuten + 33 yōon |
| Katakana | `content/katakana.json` | 116 | same structure, plus 12 extended combos (ファ, ティ, ジェ…) for loanwords |
| Common Kanji | `content/kanji-common.json` | 82 | curated for travel, not exhaustive |

Kanji covers numbers and money, the seven day kanji and time, wayfinding
(出口, 入口, 男, 女, お手洗い, compass points), stations and tickets, shops and
payment, warnings (危険, 禁止, 非常口), and everyday signage (押, 引, 空, 満).
Multi-character compounds are included where that is how a traveller actually
reads them off a sign.

**Per-character schema:** `character`, `readings[]`, `romaji`, `english`
(kanji only — kana carries `null`), `audio`, plus `group`, `row`/`column` for
grid placement, `difficulty` and `tags`. Kanji additionally carry `seenIn`,
a generated list of phrase IDs containing that character.

**Cross-reinforcement.** `tools/crossref-kanji.mjs` scans the phrase content
and links each kanji to the phrases it appears in — 38 of 82 currently. The
kanji list shows those phrases as tappable chips, so the Characters section
reinforces the phrase deck rather than sitting beside it as a second
disconnected vocabulary list.

**Reuse, not a parallel system:**
- Audio comes from the same build-time pass as §3-audio — 302 bundled clips,
  no live TTS. Kanji clips are synthesised from the kana reading, not the glyph.
- Review is the same SM-2 scheduler and the same flashcard UI as phrases.
  Character content is stored phrase-shaped, so the review screen needed no
  changes at all.
- The furigana/romaji toggles work throughout, including on the charts.

**Separate deck.** Character cards are tagged `kind: 'character'` and have
their own queue, their own daily new-card cap, and their own review counter.
Character reviews never appear in phrase review counts, in either direction.

**Onboarding.** The placement quiz (§6a) samples two characters from each set
alongside the phrase cards — 26 items total. Prior exposure to written Japanese
is credited exactly the way phrase knowledge is: known characters seed forward
instead of starting from あ.

**UI.** A reference chart per set (kana as the traditional grid by row, kanji
as a browsable list grouped by usage), tap any character to hear it; plus
flashcard review per set or across all sets.

**Deliberately out of scope:** handwriting practice, stroke-order diagrams and
stroke-order animations. This app is for reading signs on a trip, not learning
to write. See `ASSUMPTIONS.md` A24.

---

## 12. Running It (added during build)

Zero dependencies, no build step. Node 18+ only.

```bash
npm start                 # dev server on :5173, also prints your LAN URL for phone testing
npm test                  # content validation + SRS + end-to-end logic (8054 checks)
npm run test:render       # renders every screen + service worker checks (needs: npm install --no-save jsdom)
npm run test:sw           # service worker registration regression tests
npm run audio             # generate any missing TTS clips
npm run audio:check       # report audio coverage without generating
npm run kana              # regenerate the hiragana/katakana content files
npm run crossref          # relink kanji to the phrases they appear in
npm run icons             # regenerate the PWA icons
npm run deploy            # publish to the gh-pages branch
```

**On your phone:** run `npm start`, then open the `Network:` URL it prints
(same Wi-Fi). The app works, but **the service worker will not register over a
plain `http://` LAN address** — service workers require a secure context, so
offline mode and *Add to Home screen* need either `http://localhost` or an
HTTPS deployment. The app now logs exactly this to the console rather than
skipping silently. This applies to Android and iOS alike.

### Deployed

**Live: https://shikomisen.github.io/Nihongo-Tabi/**

Served by GitHub Pages straight from **`main` / `root`** — no build step, no
`gh-pages` branch, because the build output (audio, content JSON, icons) is
committed. `.nojekyll` at the repo root keeps Jekyll's hands off it.

**Deploying a change is just:**

```bash
git push origin main       # Pages rebuilds automatically, live in a minute
```

Install it on a phone by opening that URL in Chrome or Safari → *Add to Home
screen*. Because it's HTTPS, the service worker registers and the app is fully
offline-capable once loaded — unlike the `http://` LAN address that `npm start`
prints.

The service worker registers correctly from the project subpath —
`register('sw.js')` is document-relative and takes `/Nihongo-Tabi/` as its
scope, which is asserted in `npm run test:sw`. Don't make that path absolute.

`npm run deploy` (the `gh-pages` branch route) is **not used** by this setup,
but still works if the served site should ever be split from source.

`npm run deploy` has been verified end to end against a local bare repository:
523 files, all 482 audio clips, all three character sets, `.nojekyll` included
and `tools/` excluded.

Content lives in `content/` — adding a category is one JSON file plus one line
in `content/manifest.json`, with no app-code changes (§3a). Run
`npm run audio` afterwards to synthesise its clips.

See `ASSUMPTIONS.md` for decisions made during the build that this spec
didn't cover.
