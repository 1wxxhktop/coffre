/**
 * Icônes de services, entièrement locales.
 *
 * Aucune requête réseau n’est effectuée : les tracés viennent du paquet
 * `simple-icons` (CC0) et sont rendus dans la couleur du thème. Un domaine
 * inconnu reçoit un monogramme déterministe.
 */

import {
  siAirbnb,
  siAliexpress,
  siAmazon,
  siAmericanexpress,
  siApple,
  siAsana,
  siAuchan,
  siBinance,
  siBitwarden,
  siBoulanger,
  siCarrefour,
  siClickup,
  siCloudflare,
  siCoinbase,
  siDeliveroo,
  siDiscord,
  siDropbox,
  siEbay,
  siEpicgames,
  siEvernote,
  siFacebook,
  siFigma,
  siFnac,
  siGithub,
  siGitlab,
  siGmail,
  siGoogle,
  siInstagram,
  siLeroymerlin,
  siLinkedin,
  siMastercard,
  siMastodon,
  siNetflix,
  siNextcloud,
  siNotion,
  siObsidian,
  siOrange,
  siOvh,
  siPatreon,
  siPaypal,
  siPinterest,
  siProton,
  siReddit,
  siRevolut,
  siShopify,
  siSignal,
  siSlack,
  siSncf,
  siSoundcloud,
  siSpotify,
  siSteam,
  siStripe,
  siSynology,
  siTelegram,
  siTiktok,
  siTrello,
  siTwitch,
  siUber,
  siUbisoft,
  siVimeo,
  siVisa,
  siWhatsapp,
  siWise,
  siWordpress,
  siX,
  siYoutube,
  siZoom,
} from 'simple-icons'
import type { VaultItem } from './types'

interface IconData {
  title: string
  path: string
}

interface ServiceEntry {
  id: string
  label: string
  icon: IconData
  domains: string[]
  aliases?: string[]
}

/** Microsoft n’est pas distribué par Simple Icons : quatre carrés suffisent. */
const MICROSOFT: IconData = {
  title: 'Microsoft',
  path: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
}

function service(
  id: string,
  label: string,
  icon: IconData,
  domains: string[],
  aliases?: string[],
): ServiceEntry {
  return { id, label, icon, domains, aliases }
}

const SERVICES: ServiceEntry[] = [
  service('github', 'GitHub', siGithub, ['github.com', 'githubusercontent.com'], ['github']),
  service('gitlab', 'GitLab', siGitlab, ['gitlab.com'], ['gitlab']),
  service('google', 'Google', siGoogle, ['google.com', 'google.fr'], ['google']),
  service('gmail', 'Gmail', siGmail, ['gmail.com'], ['gmail']),
  service('microsoft', 'Microsoft', MICROSOFT, ['microsoft.com', 'office.com', 'live.com', 'outlook.com'], ['microsoft', 'outlook', 'office', 'hotmail']),
  service('apple', 'Apple', siApple, ['apple.com', 'icloud.com'], ['apple', 'icloud']),
  service('amazon', 'Amazon', siAmazon, ['amazon.com', 'amazon.fr', 'amazon.co.uk', 'amazon.de', 'amazon.es', 'amazon.it', 'aws.amazon.com'], ['amazon', 'aws']),
  service('facebook', 'Facebook', siFacebook, ['facebook.com', 'fb.com'], ['facebook']),
  service('instagram', 'Instagram', siInstagram, ['instagram.com'], ['instagram']),
  service('x', 'X', siX, ['x.com', 'twitter.com'], ['twitter', 'x']),
  service('linkedin', 'LinkedIn', siLinkedin, ['linkedin.com'], ['linkedin']),
  service('netflix', 'Netflix', siNetflix, ['netflix.com'], ['netflix']),
  service('spotify', 'Spotify', siSpotify, ['spotify.com'], ['spotify']),
  service('dropbox', 'Dropbox', siDropbox, ['dropbox.com'], ['dropbox']),
  service('slack', 'Slack', siSlack, ['slack.com'], ['slack']),
  service('discord', 'Discord', siDiscord, ['discord.com', 'discord.gg'], ['discord']),
  service('notion', 'Notion', siNotion, ['notion.so', 'notion.site'], ['notion']),
  service('figma', 'Figma', siFigma, ['figma.com'], ['figma']),
  service('proton', 'Proton', siProton, ['proton.me', 'protonmail.com', 'protonvpn.com'], ['proton', 'protonmail']),
  service('bitwarden', 'Bitwarden', siBitwarden, ['bitwarden.com'], ['bitwarden']),
  service('paypal', 'PayPal', siPaypal, ['paypal.com', 'paypal.fr'], ['paypal']),
  service('stripe', 'Stripe', siStripe, ['stripe.com'], ['stripe']),
  service('cloudflare', 'Cloudflare', siCloudflare, ['cloudflare.com'], ['cloudflare']),
  service('ovh', 'OVHcloud', siOvh, ['ovh.com', 'ovhcloud.com'], ['ovh']),
  service('orange', 'Orange', siOrange, ['orange.fr'], ['orange']),
  service('whatsapp', 'WhatsApp', siWhatsapp, ['whatsapp.com', 'wa.me'], ['whatsapp']),
  service('telegram', 'Telegram', siTelegram, ['telegram.org', 't.me'], ['telegram']),
  service('reddit', 'Reddit', siReddit, ['reddit.com'], ['reddit']),
  service('pinterest', 'Pinterest', siPinterest, ['pinterest.com', 'pinterest.fr'], ['pinterest']),
  service('tiktok', 'TikTok', siTiktok, ['tiktok.com'], ['tiktok']),
  service('twitch', 'Twitch', siTwitch, ['twitch.tv'], ['twitch']),
  service('youtube', 'YouTube', siYoutube, ['youtube.com', 'youtu.be'], ['youtube']),
  service('steam', 'Steam', siSteam, ['steampowered.com', 'steamcommunity.com'], ['steam']),
  service('epicgames', 'Epic Games', siEpicgames, ['epicgames.com'], ['epic games']),
  service('ubisoft', 'Ubisoft', siUbisoft, ['ubisoft.com'], ['ubisoft']),
  service('airbnb', 'Airbnb', siAirbnb, ['airbnb.com', 'airbnb.fr'], ['airbnb']),
  service('uber', 'Uber', siUber, ['uber.com'], ['uber']),
  service('deliveroo', 'Deliveroo', siDeliveroo, ['deliveroo.com', 'deliveroo.fr'], ['deliveroo']),
  service('sncf', 'SNCF Connect', siSncf, ['sncf.com', 'sncf-connect.com'], ['sncf']),
  service('fnac', 'Fnac', siFnac, ['fnac.com'], ['fnac']),
  service('carrefour', 'Carrefour', siCarrefour, ['carrefour.fr'], ['carrefour']),
  service('auchan', 'Auchan', siAuchan, ['auchan.fr'], ['auchan']),
  service('leroymerlin', 'Leroy Merlin', siLeroymerlin, ['leroymerlin.fr'], ['leroy merlin']),
  service('boulanger', 'Boulanger', siBoulanger, ['boulanger.com'], ['boulanger']),
  service('visa', 'Visa', siVisa, ['visa.com'], ['visa']),
  service('mastercard', 'Mastercard', siMastercard, ['mastercard.com'], ['mastercard']),
  service('amex', 'American Express', siAmericanexpress, ['americanexpress.com'], ['amex', 'american express']),
  service('mastodon', 'Mastodon', siMastodon, ['mastodon.social', 'joinmastodon.org'], ['mastodon']),
  service('signal', 'Signal', siSignal, ['signal.org'], ['signal']),
  service('zoom', 'Zoom', siZoom, ['zoom.us'], ['zoom']),
  service('trello', 'Trello', siTrello, ['trello.com'], ['trello']),
  service('asana', 'Asana', siAsana, ['asana.com'], ['asana']),
  service('clickup', 'ClickUp', siClickup, ['clickup.com'], ['clickup']),
  service('evernote', 'Evernote', siEvernote, ['evernote.com'], ['evernote']),
  service('obsidian', 'Obsidian', siObsidian, ['obsidian.md'], ['obsidian']),
  service('nextcloud', 'Nextcloud', siNextcloud, ['nextcloud.com'], ['nextcloud']),
  service('synology', 'Synology', siSynology, ['synology.com'], ['synology']),
  service('vimeo', 'Vimeo', siVimeo, ['vimeo.com'], ['vimeo']),
  service('soundcloud', 'SoundCloud', siSoundcloud, ['soundcloud.com'], ['soundcloud']),
  service('patreon', 'Patreon', siPatreon, ['patreon.com'], ['patreon']),
  service('wordpress', 'WordPress', siWordpress, ['wordpress.com', 'wordpress.org'], ['wordpress']),
  service('shopify', 'Shopify', siShopify, ['shopify.com'], ['shopify']),
  service('ebay', 'eBay', siEbay, ['ebay.com', 'ebay.fr'], ['ebay']),
  service('aliexpress', 'AliExpress', siAliexpress, ['aliexpress.com'], ['aliexpress']),
  service('wise', 'Wise', siWise, ['wise.com'], ['wise']),
  service('revolut', 'Revolut', siRevolut, ['revolut.com'], ['revolut']),
  service('coinbase', 'Coinbase', siCoinbase, ['coinbase.com'], ['coinbase']),
  service('binance', 'Binance', siBinance, ['binance.com'], ['binance']),
]

export interface ServiceVisual {
  id: string
  label: string
  path?: string
  monogram?: string
}

function normalizeHost(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function matchHost(host: string): ServiceEntry | null {
  return (
    SERVICES.find((entry) => entry.domains.some((domain) => hostMatches(host, domain))) ??
    null
  )
}

function matchTitle(title: string): ServiceEntry | null {
  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (normalized.length < 3) return null
  return (
    SERVICES.find((entry) =>
      (entry.aliases ?? [entry.label.toLowerCase()]).some((alias) => {
        if (normalized === alias) return true
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalized)
      }),
    ) ?? null
  )
}

function itemHost(item: VaultItem): string {
  if (item.type === 'login') {
    return item.urls.map(normalizeHost).find(Boolean) ?? ''
  }
  if (item.type === 'passkey') return normalizeHost(item.rpId)
  if (item.type === 'api-credential') return normalizeHost(item.endpoint)
  if (item.type === 'software-license') return normalizeHost(item.website)
  return ''
}

function monogramForHost(host: string): ServiceVisual {
  const parts = host.split('.').filter(Boolean)
  const label = parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? host
  return {
    id: `domain:${host}`,
    label: host,
    monogram: (label.charAt(0) || '?').toUpperCase(),
  }
}

function cardVisual(item: VaultItem): ServiceVisual | null {
  if (item.type !== 'card') return null
  const brand = item.brand.toLowerCase()
  const digits = item.number.replace(/\D/g, '')
  if (brand.includes('visa') || digits.startsWith('4')) {
    return { id: 'visa', label: 'Visa', path: siVisa.path }
  }
  if (
    brand.includes('master') ||
    /^5[1-5]/.test(digits) ||
    /^2[2-7]/.test(digits)
  ) {
    return { id: 'mastercard', label: 'Mastercard', path: siMastercard.path }
  }
  if (
    brand.includes('amex') ||
    brand.includes('american') ||
    /^3[47]/.test(digits)
  ) {
    return { id: 'amex', label: 'American Express', path: siAmericanexpress.path }
  }
  return null
}

/** Icône de service d’un élément, ou `null` s’il faut garder l’icône du type. */
export function serviceForItem(item: VaultItem): ServiceVisual | null {
  const card = cardVisual(item)
  if (card) return card

  const host = itemHost(item)
  if (host) {
    const entry = matchHost(host)
    if (entry) {
      return { id: entry.id, label: entry.label, path: entry.icon.path }
    }
    return monogramForHost(host)
  }

  if (item.type === 'login' || item.type === 'passkey' || item.type === 'api-credential') {
    const entry = matchTitle(item.title)
    if (entry) {
      return { id: entry.id, label: entry.label, path: entry.icon.path }
    }
  }
  return null
}
