import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((item) => item.id !== id))
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++counter.current
      setToasts((previous) => [...previous.slice(-3), { id, message, tone }])
      const timer = setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 4000)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`} role="status">
            {item.tone === 'success' ? (
              <CheckCircle2 size={18} />
            ) : item.tone === 'error' ? (
              <CircleAlert size={18} />
            ) : (
              <Info size={18} />
            )}
            <span>{item.message}</span>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismiss(item.id)}
              aria-label="Fermer la notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast doit être utilisé dans ToastProvider')
  return context
}
