# Mona document-job architecture

How Project Chat turns changes across several user-owned documents into durable,
observable provider writes without treating a multi-file operation like one
editor undo transaction.

See also:

- [`doc/PRODUCT_ARCHITECTURE.md`](PRODUCT_ARCHITECTURE.md) — projects, artifacts,
  custody, and product surfaces
- [`doc/DATA_SOURCE_ARCHITECTURE.md`](DATA_SOURCE_ARCHITECTURE.md) — provider
  adapters and opaque document references
- [`doc/MONA_RESTART_ARCHITECTURE.md`](MONA_RESTART_ARCHITECTURE.md) — the
  single-document editor command bus

## Boundary

The editor command bus mutates one open presentation and supplies undo. A Project
Chat turn may touch several closed files in different providers. Mona therefore
models project mutation as a **durable ordered job**, not as an editor command or
an all-files transaction.

The framework-free contracts live in
[`packages/document-jobs`](../packages/document-jobs/src/index.ts). They import no
React, Electron, provider implementation, or agent SDK code.

```text
Project agent
  → temporary multi-document workspace
    → changed presentation payloads (ephemeral)
      → ProjectDocumentJobEngine
        → durable job record (references + revisions + outcomes)
        → ordered provider writeDocument steps
        → project job events
          → Project Chat progress and cancellation UI
```

## Agent workspace

Every project session receives a private temporary directory:

```text
project.json
documents/
  <artifact-id>/
    deck/
      deck.json
      slides/01.json
      assets/...
```

`project.json` lists every attached document and states whether it is editable.
Native `.mona` presentations are expanded into ordinary JSON and media files so
the agent can use its standard read, search, edit, and write tools. Unsupported
or unavailable sources remain in the list with a precise read-only reason and no
fake editable directory.

The workspace does not contain a writable source revision. Revisions are held by
the trusted executor, so editing workspace files cannot bypass concurrency
checks. `apply_changes` reads only actual structural changes, ingests newly
referenced asset bytes, and sends the payload directly to the job engine.
`sync_documents` discards uncommitted workspace edits and hydrates fresh source
state.

## Durable record and ephemeral payload

A persisted job contains:

- project and job identities;
- one ordered step per changed artifact;
- opaque provider document references;
- the exact expected SHA-256, modification time, and byte size;
- status, timestamps, cancellation intent, and bounded error text.

It never contains:

- a provider filesystem path or credential;
- source or output document bytes;
- base64 assets;
- the presentation model; or
- the agent's temporary workspace path.

The modified presentation and newly added assets exist only for the duration of
the executing call. This keeps project history small and avoids creating a
second document store inside Mona.

## Execution semantics

Before the first write, the engine preflights every requested step. It validates
the presentation model, rejects scriptable markup and unsafe media references,
checks asset paths/counts/sizes, confirms the source is a native `.mona` package,
and compares the complete source revision with the revision captured for the
workspace.

Steps then execute in their declared order. Immediately before each provider
write, Mona reads and hashes that source again. If it changed during the job, the
step fails without overwriting it. A successful write is atomic inside the
provider adapter; only then is the local recovery mirror refreshed and the
project artifact marked modified.

The job itself is not globally atomic:

- all steps succeed → `succeeded`;
- some succeed and a later step fails or is cancelled → `partial`;
- no step succeeds and at least one fails → `failed`;
- all remaining work is cancelled before a write → `cancelled`;
- the application exits with pending work → `interrupted`.

Already-written documents are never rolled back with stale bytes. Cancellation
is cooperative and checked between document steps. Startup marks nonterminal
records interrupted; it does not replay mutations whose provider outcome may be
unknown.

## Supported capability

Direct project-agent writeback supports native `.mona` presentations and
source-preserving `.pptx` editing. External PowerPoint presentations are
ingested through the reusable desktop package and materialized in the agent
workspace as semantic slide JSON plus extracted media. The agent may move,
resize, rotate, flip, delete, rewrite rich text, adjust text-body layout, and
change supported object semantics on existing source-backed objects. It may also
add source-free editable objects and media from that document's `deck/assets/`,
replace native image payloads, author image backgrounds, and explicitly edit
master/layout drawings through `deck/powerpoint/shared-layers.json`. The writer
resolves exact OOXML identities, transplants generated dependencies, and checks
the provider revision immediately before write. It supports base theme
colors/fonts, native OMML equations, new speaker-note/comment structures,
internal/action run links, supported timing/transition presets, and editable flat
DrawingML effects, including materialization of theme-inherited `effectRef`
styles while preserving their outer shadow, and topology-preserving edits to
existing supported `effectDag` nodes. It still refuses forged source metadata,
payload-free opaque objects and unsupported slide structure. Common native 3D
camera/light/bevel/extrusion/contour/material values are writable; effect-graph
topology changes, ambiguous repeated graph nodes, full Office 3D/backdrop semantics, and
unmapped Office animation/theme semantics rather than flattening or guessing.

## Observable UI

The renderer subscribes through the sandboxed preload bridge to job-change
events. Project Chat displays the latest job's explanation, aggregate progress,
terminal result, per-document state, and a Cancel action only while cancellation
can still have an effect. The activity is rendered directly on the conversation
surface, consistent with Mona's no-card rule.

## Verification

Automated coverage locks:

- framework-free contract validation and progress calculation;
- native and bounded PowerPoint provider writeback without payload persistence;
- exact no-op, object/straight-line geometry, connector style, rich-text,
  text-body, solid-style, generated object/media, image replacement, and
  explicit shared-layer PowerPoint round trips with untouched package parts
  preserved;
- stale-source rejection and partial outcomes;
- cancellation between document writes;
- interruption recovery without replay;
- multi-document workspace isolation, actual-change detection, asset ingestion,
  read-only artifacts, and sync reset;
- Project Chat progress and cancellation behavior; and
- packaged inclusion of the project-agent skill.
