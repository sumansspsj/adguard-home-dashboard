import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { getServers, switchServer, type AghServerConfig } from '../api'
import { useToast } from './ToastContext'

interface ServerCtx {
  servers: AghServerConfig[]
  activeServer: AghServerConfig | null
  serverVersion: number
  loading: boolean
  error: string | null
  isModalOpen: boolean
  editingServer: AghServerConfig | null
  openServerModal: (server?: AghServerConfig) => void
  closeServerModal: () => void
  refreshServers: () => Promise<void>
  switchActiveServer: (id: string) => Promise<boolean>
}

const ServerContext = createContext<ServerCtx | null>(null)

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<AghServerConfig[]>([])
  const [activeServer, setActiveServer] = useState<AghServerConfig | null>(null)
  const [serverVersion, setServerVersion] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [editingServer, setEditingServer] = useState<AghServerConfig | null>(null)

  const { toast } = useToast()

  const refreshServers = useCallback(async () => {
    try {
      const data = await getServers()
      if (data && data.servers) {
        setServers(data.servers)
        const active = data.servers.find(s => s.active) || data.activeServer || data.servers[0] || null
        setActiveServer(active)
      }
      setError(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch servers'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshServers()
  }, [refreshServers])

  const switchActiveServer = useCallback(async (id: string): Promise<boolean> => {
    const target = servers.find(s => s.id === id)
    if (!target) return false

    try {
      const res = await switchServer(id)
      if (res && res.ok) {
        const nextActive = res.activeServer || target
        setActiveServer({ ...nextActive, active: true })
        setServers(prev => prev.map(s => ({ ...s, active: s.id === id })))
        setServerVersion(v => v + 1)
        toast(`Active server switched to ${nextActive.name || target.name}`, { type: 'success' })
        window.dispatchEvent(new CustomEvent('agh:server-switched', { detail: { id } }))
        return true
      }
      return false
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to switch server'
      toast(message, { type: 'error' })
      return false
    }
  }, [servers, toast])

  const openServerModal = useCallback((server?: AghServerConfig) => {
    setEditingServer(server || null)
    setIsModalOpen(true)
  }, [])

  const closeServerModal = useCallback(() => {
    setEditingServer(null)
    setIsModalOpen(false)
  }, [])

  return (
    <ServerContext.Provider
      value={{
        servers,
        activeServer,
        serverVersion,
        loading,
        error,
        isModalOpen,
        editingServer,
        openServerModal,
        closeServerModal,
        refreshServers,
        switchActiveServer,
      }}
    >
      {children}
    </ServerContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components
export function useServer(): ServerCtx {
  const ctx = useContext(ServerContext)
  if (!ctx) throw new Error('useServer must be used inside ServerProvider')
  return ctx
}
