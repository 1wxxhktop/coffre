/** Formulaire et page WebAuthn minimaux pour le test manuel/CI de l’extension. */
import { createServer } from 'node:http'

const form = `<!doctype html><html lang="fr"><body>
    <form>
      <input id="username" name="username" autocomplete="username" />
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Connexion</button>
    </form>
  </body></html>`

const register = `<!doctype html><html lang="fr"><body>
    <h1>Créer un compte de test</h1>
    <form action="/welcome" method="post">
      <input id="email" name="email" autocomplete="username" />
      <input id="new-password" name="password" type="password" autocomplete="new-password" />
      <button type="submit">Créer mon compte</button>
    </form>
  </body></html>`

const welcome = `<!doctype html><html lang="fr"><body>
    <h1>Bienvenue</h1>
    <p>Compte créé sur le site de test.</p>
  </body></html>`

const passkey = `<!doctype html><html lang="fr"><body>
    <h1>Passkey Coffre</h1>
    <button id="passkey-create" type="button">Créer une passkey</button>
    <button id="passkey-get" type="button">Se connecter</button>
    <pre id="passkey-result"></pre>
    <script>
      const result = document.querySelector('#passkey-result')
      const encode = (value) => {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
      }
      const decode = (value) => {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/')
        const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        return bytes
      }
      let credentialId = null
      const challenge = () => crypto.getRandomValues(new Uint8Array(32))
      const sameBytes = (left, right) => {
        if (left.length !== right.length) return false
        for (let index = 0; index < left.length; index += 1) {
          if (left[index] !== right[index]) return false
        }
        return true
      }
      const clientInfo = async (credential, challengeText, type) => {
        const client = JSON.parse(
          new TextDecoder().decode(credential.response.clientDataJSON),
        )
        const expectedRp = new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(location.hostname),
          ),
        )
        const authData = credential.response.authenticatorData
          ? new Uint8Array(credential.response.authenticatorData)
          : new Uint8Array(credential.response.getAuthenticatorData())
        return {
          typeOk: client.type === type,
          challengeOk: client.challenge === challengeText,
          originOk: client.origin === location.origin,
          rpOk:
            authData.length >= 32 &&
            sameBytes(authData.slice(0, 32), expectedRp),
        }
      }
      const fail = (error) => {
        result.dataset.kind = 'error'
        result.textContent = error.name + ': ' + error.message
      }
      document.querySelector('#passkey-create').addEventListener('click', async () => {
        try {
          const requestChallenge = challenge()
          const challengeText = encode(requestChallenge)
          const credential = await navigator.credentials.create({
            publicKey: {
              challenge: requestChallenge,
              rp: { id: location.hostname, name: 'Coffre smoke' },
              user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: 'ada-' + Date.now() + '@example.com',
                displayName: 'Ada',
              },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              authenticatorSelection: { userVerification: 'preferred' },
              attestation: 'none',
              timeout: 60000,
            },
          })
          credentialId = encode(credential.rawId)
          result.dataset.kind = 'create'
          result.textContent = JSON.stringify({
            kind: 'create',
            id: credential.id,
            attachment: credential.authenticatorAttachment,
            attestation: encode(credential.response.attestationObject).length > 0,
            publicKey: Boolean(credential.response.getPublicKey()),
            publicKeyCose: encode(credential.response.getPublicKey()),
            authData: encode(credential.response.getAuthenticatorData()),
            clientDataJSON: encode(credential.response.clientDataJSON),
            attestationObject: encode(credential.response.attestationObject),
            client: await clientInfo(
              credential,
              challengeText,
              'webauthn.create',
            ),
          })
        } catch (error) {
          fail(error)
        }
      })
      document.querySelector('#passkey-get').addEventListener('click', async () => {
        try {
          const requestChallenge = challenge()
          const challengeText = encode(requestChallenge)
          const credential = await navigator.credentials.get({
            publicKey: {
              challenge: requestChallenge,
              rpId: location.hostname,
              allowCredentials: credentialId
                ? [{ type: 'public-key', id: decode(credentialId) }]
                : [],
              userVerification: 'preferred',
              timeout: 60000,
            },
          })
          result.dataset.kind = 'get'
          result.textContent = JSON.stringify({
            kind: 'get',
            id: credential.id,
            attachment: credential.authenticatorAttachment,
            signature: credential.response.signature.byteLength > 0,
            signatureData: encode(credential.response.signature),
            authData: encode(credential.response.authenticatorData),
            clientDataJSON: encode(credential.response.clientDataJSON),
            userHandle: credential.response.userHandle
              ? encode(credential.response.userHandle)
              : null,
            client: await clientInfo(credential, challengeText, 'webauthn.get'),
          })
        } catch (error) {
          fail(error)
        }
      })
    </script>
  </body></html>`

createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  const url = request.url ?? '/'
  if (url.startsWith('/passkey')) response.end(passkey)
  else if (url.startsWith('/register')) response.end(register)
  else if (url.startsWith('/welcome')) response.end(welcome)
  else response.end(form)
}).listen(8099, '127.0.0.1', () => {
  console.log('Formulaire et passkey de test : http://127.0.0.1:8099/')
})
