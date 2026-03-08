'use client'

import katex from 'katex'
import { useMemo } from 'react'

interface Segment {
  type: 'text' | 'inline' | 'display'
  content: string
}

function parseLatex(input: string): Segment[] {
  const segments: Segment[] = []
  // Match $$...$$ first, then $...$
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: input.slice(lastIndex, match.index) })
    }
    const raw = match[0]
    if (raw.startsWith('$$')) {
      segments.push({ type: 'display', content: raw.slice(2, -2) })
    } else {
      segments.push({ type: 'inline', content: raw.slice(1, -1) })
    }
    lastIndex = match.index + raw.length
  }

  if (lastIndex < input.length) {
    segments.push({ type: 'text', content: input.slice(lastIndex) })
  }

  return segments
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    })
  } catch {
    return tex
  }
}

interface Props {
  children: string
  className?: string
}

export default function LatexRenderer({ children, className }: Props) {
  const segments = useMemo(() => parseLatex(children), [children])

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>
        }
        return (
          <span
            key={i}
            style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
            dangerouslySetInnerHTML={{
              __html: renderMath(seg.content, seg.type === 'display'),
            }}
          />
        )
      })}
    </span>
  )
}
