/**
 * Estimation de robustesse d’un mot de passe, sans dépendance externe.
 *
 * L’estimation se place du point de vue d’un attaquant qui essaie d’abord les
 * motifs humains : mots du dictionnaire (français, anglais, liste EFF), mots
 * de passe courants, rangées de clavier (AZERTY et QWERTY), suites (« 1234 »,
 * « abcd »), répétitions, années et substitutions « leet » (@ pour a, 0 pour
 * o…). Le mot de passe est découpé en segments ; chaque segment coûte le
 * nombre de bits qu’il faut pour le deviner, et l’on retient le découpage le
 * moins coûteux, à la manière de zxcvbn.
 *
 * Le résultat est un nombre de bits d’entropie, comparable à l’ancienne
 * estimation par taille d’alphabet mais beaucoup moins naïf : « Marseille2024 »
 * ou « P@ssw0rd2024! » tombent sous 30 bits au lieu de 77 à 85.
 */

import { EFF_WORDS } from './generator'

/** Mots et mots de passe très courants : les premiers essayés par un attaquant. */
const COMMON = `
password passw0rd motdepasse passe secret admin administrateur root user utilisateur
login welcome bienvenue letmein iloveyou jetaime jtm amour monamour loveyou love
azerty azertyuiop qwerty qwertyuiop qwertz abc abcd abcdef abcdefgh test test123
dragon monkey master shadow sunshine princess princesse football baseball soccer
superman batman starwars pokemon minecraft fortnite naruto hello bonjour bonsoir
salut coucou merci soleil lune etoile chocolat fromage baguette vacances
france paris marseille lyon toulouse nice nantes strasbourg montpellier bordeaux
lille rennes reims toulon grenoble dijon angers brest limoges tours amiens metz
nancy caen orleans rouen perpignan avignon ajaccio bastia bretagne normandie
psg olympique om ol asse foot rugby tennis
marie jean pierre michel philippe nicolas julien thomas antoine alexandre
camille julie sophie nathalie isabelle sylvie catherine christine nadia sarah
laura manon emma lea chloe ines jade louise alice lucas hugo louis gabriel
arthur jules adam leo raphael paul maxime kevin david anthony romain mathieu
mohamed ahmed fatima yasmine sami karim
chat chien loulou doudou bebe cheri cherie maman papa famille enfant
coffre bitwarden proton google facebook apple microsoft windows linux
summer winter spring autumn hiver ete printemps automne
lundi mardi mercredi jeudi vendredi samedi dimanche
janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre
january february march april may june july august september october november december
monday tuesday wednesday thursday friday saturday sunday
`
  .split(/\s+/)
  .filter(Boolean)

const COMMON_SET = new Set(COMMON)
const EFF_SET = new Set(EFF_WORDS)

/** Rangées de clavier lues dans les deux sens par l’attaquant. */
const KEYBOARD_ROWS = [
  '1234567890',
  'azertyuiop',
  'qsdfghjklm',
  'wxcvbn',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  'qwertzuiop',
  'yxcvbnm',
  'azerty',
  '&é"\'(-è_çà',
]

const LEET: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '8': 'b',
  '(': 'c',
  '3': 'e',
  '€': 'e',
  '6': 'g',
  '1': 'i',
  '!': 'i',
  '|': 'l',
  '0': 'o',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
  '2': 'z',
}

const MAX_WORD = 24

function charBits(char: string): number {
  if (/[a-z]/.test(char)) return Math.log2(26)
  if (/[A-Z]/.test(char)) return Math.log2(26) + 1
  if (/[0-9]/.test(char)) return Math.log2(10)
  if (char === ' ') return Math.log2(33)
  if (/[\x21-\x7e]/.test(char)) return Math.log2(33)
  // Caractère hors ASCII : alphabet beaucoup plus large.
  return Math.log2(100)
}

/** Coût d’un mot de dictionnaire, majuscules et substitutions comprises. */
function wordBits(original: string, normalized: string): number | null {
  let base: number | null = null
  if (COMMON_SET.has(normalized)) base = Math.log2(COMMON.length)
  else if (normalized.length >= 4 && EFF_SET.has(normalized)) base = Math.log2(EFF_WORDS.length)
  if (base === null) return null

  let extra = 0
  const letters = original.replace(/[^A-Za-z]/g, '')
  if (letters && letters !== letters.toLowerCase()) {
    // Première lettre en majuscule ou tout en majuscules : 1 bit ; casse
    // mélangée : un bit par lettre majuscule, plafonné.
    const upper = (letters.match(/[A-Z]/g) ?? []).length
    const simple = letters === letters.toUpperCase() || /^[A-Z][^A-Z]*$/.test(letters)
    extra += simple ? 1 : Math.min(upper, 4)
  }
  const substituted = Array.from(original).filter((char) => LEET[char]).length
  if (substituted > 0) extra += Math.min(substituted, 3)
  return base + extra
}

function deleet(value: string): string {
  return Array.from(value.toLowerCase())
    .map((char) => LEET[char] ?? char)
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Suite régulière (abcd, 1357, 9876) : quelques bits seulement. */
function sequenceBits(value: string): number | null {
  if (value.length < 3) return null
  const codes = Array.from(value.toLowerCase()).map((char) => char.codePointAt(0) ?? 0)
  const step = codes[1] - codes[0]
  if (step === 0 || Math.abs(step) > 2) return null
  for (let index = 2; index < codes.length; index++) {
    if (codes[index] - codes[index - 1] !== step) return null
  }
  return Math.log2(36) + Math.log2(value.length) + 1
}

/** Portion d’une rangée de clavier, à l’endroit ou à l’envers. */
function keyboardBits(value: string): number | null {
  if (value.length < 3) return null
  const lower = value.toLowerCase()
  const reversed = Array.from(lower).reverse().join('')
  for (const row of KEYBOARD_ROWS) {
    if (row.includes(lower) || row.includes(reversed)) {
      const casing = lower === value ? 0 : 1
      return Math.log2(KEYBOARD_ROWS.length * row.length * 2) + Math.log2(value.length) + casing
    }
  }
  return null
}

/** Même caractère ou même motif court répété. */
function repeatBits(value: string): number | null {
  if (value.length < 3) return null
  const match = /^(.{1,4}?)\1+$/.exec(value)
  if (!match) return null
  const unit = match[1]
  const unitBits = Array.from(unit).reduce((total, char) => total + charBits(char), 0)
  return unitBits + Math.log2(value.length / unit.length + 1)
}

/** Année plausible (1900-2039) ou date courte. */
function dateBits(value: string): number | null {
  if (/^(19|20)\d\d$/.test(value)) {
    const year = Number(value)
    return year >= 1900 && year <= 2039 ? Math.log2(140) : null
  }
  if (/^\d\d$/.test(value)) return Math.log2(100)
  // JJMMAAAA, JJMMAA
  if (/^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])((19|20)\d\d|\d\d)$/.test(value)) {
    return Math.log2(366 * 140)
  }
  return null
}

function segmentBits(original: string): number | null {
  const candidates = [
    wordBits(original, deleet(original)),
    sequenceBits(original),
    keyboardBits(original),
    repeatBits(original),
    dateBits(original),
  ].filter((value): value is number => value !== null)
  return candidates.length > 0 ? Math.min(...candidates) : null
}

/**
 * Nombre de bits estimés pour deviner `password` : découpage de coût minimal
 * entre motifs connus et caractères aléatoires.
 */
export function estimatePasswordBits(password: string): number {
  const chars = Array.from(password)
  const length = chars.length
  if (length === 0) return 0

  // best[i] : coût minimal du préfixe de longueur i ; count[i] : segments.
  const best = new Array<number>(length + 1).fill(Number.POSITIVE_INFINITY)
  const count = new Array<number>(length + 1).fill(0)
  best[0] = 0

  for (let end = 1; end <= length; end++) {
    // Caractère isolé, deviné « au hasard ».
    const single = best[end - 1] + charBits(chars[end - 1])
    if (single < best[end]) {
      best[end] = single
      count[end] = count[end - 1] + 1
    }
    for (let start = Math.max(0, end - MAX_WORD); start <= end - 2; start++) {
      if (!Number.isFinite(best[start])) continue
      const bits = segmentBits(chars.slice(start, end).join(''))
      if (bits === null) continue
      const total = best[start] + bits
      if (total < best[end]) {
        best[end] = total
        count[end] = count[start] + 1
      }
    }
  }

  // L’attaquant doit aussi deviner la structure : quelques bits par segment.
  const structure = Math.log2(count[length] + 1)
  return Math.max(0, Math.round(best[length] + structure))
}

/**
 * Estimation d’entropie utilisée par l’indicateur de robustesse et par le
 * contrôle du mot de passe maître. Elle tient compte des mots du dictionnaire,
 * des rangées de clavier, des suites, des années et des substitutions : voir
 * `strength.ts`.
 */
export function estimateEntropy(password: string): number {
  return estimatePasswordBits(password)
}

export function passwordStrength(entropy: number): {
  score: 0 | 1 | 2 | 3 | 4
  label: string
} {
  if (entropy < 30) return { score: 0, label: 'Très faible' }
  if (entropy < 50) return { score: 1, label: 'Faible' }
  if (entropy < 70) return { score: 2, label: 'Moyen' }
  if (entropy < 100) return { score: 3, label: 'Solide' }
  return { score: 4, label: 'Excellent' }
}
