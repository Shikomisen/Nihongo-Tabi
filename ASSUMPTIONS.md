# Assumptions & Decisions

Running log of calls made during the build where the README didn't specify,
per §1. Each entry says what was decided and why, so it can be revisited.

---

## Day 1

### A1 — Repo has no GitHub remote
The GitHub CLI (`gh`) is **not installed** on this machine, so no GitHub repo
was created and nothing was pushed. The local git repo is initialised and
committed on `main`.

**To connect a remote manually:**
```bash
git remote add origin https://github.com/<you>/nihongo-tabi.git
git push -u origin main
npm run deploy        # publishes to the gh-pages branch
```
Then enable GitHub Pages once: *Settings → Pages → Source: Deploy from a
branch → `gh-pages` / (root)*.

`npm run deploy` already detects the missing remote and prints these steps
rather than failing obscurely.

### A2 — Audio generated via Google Translate TTS, not gTTS/eSpeak
README §3-audio left the TTS choice open ("Claude Code's call"). Python on
this machine is the Microsoft Store stub, not a real interpreter, so `gTTS`
was not available; eSpeak-NG is not installed either. Node 22 is present, so
`tools/generate-audio.mjs` calls the same public Google Translate TTS
endpoint that gTTS wraps, directly via `fetch`. Zero dependencies to install.

The vendor decision is isolated in a single function (`synthesise()`), so
swapping to eSpeak-NG, a paid API, or real native-speaker recordings (Phase 2,
§9) touches one function and no app code.

### A3 — Synthesis is driven from kana, not kanji
Each phrase carries an `audioHint` field holding the kana reading, and the
generator prefers it over the kanji `japanese` field. Synthesisers routinely
mis-read kanji with multiple readings (七時 as *nanaji* rather than *shichiji*),
and this made the output measurably more accurate. `audioHint` is the
"audio-hint" field named in §3a, given a concrete job.

### A4 — Furigana stored as segments, not a parallel string
§3a lists `furigana` as a field but not its shape. It's stored as an array of
`{ b: base, r: reading }` segments so a reading attaches to the specific kanji
run rather than the whole phrase — `[{b:"電車",r:"でんしゃ"},{b:"は"}]`. This is
what makes correct `<ruby>` rendering possible, and the self-test asserts that
concatenating the segments reproduces the `japanese` field exactly.

### A5 — Placement quiz pulls 20 cards, 2 per category
§6a says "~15-20 sample cards spread across all 10 categories". 2 per category
× 10 = 20, at the top of that range but exactly even in coverage. The two picks
per category are deliberately the **easiest and the hardest** available card:
anime-derived knowledge is lopsided, and sampling both ends is what exposes the
lopsidedness rather than just measuring an average.

### A6 — Categories 5-10 seeded on Day 1, not Day 2
The Day 2 checklist puts categories 5-10 in Day 2, but §6a requires the
placement quiz — a Day 1 item — to span **all ten** categories. Those two
can't both hold with six empty files. Resolution: 4 phrases each were written
for categories 5-10 on Day 1 (enough for the quiz to sample from), and Day 2
expands them to full thin coverage. Day 1's audio pass therefore covered 112
phrases rather than only categories 1-4's 88.

### A7 — Three-way self-grading, but only "known" skips ahead
§6a describes "known" vs "recognised but wouldn't produce" vs unknown. The quiz
offers all three, but per the spec's explicit wording only **"I know this"**
seeds the card forward (6 days); "recognise" and "new" both start at the normal
first interval. The "recognise" answer still counts as 0.5 toward the category
score, so it influences *sibling* cards even though it doesn't advance its own.

### A8 — Placement results also seed unsampled cards
§6a only describes what happens to the sampled cards. Extending that: a
category whose placement score is ≥0.75 gets its easy (difficulty ≤2) cards
seeded at a 4-day interval when the category is activated, and ≥0.5 seeds
difficulty-1 cards at 2 days. Without this, answering "I know this" to two
greetings cards would still leave you grinding all 22 remaining greetings from
zero — which is the exact waste §6a exists to prevent. Tunable in
`js/deck.js → activateCategory()`.

### A9 — Week-1 rollout enforced, later categories opt-in
§7 says don't front-load all 10 categories. On finishing the quiz, only the
four week-1 categories are activated. The rest are visible and readable in
Browse from the start, but only enter the review queue when explicitly added.
Cards for unrolled categories that the quiz happened to sample are stored but
excluded from the queue until their category is activated.

### A10 — Failed cards return within the same session
SM-2 proper just reschedules a lapsed card. Here a lapse sets a 10-minute
learning step *and* the card is pushed to the back of the current session
queue, so it's seen again before you close the app. This is standard Anki-style
behaviour and materially improves same-day retention.

### A11 — Icons generated, not designed
`tools/make-icons.mjs` writes the PWA PNGs from raw RGBA scanlines via
`zlib` — a torii drawn with rectangles. No image library, no binary assets
committed that can't be regenerated. Fine for a launcher icon; replace with
real artwork any time by dropping PNGs into `icons/`.

### A12 — Dark-first single stylesheet
Not specified anywhere. One CSS file, dark by default with a
`prefers-color-scheme: light` override, sized for a phone held one-handed.
Text-size slider in Settings drives a `--text-scale` custom property, which
covers the §8 accessibility requirement alongside the furigana/romaji toggles.

### A13 — Romaji auto-retires after week 1
§6 says romaji should be "off by default after week 1". Rather than silently
changing behaviour, the app flips the default once, 7 days after first launch,
and shows a toast explaining it. It can be turned straight back on in Settings
and won't auto-flip again.
---

## Day 2

### A14 — Scenario trees are branching, with a "best" path
§2 asks for branching dialogue trees and §3a requires them to reference phrase
IDs rather than duplicate text. Each node holds an NPC line plus 2-3 player
options; options carry an optional `phraseId` that links back into the category
content, and a `quality` marker (`good` / `awkward` / `wrong`). Picking an
awkward option doesn't dead-end the scenario — it continues and explains what
landed oddly, since the register mismatch *is* the lesson (§6).

Scenario NPC lines are content in their own right and are not all present in
the category files, so they carry their own inline text. Only **player** lines
reference phrase IDs. The self-test verifies every `phraseId` resolves and
every `next` target exists.

### A15 — Scenario audio reuses phrase clips
Player options that reference a phrase ID play that phrase's existing bundled
clip. NPC lines got their own generated clips under `audio/ja/scenario/`, so a
scenario can be listened through end to end.

### A16 — "Due today" home screen ordering
The home screen shows due cards first, then new ones capped by the
new-cards-per-day setting (default 10). Due cards are ordered by how overdue
they are, not by category, so nothing is starved. Categories can still be
studied individually from Browse, which ignores the daily cap — deliberate, so
cramming a specific category before you need it is possible.

### A17 — No analytics, no network calls at runtime
§8 says no data leaves the device. There is no telemetry, no CDN, no external
font, and no runtime fetch to any origin other than the app's own. The only
network access in the whole project is the build-time audio script, which runs
on your machine and not the user's.

### A18 — jsdom is a test-only, non-installed dependency
`tools/render-test.mjs` renders every screen in a real DOM and asserts the
output. It needs jsdom, but the app itself has **zero dependencies** and that
was worth keeping — so jsdom is not in `package.json`. Install it only when you
want to run that suite:

```bash
npm install --no-save jsdom
npm run test:render
```

The script exits 0 with a note if jsdom isn't present, so it never breaks a
clean checkout.

### A19 — Scenario choices nudge the SRS, they don't grade it
Picking a phrase inside a scenario updates its `lastReview` but does not
advance its interval. Choosing from a list of three is much weaker evidence of
recall than producing an answer to a flashcard, so treating it as a real
review would inflate intervals and quietly damage retention. Flashcards remain
the only thing that moves the schedule.

---

## Characters section

### A20 — Character content reuses the phrase schema verbatim
Kana and kanji entries carry `japanese`, `furigana`, `romaji` and `english`
alongside their own `character` / `readings` / `group` fields. That is not
redundancy — it means the existing flashcard session, the `<ruby>` furigana
renderer, the furigana/romaji toggles and the audio button all render a
character with **zero branching**. `runSession()` was not modified at all to
support character review.

The only synthesised field is a display `english` for kana, which genuinely
has no meaning to show: the JSON keeps `english: null` (per the brief — English
meaning is kanji-only) and the loader substitutes `reads “a”` at read time.
The original value stays available as `meaning`.

### A21 — Separate deck implemented as a `kind` tag, not a second store
Cards carry `kind: 'phrase' | 'character'`. One IndexedDB store, one SM-2
scheduler, two queues — `deck.queue()` and `deck.characterQueue()` filter on
it, as do `deckSummary()` and `characterSummary()`. `kind` defaults to
`'phrase'` everywhere it is read, so SRS records written before this section
existed keep working untouched.

Daily stats gained `charReviews` / `charAgain` next to `reviews` / `again`, so
the "done today" figure on the home screen stays a *phrase* figure. Forty kana
drills should not make it look like the phrase reviews are done. The streak
counts either kind — studying is studying.

### A22 — Character sets are opt-in, with their own daily cap
Adding hiragana introduces 104 cards at once. Auto-activating that at placement
would swamp week 1 and directly contradict §7's "don't front-load". So character
sets are added from the Characters screen exactly like categories 5-10 are added
from Browse. Placement still samples and scores them, and those results seed the
set forward when it *is* added.

New characters have their own cap (`newCharsPerDay`, default 15, separate from
the phrase `newPerDay` of 10) because a kana card takes about two seconds and a
phrase card takes about ten.

### A23 — New cards are introduced easiest-first
`buildQueue` now orders new cards by `difficulty` before `introduced`, and cards
store their content difficulty. This exists for kana: the 46 base characters
have to arrive before the yōon combinations built out of them, and all 104 are
introduced on the same timestamp so `introduced` alone could not order them.
Phrases benefit incidentally.

### A24 — Handwriting and stroke order deliberately deferred, not forgotten
No stroke-order diagrams, no animations, no handwriting or drawing practice.
Explicitly out of scope for this pass.

Beyond the instruction, it is also the right call for this app: the goal is
reading signs, menus and tickets on a 28-day trip, and recognition is what
serves that. Handwriting is a much larger investment that pays off over months.
If it is ever added, the natural shape is a `strokes` field on the existing
character schema plus a new view — no change to the SRS or deck layer.

A note to this effect is shown at the bottom of the Characters screen so it
reads as a deliberate scope decision rather than an oversight.

### A25 — Kana content is generated; kanji is hand-curated
`tools/make-kana.mjs` generates both kana files from a compact table. Writing
220 near-identical JSON entries by hand invites typos no test would catch — a
wrong romaji on ぬ still validates as JSON. The romaji convention (Hepburn:
shi/chi/tsu/fu/ji, matching Japanese road signage) is stated once in that table.

Kanji is hand-written because the selection, the meanings and the traveller
notes are judgement calls, not derivable from a rule. Note that ぢ/づ and
ヂ/ディ collide under Hepburn, so machine-facing ids are disambiguated
(`hira-di`, `kata-ext-di`) while the displayed romaji stays honest.

### A26 — Kanji set includes multi-character compounds
Strictly, 出口 is two kanji, not one. But a traveller reads 出口, 非常口 and
両替 as units off a sign, and splitting them into single characters would make
the set less useful for its actual purpose. The set therefore contains 82
entries mixing single kanji (円, 駅, 右) with high-value signage compounds
(出口, 立入禁止, 営業中).

### A27 — Cross-references match exact written forms only
`tools/crossref-kanji.mjs` links each kanji to phrases containing it — 38 of 82
currently. An earlier version fell back to component matching when a compound
had no exact hit, which claimed 曜日 appeared in 日本語が少しわかります merely
because 日 does. That is a lie that sends the learner to a phrase not containing
the word, so the fallback was removed. The 44 unmatched entries are genuinely
signage-only (押, 引, 危険, 準備中) and are simply shown without cross-references.

Re-run `npm run crossref` after adding phrase content to refresh the links.
