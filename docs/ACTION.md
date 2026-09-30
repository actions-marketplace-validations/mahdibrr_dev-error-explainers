# GitHub Action — explain a failed CI step

`mahdibrr/dev-error-explainers` is also a GitHub Action. When a step fails, it
reads the log you saved from that step and writes the likely cause and the fix
to the **job summary**. It also adds **annotations**: on the file and line when
the log names a file that exists in your checkout, otherwise one annotation for
the whole job.

It uses the same explainers as the CLI and ships from the same commit: the
diagnosis is `src/contract.js` `diagnose()`, the result the CLI prints with `--json`. It makes
no network calls, uses no LLM and adds no dependencies. When nothing in the log
is recognised it says so and guesses nothing.

V1 is deliberately small. It writes a job summary and annotations. It never
comments on PRs, opens issues or changes your code.

## Usage

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci

      - name: Build
        id: build
        continue-on-error: true      # let the explain step run…
        shell: bash
        run: |
          set -o pipefail
          npm run build 2>&1 | tee build.log

      - name: Explain the failure
        if: steps.build.outcome == 'failure'
        uses: mahdibrr/dev-error-explainers@v0
        with:
          log-file: build.log

      - name: Fail the job if the build failed
        if: steps.build.outcome == 'failure'
        run: exit 1                  # …then keep the job red
```

Three details matter here.

- **`set -o pipefail` is required.** Without it the pipeline returns the exit
  code of `tee`, which is 0, and a failed build looks green.
- **Check `steps.build.outcome`, not `failure()`.** `continue-on-error: true`
  turns the failed step into a success for `failure()`, so `if: failure()`
  would never fire. `outcome` is the result before `continue-on-error` applies.
- **Keep the last step.** It turns the job red again. Without
  `continue-on-error` you would need `if: failure()` on the explain step and
  would not need the last step, but then later steps are skipped.

On Windows runners the default shell is `pwsh`, so set `shell: bash` as shown.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `log-file` | (required) | Path to the log, relative to the workspace. Only the last 2 MB are read, and the explainers analyse the last 50 000 characters, which is where the error usually is. ANSI colours are stripped. |
| `node-version` | `''` | Node.js version for the ESM/CommonJS advice. A version printed in the log wins over this one. |
| `fail-on-unrecognised` | `false` | Fail this step when nothing in the log is recognised. |
| `max-annotations` | `10` | Maximum number of annotations. GitHub also caps each type at 10 per step. |

## Outputs

| Output | Example |
|---|---|
| `recognised` | `true` / `false` |
| `families` | `esm-cjs-explainer,build-error-decoder` (the explainers that fired) |
| `summary-md` | The Markdown written to the job summary, with secrets masked |

Pass `summary-md` to later steps through `env:`. Never paste it inside a
`run:` script with `${{ }}`, because it contains backticks and text taken from
the log.

## Permissions

The action needs no permissions beyond the defaults, and `contents: read` is
enough. Job summaries and annotations are written through the runner's files
and workflow commands, not through the API, so no token is used.

```yaml
permissions:
  contents: read
```

## What it writes

A section for each finding, with:
- the title and the explainer that produced it;
- where the error is (`file:line:col`, when the log names a file in your
  checkout);
- the evidence line from the log;
- the cause;
- numbered fixes, with code blocks;
- the source link.

It ends with a footer: `Run locally: npx dev-error-explainers < build.log`.

**Annotations.** A file annotation is emitted only when three things are true:
- a `path(line,col)` (tsc) or `path:line[:col]` (Node, webpack, ESLint) appears
  within a few lines of the error;
- that path is inside the workspace and not under `node_modules`;
- the file exists.

Otherwise the action emits one job-level annotation per finding, with the
finding's title. The level follows the finding's severity:
- `critical` or unrated → `error`;
- `warning` → `warning`;
- `info` → `notice`.

**Secrets.** Everything written to the summary, the annotations and the outputs
is masked first with the library's `redact()` (`src/redact.js`). That covers
URL passwords, `Authorization` / `Cookie` / API-key headers, variables whose
name says "secret", bearer tokens, JWTs and well-known token prefixes. Lines
from the log are never echoed to the step's stdout, so a line such as `::error::`
inside the log cannot inject a workflow command.

**Nothing recognised.** The action emits a `notice` ("No known error recognised —
nothing guessed") and exits 0, or exits 1 with an `error` when
`fail-on-unrecognised: true`.

## Supported errors

The action supports the same errors as the CLI:
- CORS console errors (for example, from an e2e run);
- ESM/CommonJS errors (`ERR_REQUIRE_ESM`, `Cannot use import statement`…);
- npm `ERESOLVE` logs;
- Next.js build errors;
- `postgres://` connection strings, whose password is never printed;
- Postgres connection errors from Node.js apps (`ECONNREFUSED` on 5432,
  Prisma `P1001`, `no pg_hba.conf entry`…).

The ChunkLoadError caching explainer needs two `curl -I` outputs, not a log, so
the action does not run it.
