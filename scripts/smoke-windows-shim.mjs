/** Exercise the built Electron app through a Windows npm-style command shim. */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  throw new Error('dsh-desktop: the Windows command-shim smoke requires Windows')
}

const require_ = createRequire(import.meta.url)
const electronPath = require_('electron')
const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const fixture = join(packageDir, 'tests', 'fixtures', 'dsh-web-fixture.mjs')

/** Await one promise with a bounded failure message. */
async function withTimeout(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(typeof message === 'function' ? message() : message))
        }, milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Whether an operating-system process still owns the supplied PID. */
function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

/** Wait briefly for taskkill and process teardown to release a PID. */
async function waitForProcessExit(pid) {
  const deadline = Date.now() + 5_000
  while (processExists(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`dsh-desktop: server pid ${pid} survived Electron exit`)
    }
    await new Promise(resolve => { setTimeout(resolve, 100) })
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-electron-'))
const shimDirectory = join(temporaryRoot, 'npm command shim with spaces')
const shim = join(shimDirectory, 'dsh.cmd')
const dshBin = process.env.DSH_DESKTOP_SMOKE_BIN ?? shim
const quitFile = join(temporaryRoot, 'quit.signal')
let electron
let stdout = ''
let stderr = ''

try {
  await mkdir(shimDirectory)
  await writeFile(shim, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, 'utf8')

  const env = {
    ...process.env,
    DSH_BIN: dshBin,
    DSH_DESKTOP_TEST: '1',
    DSH_DESKTOP_TEST_QUIT_FILE: quitFile,
    DSH_PERMISSION_MODE: 'danger-full-access',
  }
  delete env.ELECTRON_RUN_AS_NODE

  electron = spawn(electronPath, ['.'], {
    cwd: packageDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  electron.stdout.setEncoding('utf8')
  electron.stderr.setEncoding('utf8')

  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  electron.stdout.on('data', (chunk) => {
    stdout += chunk
    const match = stdout.match(/^DSH_DESKTOP_READY (\d+)$/m)
    if (match?.[1] !== undefined) resolveReady(Number.parseInt(match[1], 10))
  })
  electron.stderr.on('data', (chunk) => { stderr += chunk })
  electron.once('error', rejectReady)

  const exited = new Promise((resolve, reject) => {
    electron.once('error', reject)
    electron.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
  void exited.then(({ code, signal }) => {
    rejectReady(new Error(`dsh-desktop: Electron exited before readiness (code ${String(code)}, signal ${String(signal)})`))
  })

  const serverPid = await withTimeout(
    ready,
    60_000,
    () => `dsh-desktop: Electron did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`,
  )
  await writeFile(quitFile, 'quit', 'utf8')
  const result = await withTimeout(
    exited,
    30_000,
    () => `dsh-desktop: Electron did not exit after the quit request\nstdout:\n${stdout}\nstderr:\n${stderr}`,
  )
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(`dsh-desktop: Electron exited with code ${String(result.code)}, signal ${String(result.signal)}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  }
  await waitForProcessExit(serverPid)
  process.stdout.write(`verified Windows npm command shim lifecycle (server pid ${serverPid})\n`)
} finally {
  if (electron?.exitCode === null && electron.signalCode === null) {
    spawnSync('taskkill.exe', ['/pid', String(electron.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}
