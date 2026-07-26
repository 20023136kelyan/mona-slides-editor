import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Electron cannot run TypeScript, and both the agent server and the shared packages
// are published as raw sources, so the main process is bundled rather than compiled
// file-by-file. Node built-ins and electron itself stay external.
const here = dirname(fileURLToPath(import.meta.url))
const outdir = resolve(here, 'dist')

await rm(outdir, { force: true, recursive: true })

/**
 * Bundle the workspace, externalise everything from npm.
 *
 * `packages: 'external'` would externalise `@mona/*` too, and those are published as
 * raw TypeScript — Electron's Node would be handed a `.ts` file it cannot load. So
 * anything under `@mona/` is compiled into the bundle and every other bare specifier
 * is left for Node to resolve at runtime from node_modules.
 */
const bundleWorkspaceOnly = {
  name: 'bundle-workspace-only',
  setup(build) {
    build.onResolve({ filter: /^[^.\/]/ }, args => (
      args.path.startsWith('@mona/') ? null : { external: true, path: args.path }
    ))
  },
}

const shared = {
  bundle: true,
  external: ['electron'],
  minify: false,
  platform: 'node',
  plugins: [bundleWorkspaceOnly],
  sourcemap: true,
  target: 'node22',
}

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(here, 'src/main.ts')],
    format: 'esm',
    outfile: resolve(outdir, 'main.mjs'),
  }),
  build({
    ...shared,
    entryPoints: [resolve(here, 'src/preload.cts')],
    // A sandboxed preload must be CommonJS.
    format: 'cjs',
    outfile: resolve(outdir, 'preload.cjs'),
  }),
])

console.log('desktop main + preload built')
