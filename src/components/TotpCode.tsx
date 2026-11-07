import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, ShieldQuestion } from 'lucide-react'
import {
  formatTotp,
  generateTotp,
  parseTotpUri,
  totpAccountLabel,
  totpRemaining,
} from '../lib/totp'
import { copySensitive } from '../lib/clipboard'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'

interface TotpCodeProps {
  uri: string
  compact?: boolean
}

export function TotpCode({ uri, compact = false }: TotpCodeProps) {
  const { settings } = useSettings()
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [remaining, setRemaining] = useState(30)
  const [copied, setCopied] = useState(false)

  const parsed = useMemo(() => {
    try {
      return { config: parseTotpUri(uri), error: null as string | null }
    } catch (error) {
      return {
        config: null,
        error: error instanceof Error ? error.message : 'URI TOTP invalide',
      }
    }
  }, [uri])

  useEffect(() => {
    if (!parsed.config) return
    let cancelled = false
    const config = parsed.config

    const tick = async () => {
      const now = Date.now()
      try {
        const next = await generateTotp(config, now)
        if (!cancelled) {
          setCode(next)
          setRemaining(totpRemaining(config.period, now))
        }
      } catch {
        if (!cancelled) setCode('')
      }
    }

    void tick()
    const interval = setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [parsed.config])

  if (!uri.trim()) return null

  if (parsed.error || !parsed.config) {
    return (
      <div className="totp totp--error">
        <ShieldQuestion size={18} />
        <span>{parsed.error}</span>
      </div>
    )
  }

  const progress = Math.max(0, Math.min(1, remaining / parsed.config.period))
  const ringStyle = {
    background: `conic-gradient(var(--accent) ${progress * 360}deg, rgba(255,255,255,.1) 0deg)`,
  }

  const copyCode = async () => {
    const success = await copySensitive(
      code,
      settings.clipboardClearSeconds,
      () => toast('Presse-papiers effacé', 'info'),
    )
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast('Code TOTP copié', 'success')
    } else {
      toast('Impossible de copier le code', 'error')
    }
  }

  return (
    <div className={`totp ${compact ? 'totp--compact' : ''}`}>
      <span className="totp__ring" style={ringStyle} aria-hidden="true">
        <span>{remaining}</span>
      </span>
      <div className="totp__body">
        {!compact && <span className="totp__label">{totpAccountLabel(parsed.config)}</span>}
        <strong className="totp__code" aria-live="polite">
          {formatTotp(code)}
        </strong>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={() => void copyCode()}
        aria-label="Copier le code TOTP"
      >
        {copied ? <Check size={17} /> : <Copy size={17} />}
      </button>
    </div>
  )
}
