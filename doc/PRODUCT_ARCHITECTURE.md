# Mona product architecture

What Mona is beyond the editor: its surfaces, its data model, and the storage and
collaboration decisions that follow from "Mona keeps none of your work". This is a
design record, not an implementation plan. Sections marked **OPEN** are undecided.

See also:

- [`doc/UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md) — how the editor surface is composed
- [`doc/DATA_SOURCE_ARCHITECTURE.md`](DATA_SOURCE_ARCHITECTURE.md) — provider adapters, source identities, catalogs, and unified queries
- [`doc/DOCUMENT_JOB_ARCHITECTURE.md`](DOCUMENT_JOB_ARCHITECTURE.md) — multi-document mutation, source revisions, cancellation, and recovery
- [`doc/MONA_RESTART_ARCHITECTURE.md`](MONA_RESTART_ARCHITECTURE.md) — the editor runtime and command bus
- [`doc/EDITOR_EXPERIENCE.md`](EDITOR_EXPERIENCE.md) — editor disclosure and interaction gates

## The shape of the product

Mona now has a user-owned local-file browser, durable Project Chat, and the
detailed editor for one document. The editor is fundamental, but it is not the
point of the app — it is one of three surfaces over a shared document core.

Project Chat persists projects and conversations locally, references documents
across configured sources without copying them, reuses the machine's Claude
login, and presents attached documents in a separate artifact panel. Its agent
can coordinate, research, and edit several native `.mona` presentations in one
temporary filesystem workspace. Applying those changes creates an ordered,
durable document job that validates every source revision before it writes
through the owning provider. PowerPoint sources are now parsed by the reusable
desktop ingestion package and appear in that workspace as semantic slides plus
extracted media. Project agents can now move, resize, rotate, flip, delete,
rewrite rich text, and change supported text-body/solid shape styles on existing
slide-local PowerPoint objects through source-preserving OOXML writeback,
including straight-line geometry and line/connector styling. Every unsupported
edit remains explicit and read-only rather than
silently flattening the source deck.

| Surface | Entered by | Purpose |
| --- | --- | --- |
| Home | App launch, after onboarding | Unified document browser, filtered by the persistent data-source tree; entry point for projects and workflows |
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

### Persistent sidebar information architecture

On Home and Project surfaces, the sidebar has three product sections:

1. **Data sources** — configured local folders, cloud drives, and private NAS
   connections. Each source exposes a navigable file tree. Selecting a source or
   folder filters the document browser in the centre to that scope.
2. **Projects** — chat-like threads that can reference and modify multiple
   documents across multiple data sources. Selecting one opens its conversation
   in the centre and its artifacts in the separate right panel.
3. **Workflows** — the sidebar label for scheduled routines. This section sits at
   the bottom of the navigational content and shows each routine by name only.
   Selecting a name opens that routine's definition, schedule, status, and run
   history in the centre surface.

Documents do not form a fourth sidebar section. They appear in the centre document
browser and are reached through the data-source tree, search, and filters. The
centre browser may also offer a provider filter; that is a complementary way to
narrow the same document set, not a separate source of truth.

The sidebar's fixed brand header, geometry, collapse behavior, and settings footer
remain stable between surfaces. Its navigational content is contextual: the
document editor uses the same shell for its editing tools, while Home and Project
surfaces use the three sections above.

### Why the editor was built first

The agent cannot manipulate what it cannot see. The editor supplies the render
graph, the document model, and the command bus that let an agent read a document,
reason about it, and change it safely. Those are prerequisites for the project
surface, not editor conveniences.

### PowerPoint ingestion boundary

`packages/pptx-ingestion` is the framework- and DOM-free PowerPoint boundary. It
inventories and retains the complete OOXML package, runs the maintained parser,
converts the result into Mona's canonical presentation model, produces explicit
diagnostics, and returns a content-addressed asset set. Electron main writes the
source archive and assets beneath the document recovery directory before sending
the semantic `PresentationState` to the renderer. The editor canvas, thumbnails,
read-only views, slideshow, agent previews, and library cover generation all
continue to use the one production React render graph.

`packages/pptx-writeback` is the inverse package boundary. It compares the saved
import baseline with the desired presentation, resolves edits through immutable
source identities, refuses unsupported mutations, and patches only affected
OOXML parts. A no-op returns the exact retained archive. Existing source-backed
objects use exact in-place serializers or native copy-on-write. Source-free
text, shapes, images, connectors, charts/workbooks, tables, groups, native OMML
equations and media are generated in a small donor package and transplanted with collision-free
relationships and content types. Image replacement/backgrounds resolve only
document-owned assets. Slide-local inherited edits remain private; explicit
master/layout authoring is isolated in `deck/powerpoint/shared-layers.json` and
records the exact shared parts allowed to change. Base theme font/color authoring,
new speaker-note/comment structures, external/internal/action run links, supported
native timing/transition presets, and flat DrawingML glow/inner-shadow/reflection/
soft-edge effects are writable, including effects inherited through a theme
`effectRef`; inherited edits materialize locally without losing the inherited
outer shadow. Existing supported nodes in complex effect graphs are edited in
place without flattening. Common native camera/light/bevel/extrusion/contour/
material 3D is editable and writes back natively; graph topology authoring,
ambiguous graphs, full Office 3D/backdrop semantics, and the full Office
animation catalog, and unsupported theme matrices remain explicit boundaries.

## Core concepts

**Data source** — one configured storage scope: for example a local folder, a
Google Drive account or shared drive, an iCloud Drive root, a OneDrive account, or
a private NAS share. A source has a provider, connection configuration, one or
more roots, a hierarchical file tree, and provider-specific capabilities.

**Document** — a single file inside a data source. Today a presentation; the
product intends PDFs and other types. A document has a type, a stable storage
reference containing its source and provider identity, and a set of capabilities
its type supports. `presentation-core` currently models a deck specifically; a
document-type layer above it does not yet exist.

**Project** — a named collection of documents plus the chat thread that operates on
them. A project can reference documents from several data sources without moving
those documents into a project-owned store. The current desktop implementation
stores one versioned JSON record per project under Application Support, containing
only the conversation, source-neutral document references, display metadata, and
the opaque Claude session identity. Source paths, file bytes, and provider
credentials do not enter that record. Projects are the unit of collaboration.

**Routine** — the domain object presented in the sidebar as a workflow. It combines
a schedule, document-selection criteria, and one or more agent operations. A
routine may discover new or old documents in one or more data sources and operate
on one document or a batch on every run.

**Machine identity** — Mona has no Mona account. Settings are scoped to the
machine, and Claude authentication is a property of that machine's existing
`claude` login rather than a credential Mona stores. This is a deliberate
consequence of being open source and desktop-first.

## Storage: bring your own

Mona connects to Google Drive, iCloud Drive, OneDrive, a private NAS, or local
folders. A provider adapter describes how Mona talks to one storage system; a data
source is a user's configured instance and root within that provider. Users may
configure several sources at once, and Mona presents their file trees through one
sidebar. **The user's provider copy is the document authority.**

For local files, adding a folder makes it a scanned data source. The user separately
chooses one writable folder as the default destination for new presentations. The
same folder can serve both roles, and changing the default does not stop any folder
from being scanned. New presentations are portable `.mona` package files in that
chosen folder, never unnamed records under Application Support.

Mona keeps a recovery/cache directory per opened presentation:

```text
documents/<id>/
  deck.json
  assets/
  data/powerpoint-packages/
  data/sketches/
```

This directory is not shown as a library or data source. It is an operational
mirror used for debounced editing, assets, retained PowerPoint parts, sketches and
crash recovery. For a `.mona` document, every successful autosave atomically
rebuilds the portable package and writes it through the owning provider adapter.
Opening the file again hydrates the recovery mirror from the provider copy, so the
cache cannot quietly become a second authority.

The rebuildable cache index is not the authority: if it is missing or corrupt it is
reconstructed from recovery directories and provider catalogs. Unlinked records
from previous versions remain visible only as recovery documents with an explicit
**Move to local files** action. Deleting a recovery copy is distinct from deleting
a user-owned source file.

The prior hard-coded `decks/working` directory is moved into the library once.
Unscoped asset URLs are rewritten during that move, and renderer-owned IndexedDB
records are copied into the migrated document through explicit one-time markers.
IndexedDB is no longer an active desktop document store.

Cloud and bring-your-own providers remain future implementations of the same
ownership boundary. They will create and write the same portable package through
provider-native object identities rather than local paths.

The first external-source implementation is the local-folder adapter described
in [`doc/DATA_SOURCE_ARCHITECTURE.md`](DATA_SOURCE_ARCHITECTURE.md). It establishes
the provider-neutral identity, catalog, query, availability, and observation
contract that cloud and NAS adapters must implement.

## Chat history, collaboration, and sharing

Local project history is **DECIDED** for the desktop product: it is stored on the
user's machine with the project record and remains available across restarts.
Cloud synchronization, collaboration, and sharing remain **OPEN**.

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

**1. The agent has been lifted out and split.**
The Agent SDK session, authentication, streaming, workspace and tool bridge now
live under [`apps/agent-server`](../apps/agent-server) and run inside the Electron
main process. The renderer retains only the presentation-specific client toolset
because rendering and committing require the live `EditorRuntime`. Project Chat
uses a separate project-scoped SDK session with durable resume identity and a
project toolset, rather than pretending the editor's one-live-deck snapshot is a
multi-document workspace. Native presentations now have a desktop-owned
document capability for project-agent read, validation, and provider writeback.
The editor's richer live-deck preview and transaction tools remain a separate
single-document capability:

- **Agent core** — auth, loop, streaming, workspace and tool dispatch → desktop
  runtime, already complete for presentations
- **Project presentation toolset** — multi-document filesystem workspace, exact
  source revisions, durable jobs, and provider writeback → desktop runtime
- **Deck client toolset** — live slide preview and transaction commit → one open
  document, still filed under the editor

**2. "Document" must stop meaning "presentation."** A document-type layer is needed
above `presentation-core`, with per-type capabilities. Decks and PDFs are two types.

**3. Persistence becomes cache + provider.** See *Storage* above.

**4. Surface-to-surface imports must be forbidden.** `presentation-renderer`
currently imports `editor-clipboard`, `editor-fonts`, `editor-persistence`, and
`editor-table` from the editor; `screen` imports `editor-runtime`,
`use-editor-selector`, and `EditorInspectorPrimitives`. Home and Project Chat need
document services *without* the editor, so route code is forbidden from importing
the editor feature directly. The remaining renderer dependencies are document
services and belong in the core.
[`scripts/check-architecture-boundaries.mjs`](../scripts/check-architecture-boundaries.mjs)
enforces the Project Chat → editor boundary while those extractions continue.

**5. Multi-document operations use different transaction semantics.** The command
bus remains single-document with undo. Project operations create durable jobs
with ordered per-document steps, exact source-revision preflight, cooperative
cancellation, partial-failure reporting, and interruption recovery. A job stores
references and outcomes only; presentation payloads stay ephemeral. See
[`doc/DOCUMENT_JOB_ARCHITECTURE.md`](DOCUMENT_JOB_ARCHITECTURE.md).

## Open questions beyond storage

- **Where do PDF operations run?** Compress and merge are heavy. Open source with no
  server implies WebAssembly in the browser. That is a capability to build, not a
  library call.
- **How does the agent *see* non-deck documents?** The render graph gives it vision
  into presentations. Each new document type needs an equivalent.
- **Which PPTX serializers come next?** Direct mutation now enters through a
  framework-free source-package writer and is proven for slide-local transforms,
  deletions, rich text, text-body layout, and solid fills/outlines. Connectors,
  complex effects, tables/charts, new objects/assets, inherited content, slide
  structure, and relationship/content-type allocation still need inverse
  serializers before those edit families can be enabled.
