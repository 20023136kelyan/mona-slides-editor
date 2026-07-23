# Mona release hardening record

Last reviewed: 2026-07-23

This file records the security and stability decisions that are easy to lose
when looking only at a package-manager vulnerability count. It is not a claim
that installed third-party packages are vulnerability-free.

## Agent and account trust boundary

- OpenAI and Anthropic sign-in happens through the agent server. OAuth
  credentials are never returned to the editor, placed in generated
  JavaScript, or stored in browser storage.
- Credentials are scoped to Mona's signed `HttpOnly`, `SameSite=Lax` browser
  session and encrypted at rest with AES-256-GCM.
- Every state-changing agent request requires an approved `Origin`.
- The OpenAI adapter uses device authorization so it does not require a
  localhost browser callback.
- The current upstream Anthropic adapter binds a fixed localhost callback port.
  Mona exposes its manual callback prompt for hosted use and rejects
  overlapping Anthropic login attempts with HTTP 409 instead of allowing a
  callback-port collision.
- Generated presentation programs execute in an opaque-origin sandbox with no
  credentials, cookies, filesystem, or ambient network access. The parent
  accepts only the bounded presentation-command protocol.
- Google AI Studio remains the explicit bring-your-own-key path. Its key lives
  only in the current browser tab's memory.
- The Mona-managed provider is disabled in the editor when its server status
  reports that the deployment has not configured it.

Production deployments must follow `apps/agent-server/README.md`, supply their
own signing and encryption secrets, use encrypted persistent storage, and
replace the local credential-vault adapter before running multiple server
instances.

## Dependency audit disposition

The 2026-07-23 `npm audit --omit=dev` result reports 13 transitive findings:
one high and twelve moderate. They form two dependency families.

### Excalidraw optional Mermaid converter

The current stable `@excalidraw/excalidraw@0.18.1` depends on
`@excalidraw/mermaid-to-excalidraw`, whose parser tree contains the reported
`lodash-es`, Chevrotain/Langium, and one `nanoid` chain. Mona does not offer
Mermaid-to-drawing conversion. The web build aliases that optional dynamic
import to `excalidraw-mermaid-disabled.ts`, and the embedded drawing surface
sets `aiEnabled={false}`. The production build therefore contains a 120-byte
disabled adapter instead of the Mermaid parser stack.

The remaining Excalidraw `nanoid@3.3.3` advisory concerns predictable output
when callers provide a non-integer size. Excalidraw's production bundle calls
`nanoid()` with its default size; Mona does not expose a size parameter or use
those identifiers as credentials or security boundaries.

The package remains installed because it is an exact dependency of the current
stable Excalidraw package, so npm continues to report the metadata even though
the vulnerable optional parser code is excluded from Mona's production graph.
Do not accept npm's suggested downgrade to Excalidraw 0.17.6 merely to reduce
the audit count.

### Provider library optional Google/MCP branch

`@earendil-works/pi-ai` installs `@google/genai`, which has an optional MCP
server dependency that reaches an old `@hono/node-server`. Mona's agent server
imports and registers only the OpenAI Codex and Anthropic provider modules. It
does not register the Google GenAI provider, create an MCP server, import
Hono's static-file middleware, or run on Windows.

Google support is implemented separately in the browser as the AI Studio-key
adapter. Reassess this exception whenever the provider library is upgraded or
Mona adds a server-side Google/MCP integration.

### Effective overrides

The root package currently pins only two compatible, tested transitive
security releases:

- `fast-uri@3.1.4`
- `image-size@1.2.1`

No unverified major-version override and no `npm audit fix --force` is
permitted in the release path. An upstream dependency update should replace
each documented exception as soon as its full build, browser, agent, and
PowerPoint regression suite passes.

## Required release evidence

Before a release, run:

```bash
npm run type-check
npm run lint
npm run i18n:check
npm run check:architecture
npm run test:core
npm run test:react
npm run e2e:react
npm run build
npm run test:production-stability
npm run profile:memory
npm audit --omit=dev
```

After the build, verify that no Mermaid parser implementation entered the
production assets:

```bash
rg "chevrotain\\.io|langium" apps/web/dist/assets -g "*.js"
```

The command must return no matches. A non-zero npm audit count is not silently
waived: it must continue to match the two reviewed dependency families above.
