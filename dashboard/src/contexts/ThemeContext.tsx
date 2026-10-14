import { createContext, useContext, useEffect, type ReactNode } from 'react'

export type ThemeMode = 'dark'
export type ResolvedTheme = 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setThemeMode: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  resolvedTheme: 'dark',
  setThemeMode: () => {},
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('dark')
    root.classList.remove('light')
    root.dataset.theme = 'dark'
    document.body.classList.add('dark')
    document.body.classList.remove('light')

    localStorage.setItem('theme_mode', 'dark')
    localStorage.setItem('theme', 'dark')
  }, [])

  return (
    <ThemeContext.Provider
      value={{
        mode: 'dark',
        resolvedTheme: 'dark',
        setThemeMode: () => {},
        toggleTheme: () => {},
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components
export function useTheme() {
  return useContext(ThemeContext)
}
