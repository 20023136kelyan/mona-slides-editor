# Mona agent provider and context architecture

Status: implemented desktop architecture, updated 2026-08-03.

Mona has one agent product and two native model harnesses. Claude runs through
the Claude Agent SDK; OpenAI runs through the Codex app-server. The React
renderer, transcript, composer, document tools, and persistence model do not
branch by provider.

## Invariants

1. A model choice is sampled when a generation starts. Changing the picker does
   not replace a running provider. A prompt submitted during a run steers that
   same native turn; the next idle generation uses the new selection.
2. Provider branding appears in account/model controls, not beside assistant
   messages. The conversation remains one Mona conversation.
3. Conversation text is canonical Mona data. Provider thread IDs and provider
   compaction are resumable execution state, not the source of chat history.
4. Claude and Codex receive the same document workspace and the same validated
   Mona tool boundary. A provider cannot acquire a weaker or broader editing API.
5. The renderer never receives an access token, API key, native thread ID, or
   provider subprocess handle.

## Canonical context ledger

Every canonical message has a stable `id`, a `user` or `assistant` role, and
plain text content. Tool output and provider reasoning remain in the native
provider thread and the live UI stream; they are not copied into cross-provider
handoffs.

For editor chat, the renderer derives this ledger from AI SDK `UIMessage`s and
sends it over the narrow preload bridge. Electron validates and deduplicates it.
For Project Chat, Electron reconstructs the ledger from the durable project
record and does not trust a renderer-supplied history.

Each provider has an independent binding:

```ts
interface AgentProviderSessionBinding {
  modelId: string
  sessionId: string
  synchronizedThroughMessageId?: string
}
```

The cursor means that the provider's native thread already knows every canonical
message through that ID. Before a new idle turn, Mona takes the messages after
the cursor and before the current user message:

- Claude receives a bounded, clearly delimited context handoff prepended to the
  new prompt.
- Codex receives equivalent raw user/assistant Responses items through
  `thread/inject_items`, followed by the new prompt through `turn/start`.

After completion, the cursor advances to the assistant message ID (or the user
message ID when no assistant text was produced). Project bindings and canonical
messages are written to the project record. Version-1 projects with a single
Claude session ID migrate to the provider-keyed version-2 shape on read.

## Native-session lifecycle

Only one provider process is mounted for a conversation at a time. On a provider
switch Mona closes the previous process, keeps its native binding and cursor,
creates a fresh document workspace for the selected provider, resumes its native
thread when available, and injects only the missed canonical messages. This is
both a resource limit and a correctness boundary: a provider cannot return to a
workspace snapshot captured before the other provider changed the document.

Changing model within one provider starts a new native thread and resets that
provider's cursor, so the complete canonical history is handed to the new model.

## Harnesses and shared tools

Claude uses the Agent SDK's filesystem/shell loop and Mona MCP tools. Codex uses
the app-server JSONL protocol, a workspace-write sandbox, and experimental
dynamic tools. Both mount the same runtime implementations:

- editor: `look`, `apply`, and `sync` over one live deck;
- project: `project_documents`, `apply_changes`, and `sync_documents` over the
  project's attached documents.

`apply` and `apply_changes` remain the only paths from an agent workspace to user
documents. They retain Mona's revision checks, validation, transaction history,
durable job semantics, and provider writeback rules.

## Authentication and model discovery

Electron discovers accounts and models through each native harness:

- Anthropic uses the machine's Claude login and the Claude CLI's supported login
  flow.
- OpenAI uses Codex app-server `account/read` and the supported ChatGPT browser
  login flow. Model choices come from paginated `model/list` results for that
  account.

Mona stores neither provider's credential. Browser login opens in the user's
default browser and completes inside the provider process. No OpenAI or
Anthropic API-key field exists in the renderer. A future Google adapter can use
an AI Studio key without changing the canonical context or tool architecture.

## Failure behavior

A provider startup failure emits a normal assistant start/error/finish sequence,
so the shared UI cannot hang in `submitted`. If Codex app-server exits after
startup, all pending RPC calls are rejected, the active text/reasoning parts are
closed, an error and finish chunk are emitted, and the failed session is removed
so a later turn can create a clean process.

## Verification

The automated suite covers context slicing, provider switching, in-flight
provider pinning, migration, shared composer behavior, and renderer-free protocol
types. An opt-in live test also verifies the installed Codex binary, current
ChatGPT login, dynamic model discovery, native thread start, and streamed output:

```bash
MONA_LIVE_CODEX_TEST=1 \
MONA_CODEX_EXECUTABLE=/absolute/path/to/codex \
npm test -w @mona/agent-server -- src/codex-live.test.ts
```
