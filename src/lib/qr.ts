/**
 * Génération de QR codes locale.
 *
 * Le rendu SVG est converti en data URL pour rester compatible avec les
 * composants qui affichent une simple balise `<img>`. Aucune donnée ne quitte
 * l’appareil.
 */

import { renderSVG } from 'uqr'

export function qrDataUrl(value: string): string {
  const svg = renderSVG(value, {
    ecc: 'M',
    border: 1,
    pixelSize: 8,
    whiteColor: '#ffffff',
    blackColor: '#000000',
  })
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
