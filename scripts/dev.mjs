import { spawn } from 'node:child_process'

/**
 * Development runs two processes: Vite for the renderer, and Electron for the shell
 * that hosts the agent. It used to run a standalone agent server as the second one;
 * that server no longer exists, because the shell *is* the host.
 *
 * Vite starts first and Electron waits for it, since the window loads its URL.
 */
const run = (name, args) => {
  const child = spawn('npm', ['run', name, ...args], { shell: false, stdio: 'inherit' })
  child.on('exit', code => process.exit(code ?? 0))
  return child
}

const web = run('dev:web', [])
const shell = setTimeout(() => run('dev:desktop', []), 2500)

const stop = () => {
  clearTimeout(shell)
  web.kill('SIGTERM')
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
