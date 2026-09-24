/** Minimal `dsh web` fixture for the built Electron lifecycle smoke. */

import { createServer } from 'node:http'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback
}

const host = argument('--host', '127.0.0.1')
const port = Number.parseInt(argument('--port', '0'), 10)
// The published surface color (`meta[name="theme-color"]`) is what the shell's
// title-bar probe reads, and the lifecycle smoke measures the overlay sync
// against it — a fixture without it would leave the probe with no surface.
const page = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="theme-color" content="#ffffff">',
  '<title>DSH fixture</title>',
  '<style>html, body { margin: 0; height: 100%; background: #ffffff; }</style>',
  '</head>',
  '<body><div id="root"></div></body>',
  '</html>',
].join('\n')
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(page)
})

server.listen(port, host, () => {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('dsh fixture: expected an IP socket address')
  }
  // dsh 0.1.2-rc.1 prints an authenticated URL with a token and an optional
  // LAN note; the desktop shell must parse and adopt that exact URL, so the
  // fixture mirrors the new format.
  const tokenUrl = `http://${host}:${address.port}/?token=fixture`
  process.stdout.write(`dsh web: ${tokenUrl} (LAN: http://192.0.2.10:${address.port}/?token=fixture)\n`)
})
