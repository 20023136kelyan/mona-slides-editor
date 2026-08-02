# Mona agent runtime

> **The name is stale.** This was a server; it is not one any more. It is the
> agent runtime, imported as a library by the desktop shell in
> [`apps/desktop`](../desktop) and running inside that process. Nothing here
> listens on a port. The directory keeps its old name for now because renaming a
> workspace package is a change worth making on its own, not as a footnote to
> the desktop migration.

## What it is

The agent half of Mona: everything between "the user typed a prompt" and "the
deck changed", with no opinion about who is calling.

| Module | Responsibility |
| --- | --- |
| `agent-sdk-auth` | Reads and starts the Claude login already on the machine |
| `agent-sdk-session` | One conversation: prompts, steering, interruption |
| `agent-sdk-stream` | SDK events translated into the UI chunk vocabulary |
| `agent-sdk-models` | The model catalogue the signed-in plan allows |
| `agent-sdk-env` | The environment the subprocess is allowed to see |
| `codex-*` | Codex app-server protocol, ChatGPT login, models, and UI streaming |
| `provider-conversation` | Provider pinning, native bindings, and context handoff |
| `agent-tool-bridge` | Tool calls the renderer must answer, correlated by id |
| `agent-workspace` | The deck as files the agent reads and edits |
| `agent-workspace-disk` | That workspace, on a real filesystem |
| `assets` | Stock photo and video search for the media panels |

It carries no browser and no editor assumptions, which is the property that made
the move to Electron a shell rather than a rewrite —
[`doc/PRODUCT_ARCHITECTURE.md`](../../doc/PRODUCT_ARCHITECTURE.md) records that
this was insured against deliberately.

## What used to be here

This package was a hosted HTTP service, and this README described a trust
boundary between a browser and hosted model accounts: a signed session cookie,
an origin allowlist, CORS, a WebSocket, an AES-256-GCM credential vault, OAuth
device flows for three providers, and signing keys production had to supply.

All of it is gone, and none of it was replaced. There is no boundary to guard
because there are no longer two parties: the renderer and the agent are two
halves of one application on one person's machine, talking over IPC through a
sandboxed preload. The vault protected credentials Mona no longer holds — the
agent uses native Claude and ChatGPT subscription logins the user already has.
The origin gate guarded a port that no longer exists.

## The boundaries that remain

Losing the network boundary did not remove every boundary. Two are real, and
both are about content rather than about callers:

- **A deck is untrusted input.** It arrives inside `.pptx` files other people
  made. Slides are sanitised before they reach the renderer, an image must
  resolve to a file the deck owns rather than to an arbitrary URL, and PDF
  export renders with scripting disabled.
- **The agent's environment is an allowlist.** `agent-sdk-env` and `codex-env`
  decide what the
  subprocess may see. This mattered more when a stray operator key would have
  silently served, and billed, every user's turn; it is ordinary hygiene now,
  but the allowlist is still the right shape.

## Verification

```bash
npm run test -w @mona/agent-server
npm run type-check -w @mona/agent-server
```
