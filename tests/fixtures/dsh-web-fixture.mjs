/** Minimal `dsh web` fixture for the built Electron lifecycle smoke. */

import { createServer } from 'node:http'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback
}

const host = argument('--host', '127.0.0.1')
const port = Number.parseInt(argument('--port', '0'), 10)
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>DSH fixture</title>')
})

server.listen(port, host, () => {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('dsh fixture: expected an IP socket address')
  }
  process.stdout.write(`dsh web: http://${host}:${address.port}\n`)
})
