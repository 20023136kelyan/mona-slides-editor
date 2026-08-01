# Mona release hardening record

Last reviewed: 2026-07-27

This file records the security and stability decisions that are easy to lose
when looking only at a package-manager vulnerability count. It is not a claim
that installed third-party packages are vulnerability-free.

## Desktop, agent and document trust boundaries

- Mona is a desktop application. No HTTP agent server, WebSocket, session
  cookie, credential vault or browser OAuth callback exists.
- The sandboxed renderer has `nodeIntegration: false` and
  `contextIsolation: true`. Its only privileged surface is the explicitly named
  preload bridge.
- Packaged renderer code is served from the secure `mona://app` origin with a
  Content Security Policy. Navigation to another origin is refused; links open
  in the user's default browser.
- The Claude Agent SDK runs in the Electron main process and uses the machine's
  existing `claude` login. Mona asks the CLI for account status but never reads
  the credential from the operating-system keychain.
- The agent receives a temporary deck workspace and an allowlisted environment.
  It may use ordinary file and shell tools inside that workspace, but changes
  reach the live document only through the revision-checked, validated `apply`
  transaction.
- A deck is untrusted input. Asset names are reduced to safe basenames, imported
  content is sanitised, and the hidden PDF renderer runs with JavaScript
  disabled.
- Each presentation owns one `documents/<id>` directory. Document IDs are
  validated before they become path segments, asset URLs are scoped by that ID,
  and both `deck.json` and the rebuildable `library.json` catalogue use atomic
  sibling-file replacement.
- Duplicate and delete include document media, sketches and retained source PPTX
  archives. The previous singleton deck is moved by rename and its legacy
  renderer records are imported once rather than attached to whichever document
  opens first.
- The packaged Claude binary is executable only because its platform package is
  unpacked beside `app.asar`. The Mona agent plugin is shipped as a separate
  read-only resource; the packaged-app smoke test checks both.

## Dependency audit disposition

The 2026-07-27 `npm audit --omit=dev` result reports 12 dependency findings:
one high and eleven moderate. They form two dependency families.

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

### Claude Agent SDK desktop payload

The Claude Agent SDK brings a platform-specific executable into the packaged
application. This explains most of Mona's installed size. `electron-builder`
keeps the executable outside `app.asar`, and the release smoke test verifies its
execute bit and exact platform package. Do not remove `asarUnpack` merely to
reduce the visible resource tree: a subprocess cannot execute a member of an
asar archive.

The SDK also installs `@modelcontextprotocol/sdk`, whose optional Hono Node
server currently carries a Windows encoded-backslash path-traversal advisory.
Mona does not start an MCP HTTP server or use Hono's static-file middleware: its
MCP server is the Agent SDK's in-process transport. npm's offered fix is a
downgrade from `@anthropic-ai/claude-agent-sdk@0.3.x` to `0.2.85`, so it is not
accepted silently. Reassess when Anthropic publishes a compatible SDK release.

### Effective overrides

The root package currently pins one compatible, tested transitive security
release:

- `fast-uri@3.1.4`

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
npm run e2e:packaged
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
