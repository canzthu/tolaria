import { useEffect, useState } from 'react'

/** Phone widths: one pane at a time (TOL-193). iPad portrait (834 px) keeps the panes. */
export const PHONE_LAYOUT_QUERY = '(max-width: 640px)'

function phoneMedia(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(PHONE_LAYOUT_QUERY)
}

/** Whether the viewport is phone-width; always false when disabled (desktop, note windows). */
export function usePhoneLayout(enabled: boolean): boolean {
  const [matches, setMatches] = useState(() => phoneMedia()?.matches ?? false)

  useEffect(() => {
    const media = phoneMedia()
    if (!enabled || !media) return
    const update = () => { setMatches(media.matches) }
    update()
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update) }
  }, [enabled])

  return enabled && matches
}
