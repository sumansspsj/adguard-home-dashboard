import React, { useState } from 'react'
import { Copy, Check, ShieldCheck, Terminal } from 'lucide-react'
import { applyAiRule } from '../api'
import { useToast } from '../contexts/ToastContext'

interface MarkdownMessageProps {
  content: string
  isUser?: boolean
}

/**
 * Parses inline formatting: **bold**, *italic*, `code`, and [links](url)
 */
function renderInline(text: string): React.ReactNode {
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(regex)

  return parts.map((part, i) => {
    if (!part) return null

    // Inline code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const codeText = part.slice(1, -1)
      return (
        <code
          key={i}
          className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border)]"
        >
          {codeText}
        </code>
      )
    }

    // Bold: **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-[var(--text-primary)]">
          {renderInline(part.slice(2, -2))}
        </strong>
      )
    }

    // Italic: *text*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={i} className="italic text-[var(--text-secondary)]">
          {renderInline(part.slice(1, -1))}
        </em>
      )
    }

    // Link: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--text-primary)] font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          {linkMatch[1]}
        </a>
      )
    }

    return part
  })
}

/**
 * Fenced Code Block component with 1-click copy & rule enforcement
 */
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [enforcing, setEnforcing] = useState(false)
  const [enforced, setEnforced] = useState(false)

  const isAdguardRule =
    code.trim().startsWith('||') ||
    code.trim().startsWith('@@||') ||
    code.trim().includes('^$')

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast('Code copied to clipboard', { type: 'info' })
  }

  const handleEnforce = async () => {
    setEnforcing(true)
    try {
      await applyAiRule(code.trim())
      setEnforced(true)
      toast(`Rule applied to AdGuard: ${code.trim()}`, { type: 'success' })
    } catch (err: any) {
      toast(`Failed to apply rule: ${err.message}`, { type: 'error' })
    } finally {
      setEnforcing(false)
    }
  }

  return (
    <div className="my-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-active)] border-b border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
          <Terminal className="w-3 h-3 text-[var(--text-secondary)]" />
          <span>{language || (isAdguardRule ? 'adguard-rule' : 'text')}</span>
        </span>
        <div className="flex items-center gap-2">
          {isAdguardRule && (
            <button
              onClick={handleEnforce}
              disabled={enforced || enforcing}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer ${
                enforced
                  ? 'bg-[var(--bg-active)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                  : 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]'
              }`}
            >
              {enforced ? <Check className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
              <span>{enforced ? 'Enforced' : enforcing ? 'Applying...' : 'Enforce Rule'}</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          >
            {copied ? <Check className="w-3 h-3 text-[var(--text-primary)]" /> : <Copy className="w-3 h-3" />}
            <span className="text-[10px]">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <div className="p-3 overflow-x-auto font-mono text-[var(--text-primary)] text-[11.5px] leading-relaxed">
        <pre className="m-0 whitespace-pre">{code}</pre>
      </div>
    </div>
  )
}

/**
 * Markdown Table component
 */
function MarkdownTable({ lines }: { lines: string[] }) {
  if (lines.length < 2) return null

  // Header row
  const headerCells = lines[0]
    .split('|')
    .map(c => c.trim())
    .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)

  // Skip delimiter row (line 1), parse data rows
  const dataRows = lines.slice(2).map(line =>
    line
      .split('|')
      .map(c => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
  )

  return (
    <div className="my-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-[var(--bg-surface)] border-b border-[var(--border)]">
            {headerCells.map((cell, idx) => (
              <th
                key={idx}
                className="px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--text-primary)]"
              >
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {dataRows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-[var(--bg-hover)] transition-colors">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3.5 py-2 text-[var(--text-secondary)] leading-snug">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MarkdownMessage({ content, isUser }: MarkdownMessageProps) {
  if (isUser) {
    return <div className="whitespace-pre-wrap">{content}</div>
  }

  // Tokenize lines into semantic blocks
  const lines = content.split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    // 1. Code blocks: ```
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const codeLines: string[] = []
      index++
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index++
      }
      index++
      blocks.push(
        <CodeBlock
          key={`code-${index}`}
          code={codeLines.join('\n')}
          language={language}
        />
      )
      continue
    }

    // 2. Tables
    if (
      line.trim().startsWith('|') &&
      index + 1 < lines.length &&
      lines[index + 1].includes('---')
    ) {
      const tableLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index])
        index++
      }
      blocks.push(<MarkdownTable key={`table-${index}`} lines={tableLines} />)
      continue
    }

    // 3. Headings: #, ##, ###, ####
    if (line.startsWith('#### ')) {
      blocks.push(
        <h4 key={`h4-${index}`} className="text-xs font-bold text-[var(--text-primary)] mt-3 mb-1.5">
          {renderInline(line.slice(5))}
        </h4>
      )
      index++
      continue
    }

    if (line.startsWith('### ')) {
      blocks.push(
        <h3
          key={`h3-${index}`}
          className="text-[13px] font-bold text-[var(--text-primary)] mt-3.5 mb-1.5 pb-1 border-b border-[var(--border-subtle)] flex items-center gap-2"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)]" />
          {renderInline(line.slice(4))}
        </h3>
      )
      index++
      continue
    }

    if (line.startsWith('## ')) {
      blocks.push(
        <h2
          key={`h2-${index}`}
          className="text-sm font-bold text-[var(--text-primary)] mt-4 mb-2 pb-1 border-b border-[var(--border)]"
        >
          {renderInline(line.slice(3))}
        </h2>
      )
      index++
      continue
    }

    if (line.startsWith('# ')) {
      blocks.push(
        <h1 key={`h1-${index}`} className="text-base font-extrabold text-[var(--text-primary)] mt-4 mb-2">
          {renderInline(line.slice(2))}
        </h1>
      )
      index++
      continue
    }

    // 4. Horizontal Rule: ---
    if (line.trim() === '---' || line.trim() === '***') {
      blocks.push(
        <hr key={`hr-${index}`} className="my-3 border-t border-[var(--border-subtle)]" />
      )
      index++
      continue
    }

    // 5. Blockquotes: > text
    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="my-2 pl-3 py-1 border-l-2 border-[var(--border-strong)] bg-[var(--bg-muted)] rounded-r-lg text-[var(--text-secondary)] text-xs italic"
        >
          {renderInline(line.slice(2))}
        </blockquote>
      )
      index++
      continue
    }

    // 6. Bullet lists: * or -
    if (line.match(/^(\*|-)\s+/)) {
      const listItems: string[] = []
      while (index < lines.length && lines[index].match(/^(\*|-)\s+/)) {
        listItems.push(lines[index].replace(/^(\*|-)\s+/, ''))
        index++
      }
      blocks.push(
        <ul key={`ul-${index}`} className="my-2 space-y-1.5 pl-1">
          {listItems.map((item, lIdx) => (
            <li key={lIdx} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] mt-1.5 shrink-0" />
              <div className="flex-1 leading-snug">{renderInline(item)}</div>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // 7. Numbered lists: 1. 2.
    if (line.match(/^\d+\.\s+/)) {
      const listItems: string[] = []
      while (index < lines.length && lines[index].match(/^\d+\.\s+/)) {
        listItems.push(lines[index].replace(/^\d+\.\s+/, ''))
        index++
      }
      blocks.push(
        <ol key={`ol-${index}`} className="my-2 space-y-1.5 pl-1">
          {listItems.map((item, lIdx) => (
            <li key={lIdx} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
              <span className="font-mono text-[10px] text-[var(--text-tertiary)] font-semibold mt-0.5 shrink-0 w-4">
                {lIdx + 1}.
              </span>
              <div className="flex-1 leading-snug">{renderInline(item)}</div>
            </li>
          ))}
        </ol>
      )
      continue
    }

    // 8. Empty lines
    if (!line.trim()) {
      index++
      continue
    }

    // 9. Standard paragraphs
    blocks.push(
      <p key={`p-${index}`} className="my-1.5 text-xs text-[var(--text-secondary)] leading-relaxed">
        {renderInline(line)}
      </p>
    )
    index++
  }

  return <div className="space-y-1 text-xs">{blocks}</div>
}
