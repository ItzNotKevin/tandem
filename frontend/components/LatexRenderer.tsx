'use client'

import katex from 'katex'
import { useMemo } from 'react'

interface Segment {
  type: 'text' | 'inline' | 'display'
  content: string
}

/**
 * Robust LaTeX parser that handles:
 *  - $$...$$ display math
 *  - $...$ inline math
 *  - \(...\) inline math
 *  - \[...\] display math
 *  - Unmatched $ signs (treated as literal text)
 *  - Nested braces inside math expressions
 */
function parseLatex(input: string): Segment[] {
  if (!input) return []

  const segments: Segment[] = []
  let i = 0
  let textStart = 0

  const pushText = (end: number) => {
    if (end > textStart) {
      segments.push({ type: 'text', content: input.slice(textStart, end) })
    }
  }

  while (i < input.length) {
    // --- Display math: $$ ... $$ ---
    if (input[i] === '$' && input[i + 1] === '$') {
      const close = input.indexOf('$$', i + 2)
      if (close !== -1) {
        pushText(i)
        segments.push({ type: 'display', content: input.slice(i + 2, close).trim() })
        i = close + 2
        textStart = i
        continue
      }
      // No closing $$ — treat as literal text
      i += 2
      continue
    }

    // --- Inline math: $ ... $ ---
    if (input[i] === '$') {
      // Find the closing $ on the same line, skipping escaped \$
      let j = i + 1
      let found = false
      while (j < input.length) {
        if (input[j] === '\n') break // don't cross newlines
        if (input[j] === '$' && input[j - 1] !== '\\') {
          found = true
          break
        }
        j++
      }
      if (found && j > i + 1) {
        pushText(i)
        segments.push({ type: 'inline', content: input.slice(i + 1, j).trim() })
        i = j + 1
        textStart = i
        continue
      }
      // Unmatched $ — skip and treat as literal
      i++
      continue
    }

    // --- \[ ... \] display math ---
    if (input[i] === '\\' && input[i + 1] === '[') {
      const close = input.indexOf('\\]', i + 2)
      if (close !== -1) {
        pushText(i)
        segments.push({ type: 'display', content: input.slice(i + 2, close).trim() })
        i = close + 2
        textStart = i
        continue
      }
      i += 2
      continue
    }

    // --- \( ... \) inline math ---
    if (input[i] === '\\' && input[i + 1] === '(') {
      const close = input.indexOf('\\)', i + 2)
      if (close !== -1) {
        pushText(i)
        segments.push({ type: 'inline', content: input.slice(i + 2, close).trim() })
        i = close + 2
        textStart = i
        continue
      }
      i += 2
      continue
    }

    i++
  }

  // Remaining text
  pushText(input.length)
  return segments
}

/**
 * Render a TeX string to HTML via KaTeX.
 * On failure, wraps the raw TeX in a styled fallback so it's clearly
 * distinguishable from regular text (instead of silently dumping raw LaTeX).
 */
function renderMath(tex: string, displayMode: boolean): string {
  if (!tex.trim()) return ''
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
      output: 'html',
    })
  } catch {
    // Fallback: show the TeX in a monospace style so it's obvious
    const escaped = tex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<code style="color:#D93D3D;font-size:0.85em;background:#FEF2F2;padding:2px 4px;border-radius:3px;">${escaped}</code>`
  }
}

interface Props {
  children: string
  className?: string
}

export default function LatexRenderer({ children, className }: Props) {
  const segments = useMemo(() => parseLatex(children ?? ''), [children])

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>
        }
        const isDisplay = seg.type === 'display'
        return (
          <span
            key={i}
            style={{
              display: isDisplay ? 'block' : 'inline-block',
              whiteSpace: isDisplay ? undefined : 'nowrap',
              textAlign: isDisplay ? 'center' : undefined,
              margin: isDisplay ? '0.5em 0' : undefined,
            }}
            dangerouslySetInnerHTML={{
              __html: renderMath(seg.content, isDisplay),
            }}
          />
        )
      })}
    </span>
  )
}
