import { spawn } from 'node:child_process'

const children = [
  spawn('npm', ['run', 'dev:agent'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit' }),
]

let stopping = false
const stop = signal => {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

for (const child of children) {
  child.once('error', error => {
    console.error(error)
    stop('SIGTERM')
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    stop('SIGTERM')
    process.exitCode = signal ? 1 : code ?? 1
  })
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
