# Mona product architecture

What Mona is beyond the editor: its surfaces, its data model, and the storage and
collaboration decisions that follow from "Mona keeps none of your work". This is a
design record, not an implementation plan. Sections marked **OPEN** are undecided.

See also:

- [`doc/UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md) — how the editor surface is composed
- [`doc/MONA_RESTART_ARCHITECTURE.md`](MONA_RESTART_ARCHITECTURE.md) — the editor runtime and command bus
- [`doc/EDITOR_EXPERIENCE.md`](EDITOR_EXPERIENCE.md) — editor disclosure and interaction gates

## The shape of the product

Everything built so far is **the editor**. The editor is the detailed control panel
for one document. It is fundamental, but it is not the point of the app — it is one
of three surfaces over a shared document core.

| Surface | Entered by | Purpose |
| --- | --- | --- |
| Home | App launch, after onboarding | Sidebar of projects; a centred chat input; a grid or list (user's choice) of documents |
| Project chat | Opening a project, or typing in the home chat input | Agentic editing across many documents at once; artifact panel on the right |
| Document editor | Opening a document, or opening one from the artifact panel | The detailed single-document editor — what exists today |

The two editors are deliberately different tools:

- **Document editor** — precise, direct manipulation, one document.
- **Project chat** — conversational, agentic, many documents. Chained and bulk
  operations: compress seven PDFs; open one, delete a page, merge it with another,
  compress the result. No detailed editing UI unless the user opens a document from
  the artifact panel, which hands off to the document editor.

Typing in the home chat input creates a project. It stays unnamed until the
conversation gives it a name, the way chat products name threads.

The sidebar lists **projects only**. The main grid lists **documents only**.

### Why the editor was built first

The agent cannot manipulate what it cannot see. The editor supplies the render
graph, the document model, and the command bus that let an agent read a document,
reason about it, and change it safely. Those are prerequisites for the project
surface, not editor conveniences.

## Core concepts

**Document** — a single file. Today a presentation; the product intends PDFs and
other types. A document has a type, a storage reference, and a set of capabilities
its type supports. `presentation-core` currently models a deck specifically; a
document-type layer above it does not yet exist.

**Project** — a named collection of documents plus the chat thread that operates on
them. Projects are the unit of collaboration.

**Machine identity** — Mona has no user accounts. Identity is scoped to the machine
so that settings, provider connections, and API keys persist between sessions
without asking the user to hand over credentials. This is a deliberate consequence
of being open source.

## Storage: bring your own

Mona connects to Google Drive, iCloud, OneDrive, a personal NAS, or local storage.
The user chooses. **Documents are never stored by Mona.**

This makes a `StorageProvider` interface a first-class core concern rather than an
integration detail. Today's [`editor-persistence`](../apps/web/src/features/editor/editor-persistence.ts)
is IndexedDB, which under this model becomes a **local cache in front of a provider**,
not the store of record.

## Chat history, collaboration, and sharing — **OPEN**

Documents are settled: they live in the user's storage. Chat history is not, because
collaboration pulls against custody.

Two different promises are in play, and they are often conflated:

| Promise | Meaning | Compatible with collaboration? |
| --- | --- | --- |
| **Custody** — "we keep none of it" | Mona's servers hold nothing | No — real-time collaboration needs a shared substrate |
| **Confidentiality** — "we cannot read it" | Mona's servers hold only ciphertext | Yes |

Collaboration (multi-user projects, Canva/Google-Docs style) and share-by-link both
require *something* server-side. The decision is which promise Mona makes.

### Options considered

**A. Plaintext server storage.** Simplest; enables server-side search, server-side
agent runs, and straightforward collaboration. Cost: the privacy position becomes
"we host your chats", which is hard to reconcile with the rest of the product.

**B. Local-first CRDT, server as an encrypted relay.** Chat and project state are a
CRDT (Yjs/Automerge). The server stores and relays **opaque blobs** it cannot
decrypt. Real-time collaboration works, works across storage providers (one user on
Drive, another on OneDrive), and works offline. Keeps a strong, true claim:
*Mona's servers cannot read your work.*

**C. Chat history in the user's own storage.** Purest custody. Collaboration is
impractical — two users on different providers share no substrate, so a relay ends
up being built anyway, which converges on B.

**Current leaning: B**, with a client-side opt-out that keeps history local-only for
users who do not want collaboration.

### Share links

Independent of the above, link sharing has a clean, standard mechanism:

1. Encrypt the document client-side.
2. Upload the ciphertext; Mona hosts it temporarily.
3. Put the key in the **URL fragment** — `mona.app/s/<id>#k=<key>`.

Browsers never transmit the fragment, so Mona holds ciphertext and never sees the
key. The recipient's browser decrypts locally. Expiry means deleting the blob. The
recipient needs no account, which suits machine identity.

The link is a **bearer capability**: anyone holding it can read. That is the
intended semantics for "share a link", but it should be stated rather than implied.

### Consequences that must be accepted with B

- **Key recovery.** Machine identity plus end-to-end encryption means a dead machine
  is unrecoverable data. An exportable recovery key is mandatory, and onboarding
  must make it unmissable. This is the largest UX cost of B.
- **Honest limits of browser E2EE.** Mona serves the JavaScript that holds the key,
  so a malicious or compromised server could ship code that exfiltrates it. The
  defensible claim is *verifiability* — open source, reproducible builds, published
  hashes — not mathematical impossibility. Say this plainly.
- **No server-side agent**, which is a decision in its own right — see
  *Execution model* below.

### Still open

- Where chat history lives when a user opts out of the cloud — the same provider as
  their documents, or purely local?
- Whether projects and their threads are represented on the user's storage at all
  (for example a `.mona/` convention), or only in the relay.
- Whether collaboration is capability-based (share links only) or eventually
  identity-based, which would require some notion of accounts after all.

## Execution model: the agent runs on the user's machine — **DECIDED**
<!-- Revised 2026-07-27, when Mona became a desktop application. -->

**Mona runs no agent infrastructure.** That has not changed and is now more
literally true than when it was first written. What changed is where "the user's
machine" means: this said *in the user's browser, under their own API keys*, and
it is now *in the user's own copy of the application, under the Claude login
already on that machine*.

The move was forced rather than chosen. The Claude Agent SDK spawns the `claude`
binary as a subprocess. A browser cannot spawn anything, so as a website that
subprocess had to live on Mona's machine — which would have made Mona an agent
host processing other people's decks, against all three reasons below. The
escape hatch this document already described became the product: see *The escape
hatch: a self-hosted worker*, which is what a desktop application is, packaged so
that an ordinary person does not have to run a container to get it.

The reasoning is threefold:

1. **The audience selects against it.** People who choose a free, open-source,
   "we cannot read your work" tool are the least likely to want their documents
   processed on someone else's machine. Users already have plenty of products that
   run server-side and collect their data; Mona is not competing there.
2. **A hosted agent is unfundable for a free project.** It means paying for other
   people's compute and carrying an abuse surface, with no revenue against it.
3. **Interactive work does not need it.** Fixing a slide, rewriting text,
   compressing a handful of PDFs — the user is present by definition, the tab is
   open, and the work finishes in seconds or minutes.

### Where client-side genuinely fails

This is a real limit, not an imagined one. Client-side execution cannot serve:

| Case | Why it breaks |
| --- | --- |
| Long batches ("process these 400 PDFs") | The laptop sleeps, the tab closes, the job dies |
| Scheduled work ("every Monday, rebuild this deck") | Cron is impossible in a browser tab |
| Event-triggered work ("when a file lands in Drive…") | Needs something listening |
| Weak hardware | Heavy WebAssembly work on a low-end machine |

Expected demand is a **minority of users**, and a smaller minority actually blocked
by the absence. The likeliest trigger is bulk operations becoming good enough to be
trusted at scale, at which point long batches start dying in closed tabs.

### The escape hatch: a self-hosted worker

*Substantially taken, ahead of schedule.* The desktop application is this option
with the container removed: the agent core runs in Node, in the shell's main
process, on the user's own machine, against their own files. What remains
unbuilt is the unattended half — cron, event triggers, work that continues with
nobody watching.

If that demand appears, the answer is **not** for Mona to operate servers. Being
open source affords a third option: the user runs the worker.

The same agent core runs in Node, in a container on the user's own machine or NAS,
with their API keys, against their storage. Mona operates nothing, sees nothing,
and pays for nothing — and the automation user gets cron.

The audiences line up almost exactly: a user who already runs a personal NAS as
their storage provider is the same user who can run a container.

### The constraint this places on the agent — today

Nothing needs building for this now; it is a v2+ concern and building for it early
would be premature. Exactly one piece of insurance is required, and it is something
the codebase needs regardless:

> **The agent core must stay free of browser and editor assumptions.**

Structured as *core (auth, loop, streaming, tool dispatch) + toolsets acting on a
document through an interface*, the same core later runs in Node with no rewrite.

This has since been collected on rather than merely insured against. The core
under `apps/agent-server/src` now runs in the desktop shell's main process
unchanged, and it is the reason the move to Electron took a shell rather than a
rewrite. Left welded to `EditorRuntime` and DOM APIs, which was the risk this
paragraph named, it would have meant rewriting the agent to ship a desktop app at
all.

## What this implies for the code as it stands

The layering is broadly right: `packages/` holds a framework-agnostic document core,
and `presentation-renderer` is a view layer shared by the editor and playback. Four
things are misfiled — under `features/editor/` because that is where everything was
built, not because they belong to editing.

**1. The agent must be lifted out and split.**
[`features/editor/agent/`](../apps/web/src/features/editor/agent) is bound to
`EditorRuntime` and the deck command bus. All three surfaces need it. The split is:

- **Agent core** — auth, provider store, loop, streaming, sandbox → app level
- **Deck toolset** — command validator, revision, slide preview → one toolset the
  agent loads when the target is a presentation

**2. "Document" must stop meaning "presentation."** A document-type layer is needed
above `presentation-core`, with per-type capabilities. Decks and PDFs are two types.

**3. Persistence becomes cache + provider.** See *Storage* above.

**4. Surface-to-surface imports must be forbidden.** `presentation-renderer`
currently imports `editor-clipboard`, `editor-fonts`, `editor-persistence`, and
`editor-table` from the editor; `screen` imports `editor-runtime`,
`use-editor-selector`, and `EditorInspectorPrimitives`. Home and project chat will
need fonts and persistence *without* the editor, so loading the home screen would
otherwise pull the entire editor in. These are document services and belong in the
core. [`scripts/check-architecture-boundaries.mjs`](../scripts/check-architecture-boundaries.mjs)
should enforce the direction once they move.

**5. Multi-document operations need different transaction semantics.** The command
bus is single-document with undo. "Open A, delete a page, merge with B, compress
both" is a job with ordered steps and partial failure. That is a different model,
not an extension of the existing bus.

## Open questions beyond storage

- **Where do PDF operations run?** Compress and merge are heavy. Open source with no
  server implies WebAssembly in the browser. That is a capability to build, not a
  library call.
- **How does the agent *see* non-deck documents?** The render graph gives it vision
  into presentations. Each new document type needs an equivalent.
- **Does the artifact panel share an implementation with the editor's agent dock?**
  They are similar surfaces with different payloads — documents rather than a single
  candidate revision.
