#!/usr/bin/env node
/**
 * Smoke test du relais « hôte de messagerie native ».
 *
 * Lancé avec un argument d’origine d’extension, le binaire Coffre doit relayer
 * les trames préfixées par leur longueur entre stdin/stdout et un socket local.
 * Ce test simule l’application avec un socket éphémère et vérifie l’aller-retour.
 *
 * Prérequis : `cargo build --manifest-path src-tauri/Cargo.toml --bin coffre`
 * ou variable COFFRE_BRIDGE_BINARY pointant vers le binaire.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { endianness, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'win32') {
  console.log('Smoke du pont natif ignoré sur Windows (socket Unix uniquement).')
  process.exit(0)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const binary =
  process.env.COFFRE_BRIDGE_BINARY ?? join(root, 'src-tauri/target/debug/coffre')
const directory = await mkdtemp(join(tmpdir(), 'coffre-bridge-smoke-'))
const socketPath = join(directory, 'bridge.sock')

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(4)
  if (endianness() === 'LE') header.writeUInt32LE(payload.length, 0)
  else header.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, payload])
}

function readLength(buffer) {
  return endianness() === 'LE' ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0)
}

function withTimeout(promise, milliseconds, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`délai dépassé : ${label}`)),
        milliseconds,
      ),
    ),
  ])
}

let server
let child
try {
  const received = new Promise((resolve, reject) => {
    server = createServer((socket) => {
      let buffer = Buffer.alloc(0)
      socket.on('error', reject)
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        while (buffer.length >= 4) {
          const length = readLength(buffer)
          if (buffer.length < 4 + length) return
          const payload = buffer.subarray(4, 4 + length)
          buffer = buffer.subarray(4 + length)
          try {
            const message = JSON.parse(payload.toString('utf8'))
            socket.write(frame({ ...message, relayed: true }))
          } catch (error) {
            reject(error)
          }
        }
      })
    })
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  await withTimeout(received, 5000, 'écoute du socket')

  let stdout = Buffer.alloc(0)
  let stderr = ''
  const response = new Promise((resolve, reject) => {
    child = spawn(binary, ['chrome-extension://coffre-smoke/'], {
      env: { ...process.env, COFFRE_BRIDGE_SOCKET: socketPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.once('error', reject)
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`binaire arrêté (${code}) : ${stderr.trim()}`))
      }
    })
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk])
      if (stdout.length < 4) return
      const length = readLength(stdout)
      if (stdout.length < 4 + length) return
      try {
        resolve(JSON.parse(stdout.subarray(4, 4 + length).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
  })

  child.stdin.write(frame({ id: 'smoke-1', type: 'hello', value: 42 }))
  const message = await withTimeout(response, 5000, 'réponse du relais')
  assert.equal(message.id, 'smoke-1')
  assert.equal(message.type, 'hello')
  assert.equal(message.value, 42)
  assert.equal(message.relayed, true)

  // Une lecture d’état sans socket ne doit pas lancer l’application : seul un
  // hello explicite avec `launch: true` emprunte le chemin de démarrage.
  let ordinaryStderr = ''
  const ordinary = spawn(binary, ['chrome-extension://coffre-smoke/'], {
    env: {
      ...process.env,
      COFFRE_BRIDGE_SOCKET: join(directory, 'absent.sock'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  ordinary.stderr.on('data', (chunk) => {
    ordinaryStderr += chunk.toString('utf8')
  })
  ordinary.stdin.write(frame({ id: 'smoke-2', type: 'hello' }))
  await withTimeout(
    new Promise((resolve) => ordinary.once('exit', resolve)),
    5000,
    'arrêt sans lancement',
  )
  assert.match(
    ordinaryStderr,
    /n’est pas ouvert/,
    'un hello ordinaire ne doit pas démarrer Coffre',
  )
  console.log('Pont natif : relais vérifié, lancement réservé au clic explicite.')
} finally {
  child?.kill()
  server?.close()
  await rm(directory, { recursive: true, force: true })
}
