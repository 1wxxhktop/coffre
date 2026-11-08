import type { WifiSecurity } from './types'

export interface WifiQrInput {
  ssid: string
  password: string
  security: WifiSecurity
  hidden: boolean
}

/** Échappe les caractères réservés du format QR Wi-Fi. */
function escape(value: string): string {
  return value.replace(/([\\;,":])/g, '\\$1')
}

/** Construit la charge `WIFI:` lue par les appareils photo et téléphones. */
export function wifiQrPayload({ ssid, password, security, hidden }: WifiQrInput): string {
  return `WIFI:T:${security};S:${escape(ssid)};P:${escape(password)};H:${hidden ? 'true' : 'false'};;`
}
