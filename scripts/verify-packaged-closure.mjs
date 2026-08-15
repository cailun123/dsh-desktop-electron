import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { listPackage } from '@electron/asar'

const releaseDir = join(import.meta.dirname, '..', 'release')
const entries = await readdir(releaseDir, { recursive: true, withFileTypes: true })
const archives = entries
  .filter(entry => entry.isFile() && entry.name === 'app.asar')
  .map(entry => join(entry.parentPath, entry.name))

if (archives.length !== 1) {
  throw new Error(`expected exactly one unpacked app.asar under ${releaseDir}, found ${archives.length}`)
}

const archive = archives[0]
const packaged = new Set(listPackage(archive).map(path => path.replaceAll('\\', '/')))
const required = [
  '/lib/main.js',
  '/lib/launcher.js',
  '/node_modules/cross-spawn/package.json',
  '/node_modules/isexe/package.json',
  '/node_modules/path-key/package.json',
  '/node_modules/shebang-command/package.json',
  '/node_modules/shebang-regex/package.json',
  '/node_modules/which/package.json',
]
const missing = required.filter(path => !packaged.has(path))
if (missing.length !== 0) {
  throw new Error(`packaged app is missing production closure entries: ${missing.join(', ')}`)
}

process.stdout.write(`verified packaged spawn closure in ${relative(process.cwd(), archive).split(sep).join('/')}\n`)
