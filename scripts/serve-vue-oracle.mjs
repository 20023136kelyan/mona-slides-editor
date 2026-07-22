import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const oracleRoot = join(repositoryRoot, 'tests/oracle/vue')
const publicRoot = join(repositoryRoot, 'public')
const fontRoot = join(oracleRoot, 'fonts')

const argumentsAfterSeparator = process.argv.slice(2)
const readArgument = (name, fallback) => {
  const index = argumentsAfterSeparator.indexOf(name)
  return index === -1 ? fallback : argumentsAfterSeparator[index + 1] ?? fallback
}

const host = readArgument('--host', '127.0.0.1')
const port = Number(readArgument('--port', '5173'))

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid --port value: ${port}`)
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

const assertFrozenArtifactExists = async () => {
  const manifest = await readFile(join(oracleRoot, 'SHA256SUMS'), 'utf8')
  for (const line of manifest.trim().split('\n')) {
    const [expected, file] = line.trim().split(/\s+/, 2)
    const path = safeFile(oracleRoot, file)
    if (!path || !expected) throw new Error(`Invalid frozen-oracle checksum row: ${line}`)
    await access(path)
    const actual = createHash('sha256').update(await readFile(path)).digest('hex')
    if (actual !== expected) throw new Error(`Frozen Vue oracle checksum mismatch: ${file}`)
  }
}

const fontFiles = (await readdir(fontRoot))
  .filter(file => file.endsWith('.woff2'))
  .map(file => ({ file, stem: file.slice(0, -'.woff2'.length) }))

const safeFile = (root, pathname) => {
  const normalized = normalize(pathname).replace(/^[/\\]+/, '')
  const candidate = resolve(root, normalized)
  const traversal = relative(root, candidate)
  return traversal.startsWith('..') || traversal.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)
    ? null
    : candidate
}

const existingFile = async path => {
  if (!path) return null
  try {
    return (await stat(path)).isFile() ? path : null
  }
  catch {
    return null
  }
}

const resolveRequest = async pathname => {
  const oracleFile = await existingFile(safeFile(oracleRoot, pathname))
  if (oracleFile) return oracleFile

  if (pathname.startsWith('/assets/') && pathname.endsWith('.woff2')) {
    const requested = pathname.slice('/assets/'.length)
    const font = fontFiles.find(({ stem }) => requested.startsWith(`${stem}-`))
    if (font) return join(fontRoot, font.file)
  }

  const publicFile = await existingFile(safeFile(publicRoot, pathname))
  if (publicFile) return publicFile

  return join(oracleRoot, 'index.html')
}

await assertFrozenArtifactExists()

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' })
    response.end()
    return
  }

  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${host}:${port}`).pathname)
    const file = await resolveRequest(pathname)
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes.get(extname(file).toLowerCase()) ?? 'application/octet-stream',
    }
    response.writeHead(200, headers)
    if (request.method === 'HEAD') response.end()
    else createReadStream(file).pipe(response)
  }
  catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : String(error))
  }
})

server.listen(port, host, () => {
  console.log(`Frozen Vue parity oracle: http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
