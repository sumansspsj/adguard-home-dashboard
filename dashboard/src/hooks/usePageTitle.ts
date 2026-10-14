import { useEffect } from 'react'

/**
 * Sets the document <title> while the component is mounted,
 * restoring the base title on unmount.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = document.title
    document.title = title ? `${title} — AdGuard Dashboard` : 'AdGuard Dashboard'
    return () => { document.title = prev }
  }, [title])
}
