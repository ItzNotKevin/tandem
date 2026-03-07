'use client'

import { useState } from 'react'

interface Slide {
  title: string
  subtitle?: string
  diagram: React.ReactNode
  keywords: string[]
  theorem?: { label: string; formula: string }
}

function DerivativeDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <line x1="30" y1="190" x2="300" y2="190" stroke="#c9b99a" strokeWidth="1.5"/>
      <line x1="40" y1="200" x2="40" y2="20" stroke="#c9b99a" strokeWidth="1.5"/>
      <path d="M 50 170 Q 130 150 180 90 Q 220 45 290 30" stroke="#8b7355" strokeWidth="2.5" fill="none"/>
      <line x1="120" y1="30" x2="250" y2="135" stroke="#c17f3a" strokeWidth="1.5" strokeDasharray="6,4"/>
      <circle cx="180" cy="90" r="5" fill="#c17f3a"/>
      <text x="188" y="85" fill="#8b7355" fontSize="13" fontFamily="Georgia, serif" fontStyle="italic">f(x)</text>
      <text x="255" y="130" fill="#c17f3a" fontSize="11" fontFamily="Georgia, serif">tangent</text>
    </svg>
  )
}

function PowerRuleDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <line x1="30" y1="190" x2="300" y2="190" stroke="#c9b99a" strokeWidth="1.5"/>
      <line x1="40" y1="200" x2="40" y2="20" stroke="#c9b99a" strokeWidth="1.5"/>
      <path d="M 50 185 Q 120 180 170 130 Q 220 70 290 20" stroke="#8b7355" strokeWidth="2.5" fill="none"/>
      <text x="90" y="100" fill="#6b5a3e" fontSize="28" fontFamily="Georgia, serif" fontStyle="italic">xⁿ</text>
      <text x="165" y="100" fill="#a08060" fontSize="22" fontFamily="sans-serif">→</text>
      <text x="195" y="100" fill="#c17f3a" fontSize="28" fontFamily="Georgia, serif" fontStyle="italic">nxⁿ⁻¹</text>
    </svg>
  )
}

function ChainRuleDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <rect x="25" y="85" width="90" height="50" rx="10" fill="none" stroke="#c9b99a" strokeWidth="1.5"/>
      <text x="52" y="116" fill="#6b5a3e" fontSize="15" fontFamily="Georgia, serif" fontStyle="italic">g(x)</text>
      <line x1="115" y1="110" x2="155" y2="110" stroke="#a08060" strokeWidth="1.5"/>
      <polygon points="155,105 165,110 155,115" fill="#a08060"/>
      <rect x="165" y="85" width="110" height="50" rx="10" fill="none" stroke="#c17f3a" strokeWidth="1.5"/>
      <text x="185" y="116" fill="#c17f3a" fontSize="15" fontFamily="Georgia, serif" fontStyle="italic">f( g(x) )</text>
      <text x="80" y="165" fill="#a08060" fontSize="11" fontFamily="Georgia, serif">inner</text>
      <text x="195" y="165" fill="#c17f3a" fontSize="11" fontFamily="Georgia, serif">outer(inner)</text>
    </svg>
  )
}

function ProductRuleDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <rect x="25" y="70" width="265" height="80" rx="10" fill="none" stroke="#c9b99a" strokeWidth="1.5"/>
      <rect x="25" y="70" width="130" height="80" rx="10" fill="#f5ede0" stroke="#c9b99a" strokeWidth="1.5"/>
      <text x="72" y="116" fill="#6b5a3e" fontSize="18" fontFamily="Georgia, serif" fontStyle="italic">u(x)</text>
      <rect x="160" y="70" width="130" height="80" rx="10" fill="#fdf3e3" stroke="#c17f3a" strokeWidth="1.5"/>
      <text x="207" y="116" fill="#c17f3a" fontSize="18" fontFamily="Georgia, serif" fontStyle="italic">v(x)</text>
      <text x="115" y="116" fill="#a08060" fontSize="18" fontFamily="sans-serif">·</text>
      <text x="90" y="180" fill="#8b7355" fontSize="12" fontFamily="Georgia, serif">d/dx [u·v] = u′v + uv′</text>
    </svg>
  )
}

function LimitsDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <line x1="30" y1="190" x2="300" y2="190" stroke="#c9b99a" strokeWidth="1.5"/>
      <line x1="160" y1="200" x2="160" y2="20" stroke="#c9b99a" strokeWidth="1.5" strokeDasharray="5,4"/>
      <path d="M 50 170 Q 120 160 150 60" stroke="#8b7355" strokeWidth="2.5" fill="none"/>
      <path d="M 170 60 Q 200 160 280 170" stroke="#8b7355" strokeWidth="2.5" fill="none"/>
      <circle cx="150" cy="60" r="5" fill="none" stroke="#c17f3a" strokeWidth="2"/>
      <circle cx="170" cy="60" r="5" fill="none" stroke="#c17f3a" strokeWidth="2"/>
      <text x="140" y="50" fill="#c17f3a" fontSize="11" fontFamily="Georgia, serif">L</text>
      <text x="148" y="205" fill="#a08060" fontSize="11" fontFamily="Georgia, serif">c</text>
    </svg>
  )
}

const slides: Slide[] = [
  {
    title: 'Limits',
    subtitle: 'The foundation of calculus',
    diagram: <LimitsDiagram />,
    keywords: ['Approaches', 'Continuity', 'Left & right limits'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'The Derivative',
    subtitle: 'Instantaneous rate of change',
    diagram: <DerivativeDiagram />,
    keywords: ['Tangent line', 'Rate of change', 'Differentiability'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'Power Rule',
    subtitle: 'The most used rule in differentiation',
    diagram: <PowerRuleDiagram />,
    keywords: ['Exponent', 'Polynomial', 'Constant multiple'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'Chain Rule',
    subtitle: 'Differentiating composite functions',
    diagram: <ChainRuleDiagram />,
    keywords: ['Composition', 'Inner function', 'Outer function'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'Product Rule',
    subtitle: 'Two functions multiplied together',
    diagram: <ProductRuleDiagram />,
    keywords: ['Product', 'Two factors', 'Symmetric form'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'Quotient Rule',
    subtitle: 'Dividing one function by another',
    diagram: <DerivativeDiagram />,
    keywords: ['Numerator', 'Denominator', 'Rational functions'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'Implicit Differentiation',
    subtitle: 'When y cannot be isolated',
    diagram: <ChainRuleDiagram />,
    keywords: ['Implicit function', 'dy/dx', 'Related rates'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'Related Rates',
    subtitle: 'How quantities change together',
    diagram: <LimitsDiagram />,
    keywords: ['Time derivative', 'Geometric relationships', 'Chain rule applied'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'L\'Hôpital\'s Rule',
    subtitle: 'Resolving indeterminate forms',
    diagram: <LimitsDiagram />,
    keywords: ['Indeterminate form', '0/0 or ∞/∞', 'Repeated application'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
  {
    title: 'The Integral',
    subtitle: 'Accumulation of change',
    diagram: <PowerRuleDiagram />,
    keywords: ['Area under curve', 'Antiderivative', 'Definite vs indefinite'],
    theorem: {
      label: 'Theorem',
      formula: '',
    },
  },
]

const DOT_WINDOW = 5

function getVisibleDots(current: number, total: number) {
  if (total <= DOT_WINDOW) return { start: 0, end: total }
  const half = Math.floor(DOT_WINDOW / 2)
  const start = Math.min(Math.max(current - half, 0), total - DOT_WINDOW)
  return { start, end: start + DOT_WINDOW }
}

export default function SlideshowPage() {
  const [current, setCurrent] = useState(0)
  const slide = slides[current]

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf6ef', fontFamily: 'Georgia, serif' }}>

      {/* Header */}
      <header className="flex items-center justify-between px-12 py-5 border-b" style={{ borderColor: '#e0d5c5' }}>
        <span className="text-sm tracking-widest uppercase" style={{ color: '#a08060', fontFamily: 'sans-serif', letterSpacing: '0.15em' }}>
          Cursor for Calculus
        </span>
        <span className="text-sm" style={{ color: '#c9b99a', fontFamily: 'sans-serif' }}>
          {current + 1} / {slides.length}
        </span>
      </header>

      {/* Main slide content */}
      <main className="flex-1 flex flex-col px-12 pt-10 pb-6 gap-6 max-w-5xl mx-auto w-full">

        {/* Title block */}
        <div className="text-center">
          <h1 className="text-6xl font-normal tracking-tight mb-2" style={{ color: '#3d2f1e' }}>
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p className="text-lg font-normal italic" style={{ color: '#a08060' }}>
              {slide.subtitle}
            </p>
          )}
        </div>

        {/* Diagram + right column */}
        <div className="flex flex-col lg:flex-row items-stretch gap-12 w-full flex-1">

          {/* Diagram */}
          <div
            className="w-full lg:w-[26rem] rounded-2xl flex items-center justify-center shrink-0 p-4"
            style={{ backgroundColor: '#f5ede0', border: '1px solid #e0d5c5' }}
          >
            {slide.diagram}
          </div>

          {/* Right: theorem + keywords */}
          <div className="flex flex-col gap-8 flex-1 justify-center pt-2">

            {/* Theorem */}
            {slide.theorem && (
              <div className="rounded-xl px-7 py-5" style={{ backgroundColor: '#f0e6d2', border: '1px solid #d4c4a8' }}>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#a08060', fontFamily: 'sans-serif' }}>
                  {slide.theorem.label}
                </p>
                <p className="text-2xl" style={{ color: '#5c3d1e', fontFamily: 'Georgia, serif' }}>
                  {slide.theorem.formula}
                </p>
              </div>
            )}

            {/* Keywords */}
            <div className="flex flex-col gap-3">
              {slide.keywords.map((kw) => (
                <div key={kw} className="flex items-center gap-4">
                  <div className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: '#c17f3a' }} />
                  <span className="text-lg" style={{ color: '#6b5a3e' }}>{kw}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Footer nav */}
      <footer className="flex items-center justify-between px-12 py-7 border-t" style={{ borderColor: '#e0d5c5' }}>
        <button
          onClick={() => setCurrent((c) => c - 1)}
          disabled={current === 0}
          className="text-sm transition"
          style={{
            color: current === 0 ? '#d4c4a8' : '#8b7355',
            fontFamily: 'sans-serif',
            cursor: current === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          ← Previous
        </button>

        {/* Dots — sliding window */}
        <div style={{ width: '72px', overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              transform: `translateX(-${getVisibleDots(current, slides.length).start * 16}px)`,
              transition: 'transform 300ms ease',
            }}
          >
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                style={{
                  flexShrink: 0,
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: i === current ? '#c17f3a' : '#d4c4a8',
                  transition: 'background-color 200ms ease',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        <button
          onClick={() => setCurrent((c) => c + 1)}
          disabled={current === slides.length - 1}
          className="text-sm transition"
          style={{
            color: current === slides.length - 1 ? '#d4c4a8' : '#8b7355',
            fontFamily: 'sans-serif',
            cursor: current === slides.length - 1 ? 'not-allowed' : 'pointer',
          }}
        >
          Next →
        </button>
      </footer>
    </div>
  )
}
