import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const input = resolve(process.argv[2] ?? '.artifacts/pptx-roundtrip')
if (!existsSync(input)) throw new Error(`PowerPoint reference directory does not exist: ${input}`)

const files = readdirSync(input, { withFileTypes: true })
  .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.pptx')
  .map(entry => join(input, entry.name))
  .sort()
if (!files.length) throw new Error(`No .pptx reference artifacts were found in ${input}`)

const soffice = [
  process.env.MONA_SOFFICE_PATH,
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
].find(candidate => (
  candidate
  && existsSync(candidate)
  && spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0
))
const quickLook = '/usr/bin/qlmanage'

for (const file of files) {
  execFileSync('/usr/bin/unzip', ['-tqq', file], { stdio: 'pipe' })
  process.stdout.write(`package-integrity ok: ${basename(file)}\n`)
}

const workspace = mkdtempSync(join(tmpdir(), 'mona-pptx-reference-'))
const output = join(workspace, 'output')
const profile = join(workspace, 'profile')
mkdirSync(output, { recursive: true })
mkdirSync(profile, { recursive: true })

try {
  if (soffice) {
    for (const file of files) {
      execFileSync(soffice, [
        '--headless',
        `-env:UserInstallation=file://${profile}`,
        '--convert-to',
        'pdf',
        '--outdir',
        output,
        file,
      ], { stdio: 'pipe' })
      const pdf = join(output, `${basename(file, extname(file))}.pdf`)
      if (!existsSync(pdf) || statSync(pdf).size === 0) {
        throw new Error(`LibreOffice did not produce a non-empty PDF for ${file}`)
      }
      process.stdout.write(`libreoffice-reference-open ok: ${basename(file)} -> ${statSync(pdf).size} bytes\n`)
    }
  }
  else if (existsSync(quickLook)) {
    for (const [index, file] of files.entries()) {
      const thumbnailOutput = join(output, String(index))
      mkdirSync(thumbnailOutput, { recursive: true })
      execFileSync(quickLook, [
        '-t',
        '-s',
        '1600',
        '-o',
        thumbnailOutput,
        file,
      ], { stdio: 'pipe' })
      const thumbnails = readdirSync(thumbnailOutput)
        .map(name => join(thumbnailOutput, name))
        .filter(candidate => statSync(candidate).isFile() && statSync(candidate).size > 0)
      if (!thumbnails.length) {
        throw new Error(`macOS Quick Look did not produce a non-empty thumbnail for ${file}`)
      }
      const renderedBytes = thumbnails.reduce((total, candidate) => total + statSync(candidate).size, 0)
      process.stdout.write(`quicklook-reference-open ok: ${basename(file)} -> ${renderedBytes} bytes\n`)
    }
  }
  else {
    const message = 'Reference-open skipped: neither LibreOffice nor macOS Quick Look is available; set MONA_SOFFICE_PATH when LibreOffice is installed.'
    if (process.env.MONA_REQUIRE_REFERENCE_ENGINE === '1') throw new Error(message)
    process.stdout.write(`${message}\n`)
  }
}
finally {
  rmSync(workspace, { force: true, recursive: true })
}
