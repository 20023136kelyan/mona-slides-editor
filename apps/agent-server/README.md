# Mona agent server

This service is the trust boundary between the presentation editor and hosted
model accounts. Generated JavaScript never receives provider credentials,
cookies, filesystem access, or ambient network access.

## Provider paths

- **OpenAI** uses the provider-owned ChatGPT Plus/Pro device-code flow exposed
  by `@earendil-works/pi-ai`. The browser shows the one-time code while the
  server polls the provider and stores the resulting OAuth credential.
- **Anthropic** uses the provider-owned Claude Pro/Max flow. The current
  provider implementation first attempts a localhost callback and also exposes
  a manual prompt. On a remote Mona deployment, the user can paste the final
  redirect URL into that prompt. A deployment with an Anthropic-issued web
  redirect/client should replace this adapter rather than copying a private
  client identity.
- **Google AI Studio** intentionally remains a web adapter. A user-supplied key
  lives only in the current browser tab and is cleared on reload or provider
  switch.

Subscription eligibility and provider terms remain provider-controlled. Mona
does not convert a consumer subscription into a generic API credential.

## Security and persistence

The server sets a signed, `HttpOnly`, `SameSite=Lax` session cookie. OAuth
credentials are encrypted at rest with AES-256-GCM and are only decrypted
inside the server-side provider adapter. Mutations require an approved Origin.
Provider errors are redacted before they cross the API boundary.

Development generates local signing/encryption keys under the gitignored
`apps/agent-server/var/` directory. Production must provide:

```text
NODE_ENV=production
MONA_CREDENTIAL_ENCRYPTION_KEY=<32 bytes encoded as base64 or 64 hex digits>
MONA_SESSION_SIGNING_KEY=<32 bytes encoded as base64 or 64 hex digits>
MONA_WEB_ORIGINS=https://slides.example.com
MONA_AGENT_STATE_DIR=/persistent/mona-agent
```

`MONA_AGENT_STATE_DIR` must be on encrypted persistent storage for a hosted
single-instance deployment. `CredentialVault` is deliberately an interface so
a multi-instance deployment can replace the encrypted file adapter with a
transactional database or secret-store adapter without changing the provider
or editor protocols.

Until Mona account identity is added, provider credentials are scoped to the
signed browser session. Clearing the session cookie disconnects that browser;
the future identity layer should supply a stable Mona user ID to the same
vault interface.

## Managed images

The image service searches Wikimedia Commons, signs every result, imports a
presentation-resolution derivative through the server, verifies MIME, byte
size, and pixel dimensions, and serves only content-addressed local assets.
Generated code cannot request arbitrary URLs.

## Local development

From the repository root:

```bash
npm run dev
```

This starts both the web editor and the agent server. The Vite server proxies
`/api/agent` to `http://127.0.0.1:8788`.
