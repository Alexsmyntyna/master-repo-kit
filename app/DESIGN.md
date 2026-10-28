# Master Repo design language

The owner uses this app daily to see their projects as they really are. It has to be calm and plain, and honest about where every statement comes from.

## Principles

1. **Provenance is visible.** Each statement shows whose it is: the owner (`You`, sand, serif for their own words), code (`Code`, teal, mono for shas and paths), or an agent (`Agent`, lavender). Use `<Source>`, `<Statement>` and `<Said>`. Never present agent prose as the owner's words or as fact.
2. **Order of trust.** the owner's words come first, then facts read from git and files, then agent inference, which is folded (`<Fold>`) when it's long.
3. **Plain and short.** Titles are nouns: "Decisions", "Active", "Commits", "Your words". Avoid slogans ("How X got here.", "9 calls waiting on you."), explanatory paragraphs under titles, and "AI voice". When a page needs explaining, the layout is doing it wrong.
4. **Visuals over words.** Use instruments (`<Sparkline>`, `<GateMeter>`, `<OwesBadges>`), figures (`<Stats>`), the four-week run, states with dots, and tables with aligned columns and inline bars (`<DataTable>`, `<Bar>`), not sentences that describe numbers.
5. **Rows, not cards.** Lists are hairline rows (`<Rows>`/`<Row>`). Use a card only for a unit of work you act on, such as a decision. Never nest a card in a card.
6. **One accent.** Blue (`--accent`) means you can act on it. Amber (`--attention`) is only for what's waiting on the owner. Green and red are for state. Everything else is greys.
7. **Type.** Archivo for the interface; its semi-condensed cut (`--display`, `--display-stretch`) for page, section and project titles. Geist Mono only for code, shas, paths and commands (`.code-text`, `.sha`), and Newsreader serif only for the owner's own words. No giant numbers: a figure is never bigger than `--t-xl`. Labels are sentence-case sans: no uppercase, no letter-spaced mono. `.mono` means tabular figures, not a monospace face.

## Frame

- **One width.** `main` caps at 1600px with 40px gutters (`--gutter`), and every page lives inside it. No page lifts or narrows `main` or `.project-shell`. A page may cap a reading block inside it (`.doc-page`, `.ph-main`, prose's `--measure`), never the page.
- **Project nav is always there.** Every page under `/companies/<slug>` sits in `.project-shell`: a 196px project nav column beside the page, the Board included. Below 1180px it becomes a strip above the page.
- **Board first.** Sidebar: Board (`/`, one row per project card, `companies/<slug>/card.json` via `src/lib/cards.ts`, with the instrument line above), Projects, Standards (`standards/*.md`), Decisions, Calendar; then a folded More (Overview at `/overview`, Company, Threads, Ideas, Skills; open while one of its pages is current); then the projects, and System at the bottom. Everything else is a row on `/system` (listed in `src/lib/system.ts`).
- **A board row** reads left to right: project mark, name in the display cut, `KindChip`, a red "costing, not moving" tag if it applies; the goal; the blocker after a red ⟂. On the right, a fixed rack of instruments that line up down the board: `Sparkline` (12 weeks), `GateMeter`, `OwesBadges`, days idle (dimmer the longer), hygiene. Above the board, `DialStrip` is one line of label-then-figure between hairlines, coloured only when not zero. Under 820px the rack wraps under the text. The board keeps a 48px lane on the right (and room at the bottom) so the chat button never covers a row.
- **A project page leads with its card** (`ProjectCard`, `src/components/card.tsx`): one block in one face and one size (Archivo, `--t-sm`; no serif inside the card) on a strict three-column grid: label (112px), value, provenance (188px, right-aligned, so every source tag ends at one x). Rows with no source leave that column empty; no tags trail the text. Hairlines only between major rows (Goal, Finish, Blocker, Next, Moved, Owes you, Footprint, Hygiene). Finish carries the `GateMeter` alone; each gate is its own row under it: mark in a 1.5em cell, name, muted note, source. Moved puts the `Sparkline` in a 64px cell. The footer, in the provenance column, reads "card updated Oct 24 · tier maintain". Under 760px the columns stack and the source stays right-aligned. "Costing, not moving" (hosting or a database, idle over 30 days) is a red tag. Open fronts are one line under it, lined up with the card's keys, each with its state dot.
- **Shell.** Sidebar 224px; the current page is a raised row with a 2px accent edge (sidebar and project nav alike). More is a quiet fold. The top bar is a breadcrumb: "Projects / the finance app / Timeline" on a project's pages. Every page is checked at 360 to 1600px with no sideways scroll.
- **Timeline items** share one anatomy: date column ("to" date under it for a stretch), a 14px lucide kind mark coloured by whose it is, then title, summary (three lines at most) and a foot with `Provenance`, a note and `OlderTag`. An older item's text and mark recede; the tag says why. The header carries the project's `Sparkline`, `GateMeter` and `OwesBadges`.
- **Standards** (`/standards/<name>`) read as a ledger (`src/lib/ledger.ts`): each `- rule (who: ref, date)` line is the rule, then its `Provenance` and where it came from; struck rules are faint and struck through.
- **The parent company is an area like a project.** `/company` sits in `.project-shell` with its own `ProjectNav`: Company, Setup (`holding/setup.json`, a checklist the owner ticks; an agent's step can be recorded done by the agent, shown muted as "done · agent · <evidence path>"), Money (`holding/money.json`), Name, Presence, Vision (`holding/vision.md`), Pages, then the holding wiki (`holding/wiki/`) by kind. A holding wiki page is `/company/<front>` or `/company/<path>` (`holdingWikiHref`). `/vision` redirects to `/company`.

## Navigation (`src/components/shell.tsx`, `src/components/project-nav.tsx`, styles in `src/styles/shell.css`)

| Block | Use |
| --- | --- |
| Sidebar `nav-item` | A main page: lucide icon, noun, optional count (`b`, `.nav-alert` for waiting on the owner, `.nav-live` while agents run) |
| `ProjectNav` | A project's own nav: `pages` (icon name, title, href; prefix match unless `exact`), then `groups` (wiki kinds, open threads) as folding `<details>` with a count and an optional `more` link. Fronts and Threads open by default; which are open is kept in localStorage; the group holding the current page is always open. In the strip, a group opens as a dropdown |
| `.dot.state-dot-<status>` | A front's or thread's state in a nav list |

## Tokens (`src/styles/tokens.css`)

Every colour, size, space, radius, shadow and focus ring comes from here; no literal values in area CSS.

- Ink ramp: `--ink-0` (deepest navy) to `--ink-10` (pale blue-grey). Ground and greys map onto it: `--bg-sunk`, `--bg`, `--surface`, `--raised`, `--hover`, `--line-soft`, `--line`, `--line-strong`; text `--text`, `--text-2`, `--muted`, `--faint`.
- Meaning: `--accent`, `--attention`, `--ok`, `--risk`, `--idle`, plus `-soft` and `-rgb` variants. Who: `--owner`, `--code`, `--agent`, `--public`. Project marks: `--mark-<slug>`.
- Type: `--sans`, `--display` with `--display-stretch` (84%), `--serif`, `--mono`. Sizes `--t-2xs` 11.5, `--t-xs` 12.5, `--t-sm` 14, `--t-md` 15.5 (body), `--t-lg` 18, `--t-xl` 23, `--t-2xl` 30, `--t-3xl` 38.
- Space: `--s-1` to `--s-8` (4, 8, 12, 16, 24, 32, 48, 64). Frame: `--gutter`, `--measure`, `--page-max`.
- Shape: `--r-sm` 3, `--r-md` 4, `--r-lg` 6. Square-ish; circles only for dots and the dock button.
- Depth and focus: `--shadow-pop` (menus, popovers), `--scrim` (behind drawers and dialogs), `--topbar-bg`; `--focus` and `--focus-ring`.

## Instruments (`src/components/*.tsx`, styles in `src/styles/instruments.css`)

| Component | Use |
| --- | --- |
| `Provenance` (`provenance.tsx`) | The one You / Code / Agent tag: a square in the source's colour, its name, the date, the cite on hover. `Source` in ds.tsx is the same component. `Voiced` sets a line in its source's voice and puts the tag after it |
| `KindChip` | A project's finish line (publish, sell, client…). Solid when the owner said it, dashed when an agent proposed it |
| `GateMeter` | The card's gates as one segmented bar (done filled green, open hollow, unknown dashed) and "done/total". Counts from `gateCounts` (lib/cards.ts) |
| `Sparkline` | Commits per week, last 12 weeks, as 4px columns in inline SVG; this week in the accent. From `git/snapshot.json` via `weeklyCommits` (lib/sparkline.ts), which spreads each work stretch evenly over its days; weeks after the snapshot are unknown dots; no snapshot is a dash |
| `OwesBadges` | What waits on the owner as verbs: decide, review, reply (amber), and builds approved but not run (quiet). `full` spells them out |
| `OlderTag` | "older" on a thing dated over 30 days before the newest of its kind (`markOlder`) |

## Building blocks (`src/components/ds.tsx`, styles in `src/styles/ds.css`)

| Component | Use |
| --- | --- |
| `PageHeader` | Every page's top: `kicker`, `title`, `lede` (one short line at most), `meta` (inline facts), `actions` |
| `Stats` | Figures. Default: two to four figures under the header, no bigger than `--t-xl`. `size="sm"`: small labels over figures between hairlines, for a panel or rail (`wide`, `code` per item) |
| `KV` | Key / value lines (`[key, value, className?]`); falsy items are skipped |
| `Meta` | Inline facts separated by dots; `.warn` for attention, `.num` for figures |
| `Section` | A titled block with optional `note` (a count) and `action` (a `More` link) |
| `Split` | The page body beside a 340px sticky rail of facts |
| `Rows` / `Row` | Hairline list rows: `lead` (a project mark or a 16px lucide icon), `title`, `detail`, `meta`, `trail`, `href`, `tone` |
| `Tag`, `State` | A small tinted label; a dot plus a state word |
| `Source`, `Statement`, `Said` | Provenance marker; a company.json claim in its source's voice; the owner's words verbatim |
| `Fold` | Collapsed content, used for agent prose and reasoning. `aside` puts a link on the same quiet line ("▸ Reasoning · Thread, 2 messages") |
| `Menu` | A button that opens a small list: `menu-item` buttons (icon, name, faint `small` note), `menu-field` inputs, `menu-sep`; `align`, `up`. Use it to fold secondary actions and settings (Open in…, agent settings) instead of a row of buttons. Client pages close it on an outside click (`useMenuDismiss`) |
| `Empty` | Nothing here yet, said in a few words: one quiet line behind a short rule, never a box. While a page loads, `app/loading.tsx` shows the same line ("Loading") with a thin sweep under it |
| `More` | A small accent link with an arrow |
| `Tabs` | Underline tabs built from links: `label`, `items` (`href`, `label`, `count`, `current`), `scroll` |
| `FilterBar`, `SearchBox`, `Chips` | A list's filters, in client components: a search box and choice chips with counts (`.fbar-select` for a select) |
| `DataTable`, `Bar` | A real `<table>` with hairline rows and faint headers; `num` right-aligns figures; `Bar` puts a small bar beside one (`part` 0–1, `tone`) |
| `StageIcon` | Where work stands, as a Linear-style glyph: `proposed`, `ready`, `working`, `review`, `done`; `live` pulses |

**Lightbox** (`MockupStrip` → `src/components/mockup-lightbox.tsx`, styles in `mockups.css`): a click on a mockup thumbnail opens a modal `<dialog>`, not a new page: the mockup live at its frame (phone at natural width, centred; desktop fills the width; from review.md or `sniffFrame`), a bar with letter and label, Open (new tab), Review if one exists, ← "2 of 3" →, Close. Esc or a backdrop click closes, focus returns to the thumbnail, the page doesn't scroll behind it. No card chrome inside. The thumbnail stays a link for Cmd-click and middle-click.

`Source who="auto"` (and `Said auto`) marks a message a tool or button wrote in the owner's name: labelled Automatic, plain sans, never serif. Decide with `isGenerated`.

Shared helpers: `src/lib/voice.ts` (`ownerSaid`, and `isGenerated`: the one list of every tool-written message pattern) and `src/lib/activity.ts` (`getActivity`, `getCommits`: live git, ignoring the Board's `mr/*` branches).

## Drafts (`src/lib/use-draft.ts`, storage logic in `src/lib/drafts.ts`)

Nothing a person typed is lost to a reload, a rebuild or a failed action. Every text field uses one of these:

| Hook | Use |
| --- | --- |
| `useDraft(name, initial, { key })` | A controlled field: `[value, setValue, clearDraft]`. Key `draft:<pathname>:<name>`, or an explicit `key` for things kept by scope (the dock: `draft:dock:<scope>`) |
| `useFormDraft(name, { key, result, redirects })` | An uncontrolled form posting to a server action: put `ref` on the `<form>`. Saves its named text inputs, textareas and selects; clears when `result` (the action state) comes back without an error, or with `redirects` when the form leaves the page after a submit; puts the words back after React empties a form whose action failed |
| `useDraftSaver(key, base, onRestore)` | Anything else (several values, JSON): the restore, debounced save and clear underneath both |

- Restore after mount, never during render. A draft goes back only into a field that's empty or still shows the value it was typed over, so a newer server value wins.
- Clear only after a successful submit, never when it starts. Cancel and Close keep the draft; an editor with a waiting draft opens itself (`hasDraft`).
- Search boxes and list filters aren't drafts. A React-controlled field inside a `useFormDraft` form takes `data-draft="off"` (restore writes the DOM, not state).
- Pasted material: a paste over 400 characters in a message field (`MessageField`, so the dock and thread composers) becomes a file under `holding/uploads/<date>/`, named from its first line (`.md` or `.txt`), shown as a chip and sent as an attachment, never as his words. Shorter pastes stay inline.

## Attachments

- A file pasted, dropped or picked in a message field is saved at once (`uploadFiles`, `holding/uploads/<date>/`) and kept as a chip in the field's draft (`<key>:attach`), so it survives a reload and may be sent with no words; `converse.py add_message` ends the stored body with one line each, numbered per kind across the thread (`[image #3](path)`, `[pasted #2: first line](path)`, `[file #1: name](path)`, repo-relative inside the repo), the prompt lists the same numbers, and the app shows those lines as `AttachmentChips` (`src/lib/attachment-refs.ts` splits them off `body`), opening uploads in the file viewer `/files/holding/uploads/…` and naming files outside the repo without a link.

## Spelling

The owner: "id like the my words to run through a spell check before they are saved as I type quickly and there are typos." (build brief, 2026-10-11) Their words are quoted verbatim everywhere, so the fix is spelling only and what they typed is never lost.

- Every text field they type in sets `spellCheck` (the browser's underline is the baseline).
- On send, the text goes through `fixSpellingAction` (`src/app/spell/actions.ts`, which calls `fixSpelling` in `src/lib/spell.ts`). The fixed text is saved as their words; the original is kept as `typed` (`converse.py new|post|chat --typed`, which also stores `fixes`; mockup notes keep a `typed` map from `typedNotes`; spread it in only when set, `...(typed ? { typed } : {})`, since `matter.stringify` throws on an undefined value).
- Send is instant. Composers use one hook, `useSpellFix` (`src/lib/use-spell-fix.ts`; `fixOnSend` is the bare call): `spell.check(fields, send)` fixes and sends at once; nothing is held, counted down or drawn over the field. A failed fix, or one that takes over 4 seconds, sends the words as typed. A `<form action>` calls `spell.intercept(e, [field])` from `onSubmit`: the fixed text and `typed` go in through the `formdata` event, so the field, its state and its draft keep what they typed until the action succeeds. Send buttons wait on `spell.checking`.
- They see and keep a spelling afterwards. A stored message with `typed` shows a faint "2 fixed" (`SpellNote`, `src/components/spell-fixes.tsx`) on thread pages and in the dock. A click opens a popover (`popover="auto"`: Esc or a click outside closes it) listing each fix as "typed → saved as" with Keep: `learnWordAction` adds the typed word to `holding/dictionary.txt` so it's never fixed again, then the row says "Kept"; a failed write shows its error in the row. The stored message is never edited. The fixes come from `diffWords(typed, body)` in `src/lib/spell-marks.ts` (client-safe; `spell.ts` is server-only).
- The fixer leaves a word alone when unsure: only plain lowercase or sentence-start words, never code, paths, URLs, handles, ALLCAPS, camelCase, names mid-sentence or project words, and only when exactly one fix fits. Texts over 20,000 characters are saved as typed, and lookups stop after 200 words or 1.5s. The rules are at the top of `src/lib/spell.ts`.

## Files

- `src/styles/base.css` (reset, buttons, form feedback, project marks) and `shell.css` (sidebar, top bar, project nav) load once from the root layout, before `ds.css` and `instruments.css`.
- Shared CSS goes in `src/styles/ds.css`. Each area's own CSS goes in `src/styles/<area>.css`, imported by that area's page or component (`decisions.css`, `messages.css`, `board.css`…).
- Before building a local version of a list, table, tab row, filter or figure, use the block above; if it's missing something, extend the block.
- Keep `npm test`, `npx tsc --noEmit` and `npm run build` passing.
