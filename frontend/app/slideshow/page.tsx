'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSessionSlides, type AISlide } from '@/lib/slideshow-api'
import BrandLogo from '@/components/BrandLogo'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const arrowStyle = (disabled: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '44px',
  height: '44px',
  borderRadius: '50%',
  background: disabled ? 'transparent' : 'rgba(161,128,96,0.08)',
  border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: '28px',
  color: disabled ? '#e0d5c5' : '#a08060',
  transition: 'background 200ms ease, color 200ms ease',
  flexShrink: 0,
})

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

const hardcodedSlides: Slide[] = [
  {
    title: 'Limits',
    subtitle: 'The foundation of calculus',
    diagram: <LimitsDiagram />,
    keywords: ['Approaches', 'Continuity', 'Left & right limits'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'The Derivative',
    subtitle: 'Instantaneous rate of change',
    diagram: <DerivativeDiagram />,
    keywords: ['Tangent line', 'Rate of change', 'Differentiability'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'Power Rule',
    subtitle: 'The most used rule in differentiation',
    diagram: <PowerRuleDiagram />,
    keywords: ['Exponent', 'Polynomial', 'Constant multiple'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'Chain Rule',
    subtitle: 'Differentiating composite functions',
    diagram: <ChainRuleDiagram />,
    keywords: ['Composition', 'Inner function', 'Outer function'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'Product Rule',
    subtitle: 'Two functions multiplied together',
    diagram: <ProductRuleDiagram />,
    keywords: ['Product', 'Two factors', 'Symmetric form'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'Quotient Rule',
    subtitle: 'Dividing one function by another',
    diagram: <DerivativeDiagram />,
    keywords: ['Numerator', 'Denominator', 'Rational functions'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'Implicit Differentiation',
    subtitle: 'When y cannot be isolated',
    diagram: <ChainRuleDiagram />,
    keywords: ['Implicit function', 'dy/dx', 'Related rates'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'Related Rates',
    subtitle: 'How quantities change together',
    diagram: <LimitsDiagram />,
    keywords: ['Time derivative', 'Geometric relationships', 'Chain rule applied'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'L\'Hôpital\'s Rule',
    subtitle: 'Resolving indeterminate forms',
    diagram: <LimitsDiagram />,
    keywords: ['Indeterminate form', '0/0 or ∞/∞', 'Repeated application'],
    theorem: { label: 'Theorem', formula: '' },
  },
  {
    title: 'The Integral',
    subtitle: 'Accumulation of change',
    diagram: <PowerRuleDiagram />,
    keywords: ['Area under curve', 'Antiderivative', 'Definite vs indefinite'],
    theorem: { label: 'Theorem', formula: '' },
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
  const [leftHover, setLeftHover] = useState(false)
  const [rightHover, setRightHover] = useState(false)
  const [returnHover, setReturnHover] = useState(false)
  const [proceedHover, setProceedHover] = useState(false)
  const [aiSlides, setAiSlides] = useState<AISlide[] | null>(null)
  const router = useRouter()

  // On mount, check if session already has generated slides
  useEffect(() => {
    getSessionSlides().then((slides) => {
      if (slides.length > 0) setAiSlides(slides)
    })
  }, [])

  const slideCount = aiSlides ? aiSlides.length : hardcodedSlides.length
  const currentAiSlide = aiSlides ? aiSlides[current] : null
  const currentHardSlide = !aiSlides ? hardcodedSlides[current] : null

  const title = currentAiSlide?.title ?? currentHardSlide?.title ?? ''
  const subtitle = currentAiSlide?.subtitle ?? currentHardSlide?.subtitle
  const keywords = currentAiSlide?.keywords ?? currentHardSlide?.keywords ?? []
  const theorem = currentAiSlide?.theorem ?? currentHardSlide?.theorem

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf6ef', fontFamily: 'Georgia, serif' }}>

      {/* Header */}
      <header className="flex items-center justify-between px-12 py-5 border-b" style={{ borderColor: '#e0d5c5' }}>
        <BrandLogo className="w-40" />
        <div className="flex items-center gap-4">
          {aiSlides && (
            <span className="text-xs" style={{ color: '#a08060', fontFamily: 'sans-serif' }}>AI-generated</span>
          )}
          <span className="text-sm" style={{ color: '#c9b99a', fontFamily: 'sans-serif' }}>
            {current + 1} / {slideCount}
          </span>
        </div>
      </header>

      {/* Main slide content with side arrows */}
      <div className="flex-1 flex items-stretch relative">

        {/* Left arrow */}
        <button
          onClick={() => setCurrent((c) => c - 1)}
          disabled={current === 0}
          onMouseEnter={() => setLeftHover(true)}
          onMouseLeave={() => setLeftHover(false)}
          style={{
            ...arrowStyle(current === 0),
            position: 'absolute',
            left: '36px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 10,
            background: current !== 0 && leftHover ? 'rgba(161,128,96,0.16)' : arrowStyle(current === 0).background,
          }}
        >
          ‹
        </button>

        {/* Slide content */}
        <main className="flex flex-col pt-10 pb-6 gap-6 flex-1 max-w-5xl mx-auto w-full">

          {/* Title block */}
          <div className="text-center">
            <h1 className="text-6xl font-normal tracking-tight mb-2" style={{ color: '#3d2f1e' }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-lg font-normal italic" style={{ color: '#a08060' }}>
                {subtitle}
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
              {currentAiSlide ? (
                currentAiSlide.diagram_image_url ? (
                  <img
                    src={currentAiSlide.diagram_image_url}
                    alt={currentAiSlide.title}
                    className="w-full h-full object-contain rounded-xl"
                    onError={(e) => {
                      const target = e.currentTarget
                      target.style.display = 'none'
                      const parent = target.parentElement
                      if (parent) {
                        const fallback = document.createElement('div')
                        fallback.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#c9b99a;font-family:Georgia,serif;font-style:italic;font-size:14px'
                        fallback.textContent = 'No diagram available'
                        parent.appendChild(fallback)
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ color: '#c9b99a', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '14px' }}>
                    No diagram available
                  </div>
                )
              ) : (
                currentHardSlide?.diagram
              )}
            </div>

            {/* Right: theorem + keywords */}
            <div className="flex flex-col gap-8 flex-1 justify-center pt-2">

              {/* Theorem */}
              {theorem && (
                <div className="rounded-xl px-7 py-5" style={{ backgroundColor: '#f0e6d2', border: '1px solid #d4c4a8' }}>
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a08060', fontFamily: 'sans-serif' }}>
                    {theorem.label}
                  </p>
                  {currentAiSlide ? (
                    <div
                      style={{ color: '#5c3d1e', fontSize: '1.4rem' }}
                      dangerouslySetInnerHTML={{
                        __html: (() => {
                          try {
                            return katex.renderToString(theorem.formula, { throwOnError: false, displayMode: true })
                          } catch {
                            return `<span style="font-family:Georgia,serif">${theorem.formula}</span>`
                          }
                        })()
                      }}
                    />
                  ) : (
                    <p className="text-2xl" style={{ color: '#5c3d1e', fontFamily: 'Georgia, serif' }}>
                      {theorem.formula}
                    </p>
                  )}
                </div>
              )}

              {/* Keywords */}
              <div className="flex flex-col gap-3">
                {keywords.map((kw) => (
                  <div key={kw} className="flex items-center gap-4">
                    <div className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: '#c17f3a' }} />
                    <span className="text-lg" style={{ color: '#6b5a3e' }}>{kw}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>

        {/* Right arrow */}
        <button
          onClick={() => setCurrent((c) => c + 1)}
          disabled={current === slideCount - 1}
          onMouseEnter={() => setRightHover(true)}
          onMouseLeave={() => setRightHover(false)}
          style={{
            ...arrowStyle(current === slideCount - 1),
            position: 'absolute',
            right: '36px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 10,
            background: current !== slideCount - 1 && rightHover ? 'rgba(161,128,96,0.16)' : arrowStyle(current === slideCount - 1).background,
          }}
        >
          ›
        </button>
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between px-8 py-7 border-t" style={{ borderColor: '#e0d5c5' }}>

        {/* Return to Generation */}
        <button
          onClick={() => router.push('/record')}
          onMouseEnter={() => setReturnHover(true)}
          onMouseLeave={() => setReturnHover(false)}
          style={{
            fontFamily: 'sans-serif',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            color: returnHover ? '#5c3d1e' : '#a08060',
            background: returnHover ? 'rgba(161,128,96,0.1)' : 'transparent',
            border: '1px solid',
            borderColor: returnHover ? '#c9b99a' : '#d4c4a8',
            borderRadius: '8px',
            padding: '11px 22px',
            transition: 'all 200ms ease',
          }}
        >
          ← Return to Generation
        </button>

        {/* Dots — sliding window */}
        <div className="flex items-center gap-3">
          <BrandLogo variant="mark" className="w-6 h-6 opacity-80" />
          <div style={{ width: '72px', overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              transform: `translateX(-${getVisibleDots(current, slideCount).start * 16}px)`,
              transition: 'transform 300ms ease',
            }}
          >
            {Array.from({ length: slideCount }).map((_, i) => (
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
        </div>

        {/* Proceed to Problems */}
        <button
          onClick={() => router.push('/whiteboard')}
          onMouseEnter={() => setProceedHover(true)}
          onMouseLeave={() => setProceedHover(false)}
          style={{
            fontFamily: 'sans-serif',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            color: proceedHover ? '#5c3d1e' : '#a08060',
            background: proceedHover ? 'rgba(161,128,96,0.1)' : 'transparent',
            border: '1px solid',
            borderColor: proceedHover ? '#c9b99a' : '#d4c4a8',
            borderRadius: '8px',
            padding: '11px 22px',
            transition: 'all 200ms ease',
          }}
        >
          Proceed to Problems →
        </button>
      </footer>
    </div>
  )
}
