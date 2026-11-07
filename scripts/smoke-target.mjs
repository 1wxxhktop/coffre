/** Formulaire minimal pour le test manuel/CI de l’extension. */
import { createServer } from 'node:http'

createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html><html lang="fr"><body>
    <form>
      <input id="username" name="username" autocomplete="username" />
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Connexion</button>
    </form>
  </body></html>`)
}).listen(8099, '127.0.0.1', () => {
  console.log('Formulaire de test : http://127.0.0.1:8099/')
})
