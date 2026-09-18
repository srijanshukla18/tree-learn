# Tree Learn

A chat for learning that grows as a tree instead of a line.

Every question and its answer is one node. Ask from any node and you get a branch, so the ten counter-questions
you thought of while reading the first paragraph all have somewhere to go. The ones you cannot chase right now can be
**parked**: they sit on the canvas as an open loop until you come back. Select any phrase in an answer and ask about
that phrase, and the passage stays highlighted afterwards, linked to the branch that grew from it.

It runs two ways from one codebase:

| | Local | Hosted |
| --- | --- | --- |
| Models | your **pi** setup: every provider, key and OAuth login in `~/.pi/agent` | your own **OpenRouter** key |
| Storage | one JSON file per topic in `data/` | IndexedDB, in your browser |
| Server | a small local API | none, the page is static |
| Run | `npm run dev` | `npm run deploy` |

## Running it locally

```bash
npm install
npm run dev
```

The interface is at **http://localhost:5180**. Models, providers and defaults come from pi, and changes you make there
(enabling a model, logging into a provider, editing `models.json`) appear the next time you open the model menu.

The API listens on `127.0.0.1:4747` and refuses requests from other machines and other websites, because it can spend
your provider credits. To reach it from your phone on the same network, name the host you will use:

```bash
TREE_LEARN_ALLOWED_HOSTS=my-mac.local npm run dev
```

Other settings: `PORT` for the API, `WEB_PORT` for the interface, `TREE_LEARN_DATA` for where topics are stored.

## Deploying the hosted version

```bash
npx wrangler login
npm run deploy
```

That builds a static site and puts it on Cloudflare. There is no server, no database and no account to create, so there
is nothing to operate and nothing of anyone else's to look after.

Visitors bring their own OpenRouter key, either by approving the app on openrouter.ai (OAuth with PKCE, which mints a
separate key they can cap or revoke) or by pasting one. The key lives in their browser. The build ships a
`Content-Security-Policy` that only allows connections to `https://openrouter.ai`, so the browser itself refuses to send
that key, or anything the learner reads and writes, anywhere else. It is worth checking in DevTools rather than
believing this file.

Set `VITE_REPO_URL` at build time to link the source from the interface.

## How it fits together

```
shared/     the whole app, minus its surroundings
  engine.ts     asking, branching, parking, undo, suggestions, auto-titles
  tree.ts       tree shape, search, Markdown export
  prompts.ts    the tutor prompt and how a root→node path becomes chat turns
  openrouter.ts the OpenRouter adapter and its OAuth
server/     local mode: JSON files + pi, exposed over HTTP with SSE streaming
web/        the interface; backend/local.ts talks to that server, backend/hosted.ts runs the engine in the browser
```

The engine does not know where topics are stored or who answers questions: local mode hands it files and pi, hosted mode
hands it IndexedDB and OpenRouter. Adding another provider or another store means writing one adapter, not a second app.

Generation belongs to the engine rather than to a connection. Close the tab mid-answer in local mode and the answer still
finishes and is saved; the tree picks it up when you come back. A process that dies mid-stream leaves no half-written
node either: an unfinished question simply returns to parked.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | local mode, API and interface together |
| `npm run dev:hosted` | hosted mode against real OpenRouter |
| `npm run typecheck` | type-check everything |
| `npm run build` / `npm start` | build and serve local mode from one process |
| `npx tsx scripts/smoke.ts <api-url> [model]` | end-to-end test of a running local server (creates and deletes topics, so point it at a scratch `TREE_LEARN_DATA`) |
| `npx tsx scripts/openrouter-check.ts [model]` | check the OpenRouter adapter against the real API |
| `npx tsx scripts/mock-openrouter.ts` | a fake OpenRouter for developing hosted mode offline |
| `npx tsx scripts/make-sample.ts <api-url> [model]` | regenerate the sample tree |

Developing hosted mode without spending anything:

```bash
npx tsx scripts/mock-openrouter.ts
VITE_OPENROUTER_BASE=http://localhost:4750/api/v1 VITE_OPENROUTER_AUTH=http://localhost:4750/auth npm run dev:hosted
```

## Keyboard

`/` ask · `⌘↵` ask and keep reading · `⌥↵` park for later · `⌘K` search everything · `←→` parent and child ·
`↑↓` the node above and below · `U` next unread · `P` next parked · `R` suggest rabbit holes · `B` bookmark ·
`C` fold · `F` fit the tree · `O` topic overview · `N` new topic · `⌫` delete (with undo) · `[` `]` panels · `?` the full list

## Your topics

They are yours and they are portable: a topic exports as Markdown or JSON, the whole library backs up to one file, and
either imports into either mode. In hosted mode they live only in that browser, so clearing site data clears them.
