import { useCallback, useEffect, useState } from 'react'

const SIDEBAR_WIDTH_KEY = 'coffre:ui:sidebar-width'
const LIST_WIDTH_KEY = 'coffre:ui:list-width'
const SIDEBAR_COLLAPSED_KEY = 'coffre:ui:sidebar-collapsed'

export const LAYOUT_LIMITS = {
  sidebarDefault: 272,
  sidebarMin: 220,
  sidebarMax: 420,
  listDefault: 380,
  listMin: 320,
  listMax: 640,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? clamp(value, min, max) : fallback
  } catch {
    return fallback
  }
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Le stockage local peut être indisponible : les préférences restent en mémoire.
  }
}

/** Largeurs de colonnes et état replié de la barre latérale, persistés localement. */
export function useLayoutPreferences() {
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    readNumber(
      SIDEBAR_WIDTH_KEY,
      LAYOUT_LIMITS.sidebarDefault,
      LAYOUT_LIMITS.sidebarMin,
      LAYOUT_LIMITS.sidebarMax,
    ),
  )
  const [listWidth, setListWidthState] = useState(() =>
    readNumber(
      LIST_WIDTH_KEY,
      LAYOUT_LIMITS.listDefault,
      LAYOUT_LIMITS.listMin,
      LAYOUT_LIMITS.listMax,
    ),
  )
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() =>
    readBoolean(SIDEBAR_COLLAPSED_KEY, false),
  )

  const setSidebarWidth = useCallback((value: number) => {
    setSidebarWidthState(
      clamp(value, LAYOUT_LIMITS.sidebarMin, LAYOUT_LIMITS.sidebarMax),
    )
  }, [])

  const setListWidth = useCallback((value: number) => {
    setListWidthState(clamp(value, LAYOUT_LIMITS.listMin, LAYOUT_LIMITS.listMax))
  }, [])

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidthState(LAYOUT_LIMITS.sidebarDefault)
  }, [])

  const resetListWidth = useCallback(() => {
    setListWidthState(LAYOUT_LIMITS.listDefault)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((value) => !value)
  }, [])

  useEffect(() => {
    write(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    write(LIST_WIDTH_KEY, String(listWidth))
  }, [listWidth])

  useEffect(() => {
    write(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  return {
    sidebarWidth,
    listWidth,
    sidebarCollapsed,
    setSidebarWidth,
    setListWidth,
    resetSidebarWidth,
    resetListWidth,
    toggleSidebar,
  }
}
