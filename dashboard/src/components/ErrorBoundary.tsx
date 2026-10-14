import { Component, type ReactNode } from 'react'
import { WifiOff, RefreshCw } from 'lucide-react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: string }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, error: err.message }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-8 bg-[var(--bg-base)]">
          <div className="p-4 rounded-full bg-[var(--bg-active)] border border-[var(--border-strong)]">
            <WifiOff className="w-8 h-8 text-[var(--text-primary)]" />
          </div>
          <div>
            <div className="text-[var(--text-primary)] font-semibold mb-1">Something went wrong</div>
            <div className="text-sm text-[var(--text-tertiary)] max-w-sm">{this.state.error}</div>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: '' })}
            className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--btn-primary-text)] bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover-bg)] border border-[var(--btn-primary-border)] rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
