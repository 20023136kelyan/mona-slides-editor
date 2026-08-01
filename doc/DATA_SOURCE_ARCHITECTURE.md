# Mona data-source architecture

How Mona discovers documents across local folders, cloud drives, iCloud Drive,
OneDrive, and private storage without teaching the renderer how any provider
works.

See also:

- [`doc/PRODUCT_ARCHITECTURE.md`](PRODUCT_ARCHITECTURE.md) — documents, projects,
  routines, custody, and execution decisions
- [`doc/UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md) — the persistent sidebar and
  document-browser selection semantics

## One contract, configured instances

A **provider adapter** is code for one storage technology. A **data source** is
one user-configured instance of that provider: a specific local folder, Google
Drive account/root, OneDrive account/root, iCloud Drive root, or NAS share.
Several data sources can use the same adapter.

```text
Renderer query
  → sandboxed preload
    → DataSourceService
      → adapter selected by source.provider
        → filesystem / provider API
      ← provider records normalized into Mona items
    ← summaries, tree nodes, documents, status, change events
```

The shared contract lives in
[`packages/data-source`](../packages/data-source/src/index.ts). It defines:

- `DataSourceSummary` — configured-instance identity, display name, provider,
  availability, root item, and capabilities;
- `DataSourceItem` — normalized folder or document nodes;
- `DataSourceDocumentReference` — the durable `{ sourceId, itemId }` pair used
  by projects, routines, and linked Mona working documents;
- `DataSourceQuery` — one optional source/folder/document scope plus search;
- `DataSourceChangeEvent` — configuration, content, or availability changes.

Provider item IDs are opaque. The renderer may retain them and send them back,
but it cannot derive a local path, cloud request, credential, or account from
them.

## Adapter interface

The desktop-only interface is
[`data-source-adapter.ts`](../apps/desktop/src/data-source-adapter.ts):

| Operation | Meaning |
| --- | --- |
| `inspect` | Report available, unavailable, permission-required, or error |
| `scan` | Build the normalized tree and searchable document catalog |
| `readDocument` | Return bytes for one opaque document identity |
| `readThumbnail` | Return a portable embedded cover, when the provider format carries one |
| `createDocument` | Create a user-owned document in a writable source |
| `writeDocument` | Atomically replace a user-owned native document |
| `renameDocument` / `deleteDocument` | Manage a native document without exposing paths |
| `watch` | Notify the service that content or availability may have changed |
| `capabilities` | Tell the product what this adapter currently exposes |

`DataSourceService` owns configuration persistence, adapter selection, catalog
persistence, queries, serialized mutations, watcher lifecycles, and events.
Adapters do not know about React, routes, sidebar state, projects, or routines.

## Local-folder adapter

The first production adapter is
[`local-folder-data-source.ts`](../apps/desktop/src/local-folder-data-source.ts).

- A native directory picker creates the source.
- A source may be selected as the default save location for new presentations.
- The canonical absolute root is stored only under Electron `userData`.
- Symlinks and hidden entries are not followed into the catalog.
- Supported presentation and PDF files are indexed recursively.
- Files and folders receive stable identities based on filesystem device and
  inode rather than paths, so ordinary renames preserve references.
- Catalog records retain relative paths privately for reads; IPC strips them.
- Reads revalidate containment, file type, symlink status, and filesystem
  identity before returning bytes.
- A recursive watcher debounces changes, refreshes the persisted catalog, and
  notifies every application window.
- Removing a source deletes only Mona's configuration and catalog. It never
  deletes or changes the user's folder.
- New presentations are portable `.mona` ZIP packages at the source root.
- Portable `.mona` packages carry `previews/cover.<format>` and its revision
  metadata. PowerPoint files use their standard `docProps/thumbnail.*` cover
  when one is present.
- Package manifests carry a document UUID, so an atomic file replacement does
  not change the provider-neutral document identity.
- Autosave writes the recovery mirror first and then atomically updates the
  user-owned package. A failed provider write remains visibly dirty and retryable.

## Project-agent writeback

Project Chat never writes a provider path directly. For every changed native
presentation, the desktop job engine:

1. resolves the project's opaque `{ sourceId, itemId }` reference;
2. reads the complete source bytes and computes a SHA-256 revision with the
   provider's modification time and byte size;
3. requires that revision to match the one captured when the agent workspace was
   opened;
4. validates the changed Mona presentation and any newly added assets;
5. re-reads the provider revision immediately before the step is committed;
6. calls the adapter's safe `writeDocument` contract; local native packages use
   atomic replacement, while local PowerPoint uses rollback-protected in-place
   replacement so its inode-backed provider identity remains stable; and
7. hydrates the recovery mirror from the bytes the provider accepted.

This prevents an agent from overwriting a document that changed outside Mona
while the conversation was in progress. A multi-document job is atomic per
document, not across providers: completed steps remain completed if a later
source fails or the user cancels. Durable job records contain source references,
expected revisions, statuses, and errors only—never source paths, document
bytes, asset bytes, or the modified presentation model.

The catalog makes center-browser search and subtree filtering independent of
directory size after indexing. It also supplies the last-known tree while a
source is temporarily offline.

## Library covers

The renderer captures the first visible slide with the production slide
renderer after a successful deck save. Cover generation is a debounced derived
write, so normal autosave does not wait for image encoding. Explicit editor
flushes do wait, ensuring that returning Home or closing the window does not
leave a known-stale cover behind.

The desktop process accepts a cover only when its `expectedSavedAt` exactly
matches the stored deck revision. A late render can therefore never overwrite a
newer document with stale pixels. Recovery covers live under
`documents/<id>/previews/`; user-owned `.mona` files receive the same directory
inside their ZIP package.

Home never reads provider paths or document bytes directly. It requests
revisioned `mona://preview/document/...` or `mona://preview/source/...` URLs.
The protocol handler serves recovery covers and asks the selected adapter for
portable provider thumbnails. Provider covers are cached under Electron
`userData` by a hash of source identity, item identity, modification time, and
size; negative results are cached too, and old cache entries are pruned. This
keeps grid scrolling independent of source latency while ensuring a changed
file receives a new cache identity.

When an external PowerPoint has no embedded package thumbnail, Home uses a
neutral presentation placeholder until Mona opens and renders it. Once opened,
the linked recovery document supplies the real cover without changing or
copying the source file.

## Provider strategies

| Provider | Adapter identity | Tree/search | Change observation |
| --- | --- | --- | --- |
| Local folder | Filesystem device + inode | Persisted local catalog | Recursive filesystem watcher |
| Google Drive | Drive file ID | Drive list/search API | Changes API page token |
| OneDrive | Microsoft Graph drive-item ID | Graph children/search | Delta link |
| iCloud Drive | File Provider identity when available; filesystem identity for a hydrated root | File Provider/local catalog | File Provider or filesystem events |
| Mounted NAS | Filesystem identity | Local-folder adapter | Filesystem watcher |
| Direct NAS | Server-native object/path ID | SMB/WebDAV adapter | Provider events or reconciliation polling |

Cloud credentials never enter the renderer or the data-source catalog. A future
cloud adapter stores only a keychain credential reference in its private source
configuration.

## Unified Home query

Home owns one `DocumentBrowserScope`:

- `all` — every configured source plus recovery-only documents that still need a
  user-selected save location;
- `source` — one source root, folder, or document item.

Sidebar selection and the center location selector write this same state. Search
is applied to both provider results and recovery-only documents. A source document
that has already produced a recovery mirror is rendered once. Opening a `.mona`
file rehydrates that mirror from the source package before entering the editor.

The center browser presents only presentations in this phase. It supports a
thumbnail grid and compact list, recency grouping, source filtering, title
search, and stable name/modified sorting. These are views over the same unified
query; they do not introduce a second library database.

Projects retain `DataSourceDocumentReference` values, not paths or copied files;
routines must follow the same rule when implemented. That is why remote adapters
can be added without changing the project or routine reference model.
