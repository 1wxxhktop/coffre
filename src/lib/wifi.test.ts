import { describe, expect, it } from 'vitest'
import { wifiQrPayload } from './wifi'
import { parseItemContent } from './vault'

describe('QR code Wi-Fi', () => {
  it('encode un réseau WPA standard', () => {
    expect(
      wifiQrPayload({
        ssid: 'Maison',
        password: 'secret',
        security: 'WPA',
        hidden: false,
      }),
    ).toBe('WIFI:T:WPA;S:Maison;P:secret;H:false;;')
  })

  it('échappe les caractères réservés', () => {
    expect(
      wifiQrPayload({
        ssid: 'Maison;5G',
        password: 'p:a;s,s\\',
        security: 'WPA',
        hidden: true,
      }),
    ).toBe('WIFI:T:WPA;S:Maison\\;5G;P:p\\:a\\;s\\,s\\\\;H:true;;')
  })

  it('encode un réseau ouvert ou masqué', () => {
    expect(
      wifiQrPayload({
        ssid: 'Invités',
        password: '',
        security: 'nopass',
        hidden: true,
      }),
    ).toBe('WIFI:T:nopass;S:Invités;P:;H:true;;')
  })

  it('valide le contenu Wi-Fi déchiffré', () => {
    const content = parseItemContent({
      type: 'wifi',
      title: 'Maison',
      favorite: false,
      notes: '',
      tags: [],
      customFields: [],
      attachments: [],
      deletedAt: null,
      expiresAt: '',
      ssid: 'Maison',
      password: 'secret',
      security: 'WPA',
      hidden: false,
    })
    expect(content.type).toBe('wifi')
    if (content.type !== 'wifi') throw new Error('type Wi-Fi attendu')
    expect(content.ssid).toBe('Maison')
  })
})
