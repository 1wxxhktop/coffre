/**
 * Logo Coffre commun aux pages de l’extension.
 *
 * Le SVG est inline afin de suivre les variables CSS du thème actif
 * (`data-theme` ou préférence système) : cadenas blanc à contour noir en
 * thème clair, cadenas noir à contour blanc en thème sombre.
 */

const LOGO_SVG = `
<svg class="logo-mark" viewBox="99 85 314 367" aria-hidden="true" focusable="false">
  <path
    class="logo-mark__stroke"
    d="M170 246v-44c0-50 38-88 86-88s86 38 86 88v44"
    fill="none"
    stroke-width="34"
    stroke-linecap="round"
  />
  <rect
    class="logo-mark__fg"
    x="128"
    y="232"
    width="256"
    height="196"
    rx="56"
    stroke-width="24"
  />
  <circle class="logo-mark__key" cx="256" cy="310" r="23" />
  <path class="logo-mark__key" d="M256 330v42" stroke-width="22" stroke-linecap="round" />
</svg>`

export function mountLogos(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-coffre-logo]',
  )) {
    element.innerHTML = LOGO_SVG
  }
}
