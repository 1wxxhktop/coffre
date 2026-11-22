// Vérifie que l’icône Android est bien celle de Coffre et non celle générée
// par Tauri. `tauri android init` peut réécrire les mipmaps ; ce contrôle
// empêche une régression visuelle silencieuse.
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const root = 'src-tauri/gen/android/app/src/main/res'
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
const iconPath = join(root, 'mipmap-xxxhdpi', 'ic_launcher.png')

for (const density of densities) {
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    await access(join(root, `mipmap-${density}`, name)).catch(() => {
      throw new Error(`Icône Android manquante : mipmap-${density}/${name}`)
    })
  }
}

const { data, info } = await sharp(iconPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

let orange = 0
let blue = 0
for (let index = 0; index < data.length; index += info.channels) {
  const r = data[index]
  const g = data[index + 1]
  const b = data[index + 2]
  if (r > 200 && g > 140 && b < 120 && g > b * 1.3) orange += 1
  if (b > 180 && g > 140 && r < 120 && g > r * 1.3) blue += 1
}
if (orange > 10 || blue > 10) {
  throw new Error(
    `Icône Android encore celle de Tauri (orange=${orange}, bleu=${blue}). Régénérez-la depuis src-tauri/icons/icon.png.`,
  )
}

for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const xml = await readFile(join(root, 'mipmap-anydpi-v26', name), 'utf8')
  if (!xml.includes('@mipmap/ic_launcher_foreground')) {
    throw new Error(`Icône adaptative Android incomplète : ${name}`)
  }
}

console.log(`Icônes Android : cadenas Coffre, ${densities.length} densités.`)
