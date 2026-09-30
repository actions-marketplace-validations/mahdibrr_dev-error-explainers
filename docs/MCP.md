# MCP server

`dev-error-explainers` ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so an AI assistant (Claude Code, Claude Desktop, Cursor, VS Code / Copilot…)
can hand it a pasted error and get back the documented cause and fix.

- **One tool:** `explain_error`.
- **Offline and deterministic:** no network, no LLM, no telemetry. The same input
  always gives the same output.
- **Zero dependencies:** the stdio transport is implemented by hand in
  [`bin/mcp.js`](../bin/mcp.js). It does not use the MCP SDK.
- **Never guesses:** input it does not recognise gets
  `No known error recognised — nothing guessed` (with `isError: false`).

## Install

All snippets below start the server with
`npx -y -p dev-error-explainers dev-error-explainers-mcp`. That form runs the
package's second binary and needs the `npx` that ships with npm 7 or later
(Node.js 20+ includes npm 10). Node.js 20 or later is required.

### Claude Code

```bash
claude mcp add dev-error-explainers -- npx -y -p dev-error-explainers dev-error-explainers-mcp
```

The default scope is local (this project, just for you). Add `--scope project`
to write it to the project's `.mcp.json` for your team, or `--scope user` to
make it available in all your projects. The `--` separator is required. The
equivalent `.mcp.json` entry is:

```json
{
  "mcpServers": {
    "dev-error-explainers": {
      "command": "npx",
      "args": ["-y", "-p", "dev-error-explainers", "dev-error-explainers-mcp"]
    }
  }
}
```

### Claude Desktop

Open Settings → Developer → Edit Config. This opens
`claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server, then quit Claude Desktop completely and restart it:

```json
{
  "mcpServers": {
    "dev-error-explainers": {
      "command": "npx",
      "args": ["-y", "-p", "dev-error-explainers", "dev-error-explainers-mcp"]
    }
  }
}
```

The server's stderr log is written to `mcp-server-dev-error-explainers.log`, in
`~/Library/Logs/Claude` on macOS or `%APPDATA%\Claude\logs` on Windows.

### Cursor

Put the configuration in `.cursor/mcp.json` in your project, or in
`~/.cursor/mcp.json` to use it everywhere:

```json
{
  "mcpServers": {
    "dev-error-explainers": {
      "command": "npx",
      "args": ["-y", "-p", "dev-error-explainers", "dev-error-explainers-mcp"]
    }
  }
}
```

### VS Code (GitHub Copilot)

Put the configuration in `.vscode/mcp.json` in your workspace. The top-level key
here is `servers`, not `mcpServers`:

```json
{
  "servers": {
    "dev-error-explainers": {
      "command": "npx",
      "args": ["-y", "-p", "dev-error-explainers", "dev-error-explainers-mcp"]
    }
  }
}
```

Or add it to your user profile from a terminal:

```bash
code --add-mcp "{\"name\":\"dev-error-explainers\",\"command\":\"npx\",\"args\":[\"-y\",\"-p\",\"dev-error-explainers\",\"dev-error-explainers-mcp\"]}"
```

### From a local clone

Point `command` at Node.js and pass the absolute path of `bin/mcp.js`, for example
`"command": "node", "args": ["/path/to/dev-error-explainers/bin/mcp.js"]`.

**Native Windows:** if a client fails to start `npx` directly (the error
usually reads `spawn npx ENOENT`), launch it through the shell instead:
`"command": "cmd", "args": ["/c", "npx", "-y", "-p", "dev-error-explainers", "dev-error-explainers-mcp"]`.

## The tool: `explain_error`

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `error` | string (≤ 200 KB) | yes | The raw error message or log excerpt, verbatim |
| `node_version` | string | no | Node.js version in use (e.g. `20.10.0`), for ESM/CommonJS advice. It is usually read from the `Node.js vX` footer of the error. |
| `client` | `prisma` \| `drizzle` \| `pg` \| `psql` | no | Database client, for connection-string advice (default `prisma`) |

The tool recognises:

- Node.js ESM/CommonJS errors, such as `ERR_REQUIRE_ESM` and "Cannot use import
  statement outside a module".
- npm `ERESOLVE` logs.
- `next build` / `next dev` output.
- Browser CORS console errors.
- `postgres://` / `postgresql://` connection strings, including Supabase.
- Postgres connection errors from Node.js apps: `connect ECONNREFUSED` / `ETIMEDOUT`
  on 5432, `getaddrinfo ENOTFOUND`, Prisma `P1000` / `P1001` / `P1017`,
  "password authentication failed", "no pg_hba.conf entry", "too many clients",
  self-signed certificates.

The ChunkLoadError explainer needs two sets of HTTP response headers. It is
available from the library and the CLI, and not as an MCP argument.

The result contains:

- `content[0].text`: a concise human-readable diagnosis. It lists the cause,
  why it happens, ranked fixes with code, and official sources.
- `structuredContent`: the same result as JSON, returned for protocol versions
  2025-06-18 and later. It has this shape:
  `{ tool, version, engine, matched, redactions, results[] }`.
  - `results[]` is `src/contract.js`'s `Diagnosis` list; see `docs/CONTRACT.md`.
  - `engine` is always `contract`: the same `diagnose()` the CLI prints with
    `--json` and the GitHub Action renders.
  - The tool declares an `outputSchema` for this object.

A malformed call is a JSON-RPC error `-32602`: an unknown tool name, or
`arguments` that is not an object. An argument that has the right shape but a
bad value comes back as a tool result with `isError: true` and a message the
model can act on: an empty `error`, text over 200 KB, or an unknown `client`.
This follows the error-handling split in the MCP tools specification.

## Secrets

`src/contract.js` redacts the input before diagnosing it. The server then masks
every string of the response again before writing it to stdout, in both the text
and `structuredContent`. That second pass uses `src/redact.js`, which is
idempotent and leaves templates such as `[YOUR-PASSWORD]` alone.

Values that look like credentials by shape or position are masked:

- URL passwords (`scheme://user:PASSWORD@host`)
- `Authorization` / `Cookie` / API-key header values
- `Bearer` / `Basic` tokens and JWTs
- `NAME=value` assignments whose name says secret (`API_KEY=…`, `?token=…`)
- well-known token prefixes (GitHub, GitLab, npm, Stripe, Slack, AWS, Supabase)

A secret without any of those shapes (a bare random string on its own line, say)
cannot be recognised and is **not** masked. Do not paste credentials you would not
paste into a public issue.

## Protocol

- **Transport:** stdio. Messages are newline-delimited JSON-RPC 2.0 on
  stdin/stdout, one message per line. Logs go to stderr only. The server exits
  when stdin closes, after finishing in-flight calls.
- **Protocol versions:** the server is dual-era, as the 2026-07-28 specification
  allows.
  - **2026-07-28 (modern):** stateless.
    - Every request carries `_meta["io.modelcontextprotocol/protocolVersion"]`
      and `_meta["io.modelcontextprotocol/clientCapabilities"]`.
    - `server/discover` is implemented.
    - Results carry `resultType: "complete"` and
      `_meta["io.modelcontextprotocol/serverInfo"]`.
    - An unsupported version returns `-32022` with `data.supported`.
    - A request with a required `_meta` field missing returns `-32602`.
  - **2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 (legacy):** the
    `initialize` → `notifications/initialized` handshake.
    - The server answers with the requested version when it supports it.
      Otherwise it answers with 2025-11-25.
    - `outputSchema` / `structuredContent` are only sent for 2025-06-18 and later.
- **Methods:** `initialize`, `notifications/initialized`, `server/discover`,
  `ping`, `tools/list`, `tools/call`.
  - Any other request gets `-32601`. Notifications are never answered.
  - An invalid JSON line gets `-32700`. A message that is not a JSON-RPC 2.0
    object gets `-32600`.

Try it by hand:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"shell","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"explain_error","arguments":{"error":"Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported."}}}' \
  | node bin/mcp.js
```

## MCP Registry

[`server.json`](../server.json) is the metadata for the official
[MCP Registry](https://github.com/modelcontextprotocol/registry). It uses the
namespace `io.github.mahdibrr/dev-error-explainers`. Registry clients launch npm
packages as `npx dev-error-explainers@<version> mcp`, which runs the package's
default binary with the argument `mcp`; `bin/cli.js` hands `mcp` over to
`bin/mcp.js` (`npx dev-error-explainers mcp` works the same way).
