// build-error-decoder — pure logic for the Next.js Build Error Decoder tool.
//
// Input : raw `next build` / `next dev` output, pasted verbatim.
// Output: every known failure signature it contains, most severe first, each
//         with the LINE of the pasted output that triggered it (the evidence
//         the UI shows), the explanation, a fix snippet and the deep-dive.
//
// No React, no DOM, no network. The patterns are the ones the Error Inbox
// signatures in tools-config.js were verified against — change one and the
// errorSignatures entry for this tool must be re-checked.
//
// `signature` is the human label listed on the tool page. `sample` is a
// realistic excerpt of the real message (Next.js, React, webpack, V8 or Node
// wording) used by the one-click examples; rules whose wording varies too much
// to quote honestly have none.

export const SEVERITY = {
  critical: { label: 'Build breaker', cls: 'bg-danger/10 text-danger ring-danger/30' },
  warning: { label: 'Likely cause', cls: 'bg-warning/10 text-warning ring-warning/30' },
  info: { label: 'Worth checking', cls: 'bg-primary/10 text-primary ring-primary/30' },
};

export const RULES = [
  {
    id: 'suspense-searchparams',
    signature: "useSearchParams() should be wrapped in a suspense boundary",
    sample: "Error occurred prerendering page \"/search\".\nError: useSearchParams() should be wrapped in a suspense boundary at page \"/search\".\nRead more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout",
    pattern: /useSearchParams\(\)\s*should be wrapped in a suspense boundary|missing-suspense-with-csr-bailout/i,
    severity: 'critical',
    title: 'useSearchParams() needs a <Suspense> boundary',
    body:
      'In the App Router, useSearchParams() opts the component into client-side rendering. During prerender, Next.js '
      + 'refuses to render it outside a <Suspense> boundary — the whole page would silently deopt. Wrap the component '
      + 'that calls the hook (not the whole page) in <Suspense>.',
    fix: `// page.js (server component)
import { Suspense } from 'react';
export default function Page() {
  return (
    <Suspense fallback={null}>
      <SearchParamsConsumer />
    </Suspense>
  );
}`,
    link: { href: '/post/fix-nextjs-missing-suspense-boundary-use-searchparams', label: 'Full fix: missing suspense boundary with useSearchParams' },
  },
  {
    id: 'chunk-load-error',
    signature: "ChunkLoadError: Loading chunk failed",
    sample: "Unhandled Runtime Error\nChunkLoadError: Loading chunk 4212 failed.\n(error: https://www.example.com/_next/static/chunks/4212-5f1c0d7a9b3e2c11.js)",
    pattern: /ChunkLoadError|Loading chunk [\w-]+ failed/i,
    severity: 'critical',
    title: 'ChunkLoadError — the browser asked for a chunk that no longer exists',
    body:
      'Almost always a deploy-skew problem: the HTML references hashed chunk files from a previous build that the CDN '
      + 'has already replaced. Users with an open tab hit it after every deploy. The fix is a reload-on-chunk-error '
      + 'boundary plus cache headers that let stale HTML expire quickly.',
    fix: `// global-error / error boundary
useEffect(() => {
  if (error?.name === 'ChunkLoadError') {
    window.location.reload();
  }
}, [error]);`,
    link: { href: '/post/nextjs-chunkloaderror-loading-chunk-failed-fix', label: 'ChunkLoadError: Loading chunk failed — the complete fix' },
  },
  {
    id: 'dynamic-server-usage',
    signature: "Dynamic server usage: couldn't be rendered statically",
    sample: "Error: Dynamic server usage: Route /dashboard couldn't be rendered statically because it used `cookies`. See more info here: https://nextjs.org/docs/messages/dynamic-server-error",
    pattern: /Dynamic server usage|couldn'?t be rendered statically|DYNAMIC_SERVER_USAGE/i,
    severity: 'critical',
    title: '"Dynamic server usage" — a static page reads request data',
    body:
      'Something inside a statically-prerendered route calls cookies(), headers(), searchParams or an uncached fetch. '
      + 'Next.js cannot know the value at build time, so the prerender aborts. Either make the route dynamic '
      + '(export const dynamic = "force-dynamic") or move the request-time read into a client component / cached fetch.',
    fix: `// choose one, deliberately:
export const dynamic = 'force-dynamic'; // route is truly per-request
// or remove the cookies()/headers() call from the static path`,
    link: { href: '/post/nextjs-dynamic-server-usage-couldnt-be-rendered-statically-fix', label: 'Dynamic server usage — how to find the culprit call' },
  },
  {
    id: 'window-undefined',
    signature: "window is not defined",
    sample: "Error occurred prerendering page \"/\".\nReferenceError: window is not defined\n    at Chart (.next/server/app/page.js:1:4821)",
    pattern: /window is not defined|document is not defined|self is not defined/i,
    severity: 'critical',
    title: '"window is not defined" — browser API executed on the server',
    body:
      'During prerender your code runs in Node, where window/document do not exist. The call usually hides in a '
      + 'module-level statement or a library import. Guard it behind useEffect, or load the library with '
      + 'next/dynamic and ssr: false.',
    fix: `import dynamic from 'next/dynamic';
const Chart = dynamic(() => import('react-chartjs-2'), { ssr: false });
// or inside a component:
useEffect(() => { /* window.* is safe here */ }, []);`,
    link: { href: '/guides/window-is-not-defined-in-nextjs-react-app', label: 'window is not defined — every variant, fixed' },
  },
  {
    id: 'module-not-found',
    signature: "Module not found: Can't resolve …",
    sample: "Failed to compile.\n\n./src/app/page.tsx\nModule not found: Can't resolve '../components/Header'",
    pattern: /Module not found: Can'?t resolve/i,
    severity: 'critical',
    title: 'Module not found — resolution, casing, or a missing dependency',
    body:
      'Three causes cover nearly every case: the package is not in dependencies (it was in devDependencies or hoisted '
      + 'differently in CI), the import path casing does not match the file (macOS is case-insensitive, Linux CI is not), '
      + 'or a tsconfig path alias is not mirrored for the bundler.',
    fix: `# 1. is it really installed for production?
npm ls the-package
# 2. does the path match EXACT file casing?
# 3. alias? check tsconfig "paths" + baseUrl`,
    link: { href: '/post/nextjs-build-module-not-found', label: 'Module not found in next build — systematic diagnosis' },
  },
  {
    id: 'tsconfig-paths',
    signature: "Can't resolve '@/…' (path alias)",
    sample: "Failed to compile.\n\n./src/app/layout.tsx\nModule not found: Can't resolve '@/components/ui/button'",
    pattern: /Cannot find module '@\/|Can'?t resolve '@\//i,
    severity: 'warning',
    title: 'The "@/" alias is not resolving',
    body:
      'Aliases live in tsconfig.json ("baseUrl" + "paths"). If the build resolves them locally but not in CI, the usual '
      + 'suspects are a missing baseUrl, a tsconfig not included in the Docker build context, or a jest/webpack config '
      + 'that does not mirror the alias.',
    fix: `// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}`,
    link: { href: '/post/nextjs-tsconfig-paths-not-working-fix', label: 'tsconfig paths not working — all the mirrors to update' },
  },
  {
    id: 'heap-oom',
    signature: "JavaScript heap out of memory",
    sample: "<--- Last few GCs --->\n\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
    pattern: /JavaScript heap out of memory|Allocation failed|server is running out of memory/i,
    severity: 'critical',
    title: 'Out of memory — the build (or dev server) exhausted the heap',
    body:
      'Known Next.js failure mode (vercel/next.js#46756, #49929): the App Router dev server leaks across hot reloads, '
      + 'and large builds blow the default heap. Raise the limit as a stopgap, then find the leak: huge MDX/content '
      + 'imports, barrel files pulling entire icon libraries, or source maps in CI.',
    fix: `# stopgap:
NODE_OPTIONS=--max-old-space-size=4096 next build
# real fixes: modularizeImports for icon barrels,
# stream large content, disable productionBrowserSourceMaps`,
    link: { href: '/fix/fix-nextjs-server-running-out-of-memory-restarting', label: 'Next.js is running out of memory — dev and build fixes' },
  },
  {
    id: 'hydration-mismatch',
    signature: "Hydration failed / text content does not match",
    sample: "Error: Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client.",
    pattern: /Hydration failed|hydration mismatch|did not match.*Server|Text content does not match/i,
    severity: 'warning',
    title: 'Hydration mismatch — server HTML ≠ first client render',
    body:
      'The server rendered one thing, the client rendered another: Date.now()/Math.random() in render, locale-dependent '
      + 'formatting, invalid HTML nesting (<p> inside <p>), or browser extensions injecting DOM. React throws the whole '
      + 'tree away and re-renders client-side — slow and noisy.',
    fix: `// render time-dependent values only after mount:
const [now, setNow] = useState(null);
useEffect(() => setNow(new Date()), []);
if (!now) return null;`,
    link: { href: '/post/nextjs-hydration-mismatch-fix', label: 'Hydration mismatch — the 6 real causes' },
  },
  {
    id: 'turbopack-stuck',
    signature: "Dev server stuck on \"compiling…\"",
    sample: null,
    pattern: /stuck on compiling|compiling \.{3}|▲ Next\.js.*turbo(?:pack)?[\s\S]*(?:hang|stuck)/i,
    severity: 'warning',
    title: 'Dev server stuck on "compiling…"',
    body:
      'The classic Turbopack hang: the dev server compiles forever without erroring. Usual culprits: a corrupted '
      + '.next cache, a circular import Turbopack handles worse than webpack, or antivirus scanning node_modules on '
      + 'Windows.',
    fix: `rm -rf .next
npm run dev
# still stuck? try the webpack path:
next dev --webpack`,
    link: { href: '/post/nextjs-turbopack-stuck-fix', label: 'npm run dev stuck on compiling — every fix that works' },
  },
  {
    id: 'port-in-use',
    signature: "EADDRINUSE: port 3000 already in use",
    sample: "Error: listen EADDRINUSE: address already in use :::3000",
    pattern: /EADDRINUSE|address already in use.*:3000|port 3000 is in use/i,
    severity: 'warning',
    title: 'Port 3000 already in use',
    body:
      'Another process (often a zombie dev server) holds the port. Kill it or run on another port — and if this is '
      + 'production, set the port explicitly instead of relying on the default.',
    fix: `# find and kill the holder (macOS/Linux):
lsof -ti:3000 | xargs kill -9
# or just move:
next dev -p 3001   /   PORT=3001 next start`,
    link: { href: '/post/how-to-set-port-in-nextjs', label: 'How to set the port in Next.js (dev + production)' },
  },
  {
    id: 'env-undefined',
    signature: "process.env.X is undefined",
    sample: null,
    pattern: /process\.env\.\w+ is undefined|env.*undefined|Missing environment variable/i,
    severity: 'warning',
    title: 'Environment variable undefined at runtime',
    body:
      'Two traps: client components only see variables prefixed NEXT_PUBLIC_ (inlined at build time — a later env '
      + 'change needs a rebuild), and hosting dashboards scope variables per-environment (a var set for Preview is '
      + 'invisible in Production).',
    fix: `# client-side needs the prefix AND a rebuild:
NEXT_PUBLIC_API_URL=https://api.example.com
# server-only vars: no prefix, read them in server code only`,
    link: { href: '/post/nextjs-vercel-env-variables-fix', label: 'Env variables undefined — the build-time inlining trap' },
  },
  {
    id: 'next-babel',
    signature: "Cannot find module 'next/babel'",
    sample: "Parsing error: Cannot find module 'next/babel'",
    pattern: /Cannot find module 'next\/babel'/i,
    severity: 'warning',
    title: '"Cannot find module next/babel" — ESLint config, not Babel',
    body:
      'This is almost never a Babel problem: the ESLint parser is told to use the next/babel preset but resolution '
      + 'fails (usually a .babelrc left behind, or an editor ESLint server running from the wrong directory).',
    fix: `// .eslintrc.json
{ "extends": "next/core-web-vitals" }
// and delete stray .babelrc unless you truly customize Babel`,
    link: { href: '/fix/parsing-error-cannot-find-module-nextbabel', label: 'Parsing error: cannot find module next/babel' },
  },
  {
    id: 'image-hostname',
    signature: "next/image hostname not configured",
    sample: "Error: Invalid src prop (https://images.example.com/photo.jpg) on `next/image`, hostname \"images.example.com\" is not configured under images in your `next.config.js`",
    pattern: /hostname .* is not configured under images|Invalid src prop/i,
    severity: 'warning',
    title: 'next/image: hostname not configured',
    body:
      'next/image refuses remote images from hosts you have not allow-listed — it would otherwise proxy and optimize '
      + 'arbitrary URLs. Add the host under images.remotePatterns.',
    fix: `// next.config.mjs
images: {
  remotePatterns: [
    { protocol: 'https', hostname: 'images.example.com' },
  ],
}`,
    link: { href: '/post/nextjs-image-hostname-not-configured-fix', label: 'next/image hostname not configured — fix + wildcard rules' },
  },
  {
    id: 'next-lint-removed',
    signature: "next lint removed (Next.js 16)",
    sample: null,
    pattern: /next lint.*(removed|deprecated)|unknown command.*lint/i,
    severity: 'info',
    title: '"next lint" was removed in Next.js 16',
    body:
      'Next.js 16 dropped the built-in lint command; ESLint now runs standalone with a flat config. Your CI pipeline '
      + 'needs its own eslint invocation.',
    fix: `npx @next/codemod@canary next-lint-to-eslint-cli .
# then: "lint": "eslint ." with eslint.config.mjs (flat config)`,
    link: { href: '/guides/nextjs-16-next-lint-removed-eslint-flat-config', label: 'next lint removed in Next.js 16 — migration guide' },
  },
];

export const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/**
 * Locate the evidence for a rule: the first line of the output its pattern
 * matches. Patterns that only match across lines (e.g. the Turbopack hang)
 * return null — the rule still fires, the UI just has no single line to show.
 */
export function findEvidence(pattern, output) {
  const lines = output.split(/\r?\n/);
  const flags = pattern.flags.replace('g', '');
  const re = new RegExp(pattern.source, flags);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return { lineNo: i + 1, line: lines[i].trim() };
  }
  return null;
}

/** Decode pasted build output into matched rules, most severe first. */
export function decode(output) {
  if (typeof output !== 'string' || !output.trim()) return [];
  return RULES
    .filter((rule) => rule.pattern.test(output))
    .map((rule) => ({ ...rule, evidence: findEvidence(rule.pattern, output) }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Rules that carry a one-click sample, for the example chips. */
export const EXAMPLES = RULES.filter((rule) => rule.sample).map((rule) => ({
  id: rule.id,
  label: rule.signature,
  output: rule.sample,
}));
