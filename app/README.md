# Master Repo app

A local Next.js wiki of every project: why it exists, how it evolved, what stands in its way, and the visualizations built around it. Dark blue throughout. It reads real repository data; missing information stays visibly unknown.

## How the wiki works

- Each project's pages are Markdown in `companies/<slug>/wiki/`. `index.md` is the project's landing page (story and vision). Other pages are fronts, topics, ideas, visualizations, redesigns, history or research, set by `kind` in frontmatter.
- Open fronts (`kind: front`) show as large cards on the landing page. At most five open per project.
- Visualizations are React components in `src/views/`, registered in `src/views/registry.tsx`, and embedded in any wiki page with a fenced block whose language is `view` and whose body is the view name.
- `/companies/<slug>/timeline` merges wiki pages, fronts, decisions, reviews, notes, reports, mockups, builds, threads and git work stretches. A document, mockup, build or thread over 30 days older than the newest of its kind is marked "older". `/companies/<slug>/model` shows the structured `company.json`.
- Git data comes from `python3 tools/git_history.py snapshot` (run from the repo root), which writes `companies/<slug>/git/snapshot.json`. The app never runs git itself.

## Run locally

Requirements: Node.js 20.9 or newer and npm. Dependencies and the lockfile live in this directory.

```sh
cd app
npm ci
npm run dev
```

Open **http://127.0.0.1:3100**. No API key, database, account, or external service is required. The server binds to the loopback address. The scripts disable Next.js telemetry.

For a production build served locally, stop the development server, then run:

```sh
npm run build
npm start
```

## Code and data

The app reads a data directory of JSON and Markdown files. By default that's the folder above `app/`, which is how this checkout runs. To keep the data somewhere else, set `MASTER_REPO_ROOT` to its absolute path:

```sh
cd app
MASTER_REPO_ROOT=/path/to/your-data npm run start
```

Or copy `.env.example` to `.env.local` and set it there; `tools/master` reads that file too. The app passes the same path to every Python tool it runs, so `tools/` reads and writes the same files. A tool run by hand doesn't read `.env.local`, so give it the variable: `MASTER_REPO_ROOT=/path/to/your-data python3 tools/portfolio.py pulse`.

What travels with the app: `app/`, `tools/` (the Python the app calls) and `agents/` (role prompts; a data directory may carry its own `agents/` to override them). Everything else is data.

What the data directory holds (full layout and one example of each format in [`DATA.md`](../DATA.md)):

- `companies/<slug>/company.json`: one project's model; `id` matches the folder name, `name` is required.
- `companies/<slug>/wiki/*.md`: wiki pages with front matter (`title`, `kind`, `summary`, `date`, `updated`; fronts add `status`, `raised_by`).
- `companies/<slug>/decisions.json`, `reviews/`, `notes/`, `builds/`, `market/`, `mockups/`, `screens/screens.json`, `threads/`, `git/snapshot.json`.
- `holding/direction.md`, `vision.md`, `portfolio.json`, `pulse.json`, `owner.json`, `codebases/`, `threads/`.
- `identity/`, `skills/`, `queue/`, `guide/`, `discovery/`.

`holding/owner.json` is `{ "name": "Full Name", "short": "First" }`: the sidebar shows `name`, and mockup notes and build directions use `short`. Without it the app says "Owner" and "You".

`MASTER_REPO_ID` (default `master-repo`) names the log folder `~/Library/Logs/<id>` and the check-in schedule, so two installs on one Mac don't share them. `tools/master` reads both variables too.

## What works

- Holding overview, including active conversations read from `holding/direction.md`. Conversations are not presented as ranked priorities.
- Searchable company directory with filters for developed and unfilled models.
- Company strategy, product/roadmap, decisions, reviews, working notes, and repository references.
- Expandable provenance for the owner's account, agent judgments, code evidence, and public sources.
- Markdown/JSON document reader with tables and internal content links.
- Queue filtering and a form to save a new question. It creates a unique Markdown file in `queue/`; it never starts an agent or changes existing entries.
- Prompt search, category filters, full prompt disclosure, and clipboard copying.
- Developer identity documents, technologies, and lessons, including honest empty states.
- Responsive navigation and layout; manual refresh reloads the repository data.

The overview and models are read on request, with request-scoped deduplication only. After an agent edits a file, refresh the page or use the refresh button in the top bar.

## Boundaries of this first version

Strategy editing remains with agents. Saving new queue questions is the only app write operation, as described in the original brief. Git history browsing, embedded previews from external project repositories, automatic file watching, and a visual technology graph are not implemented. Referenced external repository and archive paths are displayed as text. The app does not crawl those locations.

Document reads are restricted to Markdown and JSON inside `companies/`, `holding/`, `identity/`, `queue/`, `prompts/`, and `discovery/`. Dotfiles, traversal, unsupported extensions, and symlinks are rejected. Raw HTML and remote Markdown images are not rendered. This is a private local app, with no hosted deployment or login system.

## Implementation

- `src/lib/repository.ts`: request-scoped loaders for the existing repo schema. The data root is `MASTER_REPO_ROOT`, or the parent of the app's working directory; run commands from `app/`. `toolPath` and `pythonEnv` are how the app calls `tools/`.
- `src/lib/owner.ts`: reads `holding/owner.json`.
- `src/lib/files.ts`: bounded content reads, Markdown metadata, document link resolution, and exclusive new-file queue writes.
- `src/lib/model.ts`: safe handling of claims, nested records, and unknown values.
- `src/app/`: Next.js App Router pages and the queue server action.
- `src/components/`: navigation, catalogs, provenance, document rendering, and forms.
- `src/lib/wiki.ts`: wiki page loading, view-block parsing, git snapshots.
- `src/views/`: embeddable visualizations and their registry.
- `src/app/globals.css`: the dark blue design tokens and all layouts. Fonts (Bricolage Grotesque, IBM Plex Sans and Mono) are self-hosted by `next/font` at build time; the browser contacts no font service.

Framework references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) and the installed framework's guides under `node_modules/next/dist/docs/`. Next.js generates the app-local `AGENTS.md` and `CLAUDE.md` during development; the root repo working agreement still applies.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

The tests use disposable temporary directories. They verify file access boundaries, symlink rejection, queue validation and preservation of existing files, metadata round-tripping, link resolution, and unknown model handling.

Initial verification (2026-09-25): six automated tests, TypeScript, and the production build passed. HTTP checks cover the overview, company directory and tabs, empty models, queue, prompts, identity, documents, and unavailable paths. Visual inspection and browser interaction checks remain to be completed; the available browser window changed during the attempted check.
