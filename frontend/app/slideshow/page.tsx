'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { type AISlide, getNarratorContext, getSessionSlides } from '@/lib/slideshow-api'
import BrandLogo from '@/components/BrandLogo'
import katex from 'katex'
import { useConversation } from '@elevenlabs/react'
import { Mic, MicOff, Loader2 } from 'lucide-react'

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

interface UploadedFileSummary {
  filename?: string
  summary?: string
}

interface SessionContextData {
  file_summaries?: UploadedFileSummary[]
}

function DerivativeDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <line x1="30" y1="190" x2="300" y2="190" stroke="#c9b99a" strokeWidth="1.5" />
      <line x1="40" y1="200" x2="40" y2="20" stroke="#c9b99a" strokeWidth="1.5" />
      <path d="M 50 170 Q 130 150 180 90 Q 220 45 290 30" stroke="#8b7355" strokeWidth="2.5" fill="none" />
      <line x1="120" y1="30" x2="250" y2="135" stroke="#c17f3a" strokeWidth="1.5" strokeDasharray="6,4" />
      <circle cx="180" cy="90" r="5" fill="#c17f3a" />
      <text x="188" y="85" fill="#8b7355" fontSize="13" fontFamily="Georgia, serif" fontStyle="italic">f(x)</text>
      <text x="255" y="130" fill="#c17f3a" fontSize="11" fontFamily="Georgia, serif">tangent</text>
    </svg>
  )
}

function PowerRuleDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <line x1="30" y1="190" x2="300" y2="190" stroke="#c9b99a" strokeWidth="1.5" />
      <line x1="40" y1="200" x2="40" y2="20" stroke="#c9b99a" strokeWidth="1.5" />
      <path d="M 50 185 Q 120 180 170 130 Q 220 70 290 20" stroke="#8b7355" strokeWidth="2.5" fill="none" />
      <text x="90" y="100" fill="#6b5a3e" fontSize="28" fontFamily="Georgia, serif" fontStyle="italic">xⁿ</text>
      <text x="165" y="100" fill="#a08060" fontSize="22" fontFamily="sans-serif">→</text>
      <text x="195" y="100" fill="#c17f3a" fontSize="28" fontFamily="Georgia, serif" fontStyle="italic">nxⁿ⁻¹</text>
    </svg>
  )
}

function ChainRuleDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <rect x="25" y="85" width="90" height="50" rx="10" fill="none" stroke="#c9b99a" strokeWidth="1.5" />
      <text x="52" y="116" fill="#6b5a3e" fontSize="15" fontFamily="Georgia, serif" fontStyle="italic">g(x)</text>
      <line x1="115" y1="110" x2="155" y2="110" stroke="#a08060" strokeWidth="1.5" />
      <polygon points="155,105 165,110 155,115" fill="#a08060" />
      <rect x="165" y="85" width="110" height="50" rx="10" fill="none" stroke="#c17f3a" strokeWidth="1.5" />
      <text x="185" y="116" fill="#c17f3a" fontSize="15" fontFamily="Georgia, serif" fontStyle="italic">f( g(x) )</text>
      <text x="80" y="165" fill="#a08060" fontSize="11" fontFamily="Georgia, serif">inner</text>
      <text x="195" y="165" fill="#c17f3a" fontSize="11" fontFamily="Georgia, serif">outer(inner)</text>
    </svg>
  )
}

function ProductRuleDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <rect x="25" y="70" width="265" height="80" rx="10" fill="none" stroke="#c9b99a" strokeWidth="1.5" />
      <rect x="25" y="70" width="130" height="80" rx="10" fill="#f5ede0" stroke="#c9b99a" strokeWidth="1.5" />
      <text x="72" y="116" fill="#6b5a3e" fontSize="18" fontFamily="Georgia, serif" fontStyle="italic">u(x)</text>
      <rect x="160" y="70" width="130" height="80" rx="10" fill="#fdf3e3" stroke="#c17f3a" strokeWidth="1.5" />
      <text x="207" y="116" fill="#c17f3a" fontSize="18" fontFamily="Georgia, serif" fontStyle="italic">v(x)</text>
      <text x="115" y="116" fill="#a08060" fontSize="18" fontFamily="sans-serif">·</text>
      <text x="90" y="180" fill="#8b7355" fontSize="12" fontFamily="Georgia, serif">d/dx [u·v] = u′v + uv′</text>
    </svg>
  )
}

function LimitsDiagram() {
  return (
    <svg viewBox="0 0 320 220" className="w-full h-full">
      <line x1="30" y1="190" x2="300" y2="190" stroke="#c9b99a" strokeWidth="1.5" />
      <line x1="160" y1="200" x2="160" y2="20" stroke="#c9b99a" strokeWidth="1.5" strokeDasharray="5,4" />
      <path d="M 50 170 Q 120 160 150 60" stroke="#8b7355" strokeWidth="2.5" fill="none" />
      <path d="M 170 60 Q 200 160 280 170" stroke="#8b7355" strokeWidth="2.5" fill="none" />
      <circle cx="150" cy="60" r="5" fill="none" stroke="#c17f3a" strokeWidth="2" />
      <circle cx="170" cy="60" r="5" fill="none" stroke="#c17f3a" strokeWidth="2" />
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
const MOVE_ON_PROMPT_DELAY_MS = 12000

function getVisibleDots(current: number, total: number) {
  if (total <= DOT_WINDOW) return { start: 0, end: total }
  const half = Math.floor(DOT_WINDOW / 2)
  const start = Math.min(Math.max(current - half, 0), total - DOT_WINDOW)
  return { start, end: start + DOT_WINDOW }
}

function buildQuestionSupportContext(
  slide: AISlide | undefined,
  slideNumber: number,
  totalSlides: number,
  fileSummaries: string,
  userMessage?: string
) {
  return `LIVE CONTEXT UPDATE:
Current slide: ${slideNumber} of ${totalSlides}
Title: ${slide?.title || '(unknown)'}
Slide script: ${slide?.script || '(none)'}
Slide keywords: ${(slide?.keywords || []).join(', ') || '(none)'}
Uploaded material summaries:
${fileSummaries || '(none uploaded)'}

RULES FOR INTERRUPTIONS:
- If the student asks a question, answer using ONLY slide scripts and uploaded materials.
- If the student sounds confused or says they still do not understand, explain the same concept again in a different way:
  1) plain-language restatement
  2) short concrete example or analogy
  3) step-by-step mini breakdown
- Keep each answer concise (1-4 sentences), then go silent.
- If the answer is not in the provided material, say that clearly and point to the closest related slide.
- After finishing slide narration and a short silence, ask exactly: "Are you ready to move on?"
${userMessage ? `- Student just said: "${userMessage}"` : ''}`
}

function formatFileSummaries(session: SessionContextData | null) {
  return (session?.file_summaries || [])
    .map((f) => `- ${f.filename || 'Uploaded file'}: ${f.summary || ''}`)
    .join('\n')
}

export default function SlideshowPage() {
  const [isWipingAway, setIsWipingAway] = useState(false)
  const [isWipingForward, setIsWipingForward] = useState(false)
  const [current, setCurrent] = useState(0)
  const [leftHover, setLeftHover] = useState(false)
  const [rightHover, setRightHover] = useState(false)
  const [returnHover, setReturnHover] = useState(false)
  const [proceedHover, setProceedHover] = useState(false)
  const [aiSlides, setAiSlides] = useState<AISlide[] | null>(null)
  const currentRef = useRef(0)
  const aiSlidesRef = useRef<AISlide[] | null>(null)
  const narratorContextRef = useRef('')
  const sessionDataRef = useRef<SessionContextData | null>(null)
  const hasPromptedMoveOnRef = useRef<number | null>(null)
  const awaitingMoveOnReplyRef = useRef(false)
  const lastReadInstructionRef = useRef('')
  const lastReadSentAtRef = useRef(0)
  const narrationLockUntilRef = useRef(0)
  const lastNarratedSlideRef = useRef<number | null>(null)
  const nowMsRef = useRef(0)
  const router = useRouter()

  useEffect(() => {
    // Trigger the slide-away animation immediately upon mount 
    // to complete the cross-page chalk wipe transition
    const timer = setTimeout(() => {
      setIsWipingAway(true)
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  const sendReadInstruction = (script: string, sendFn: (text: string) => void) => {
    const instruction = `Read this aloud exactly as written:\n${script}`
    const now = nowMsRef.current
    const isDuplicateBurst =
      instruction === lastReadInstructionRef.current &&
      now - lastReadSentAtRef.current < 1500

    if (isDuplicateBurst) return

    lastReadInstructionRef.current = instruction
    lastReadSentAtRef.current = now
    const wordCount = script.trim().split(/\s+/).filter(Boolean).length
    const lockMs = Math.min(30000, Math.max(6000, wordCount * 450))
    narrationLockUntilRef.current = now + lockMs
    sendFn(instruction)
  }

  const conversation = useConversation({
    onConnect: () => {
      const slides = aiSlidesRef.current || []
      const slide = slides[currentRef.current]
      const fileSummaries = formatFileSummaries(sessionDataRef.current)

      if (narratorContextRef.current) {
        conversation.sendContextualUpdate(narratorContextRef.current)
      }
      conversation.sendContextualUpdate(
        buildQuestionSupportContext(
          slide,
          currentRef.current + 1,
          slides.length || 1,
          fileSummaries
        )
      )
    },
    onDisconnect: () => {
      console.log('Disconnected from ElevenLabs')
      lastReadInstructionRef.current = ''
      lastReadSentAtRef.current = 0
      narrationLockUntilRef.current = 0
      lastNarratedSlideRef.current = null
    },
    onMessage: (message) => {
      if (message.source !== 'user' || !message.message) return
      const text = message.message.trim()
      const isInternalReadCommand = /^narrate slide \d+/i.test(text) || text.startsWith('Read this aloud exactly as written:')
      const isInternalSystemCommand = text.startsWith('[SYSTEM]')
      if (isInternalReadCommand) return
      if (isInternalSystemCommand) return
      if (nowMsRef.current < narrationLockUntilRef.current) return

      const isAffirmative = /^(yes|yeah|yep|sure|ok|okay|go ahead|next|continue|let'?s go|move on)\b/i.test(text)
      const isNegative = /^(no|not yet|wait|hold on|stop)\b/i.test(text)

      if (awaitingMoveOnReplyRef.current) {
        if (isAffirmative) {
          awaitingMoveOnReplyRef.current = false
          setCurrent((prev) => {
            const slides = aiSlidesRef.current || []
            if (prev >= slides.length - 1) return prev
            return prev + 1
          })
          return
        }
        if (isNegative) {
          awaitingMoveOnReplyRef.current = false
        }
      }

      const isPunctuationNoise = !text || /^[.\s\u2026!?]+$/.test(text)
      const isVeryShort = text.length <= 3
      const isShortFiller = /^(uh|um|hmm|mm|mhm|alright|right)$/i.test(text)
      if (isPunctuationNoise) return
      if ((isVeryShort || isShortFiller) && !isAffirmative && !isNegative) return

      // During narration, only interrupt for clear, substantive questions.
      const looksLikeQuestion = /\?/.test(text) || /^(what|why|how|can|could|would|should|where|when|who|is|are|do|does|did|explain)\b/i.test(text)
      if (isSpeaking && !(looksLikeQuestion && text.length >= 8)) return

      const slides = aiSlidesRef.current || []
      const slide = slides[currentRef.current]
      const fileSummaries = formatFileSummaries(sessionDataRef.current)

      conversation.sendContextualUpdate(
        buildQuestionSupportContext(
          slide,
          currentRef.current + 1,
          slides.length || 1,
          fileSummaries,
          text
        )
      )
    },
    onError: (error) => console.error('ElevenLabs error:', error),
  })

  const { status, isSpeaking, sendContextualUpdate, sendUserMessage } = conversation
  const isConnected = status === 'connected'
  const sendContextualUpdateRef = useRef(sendContextualUpdate)
  const sendUserMessageRef = useRef(sendUserMessage)

  // Keep refs in sync so onConnect closure always has latest values
  useEffect(() => { currentRef.current = current }, [current])
  useEffect(() => { aiSlidesRef.current = aiSlides }, [aiSlides])
  useEffect(() => { sendContextualUpdateRef.current = sendContextualUpdate }, [sendContextualUpdate])
  useEffect(() => { sendUserMessageRef.current = sendUserMessage }, [sendUserMessage])

  // Shared clock for interruption gating.
  useEffect(() => {
    nowMsRef.current = Date.now()
    const timer = setInterval(() => {
      nowMsRef.current = Date.now()
    }, 250)
    return () => clearInterval(timer)
  }, [])

  // When slide changes while connected, refresh context and narrate that slide
  useEffect(() => {
    if (!isConnected || !aiSlides) return
    const slide = aiSlides[current]
    const fileSummaries = formatFileSummaries(sessionDataRef.current)

    sendContextualUpdateRef.current(
      buildQuestionSupportContext(
        slide,
        current + 1,
        aiSlides.length || 1,
        fileSummaries
      )
    )
    if (slide?.script) {
      if (lastNarratedSlideRef.current === current) return
      hasPromptedMoveOnRef.current = null
      awaitingMoveOnReplyRef.current = false
      lastNarratedSlideRef.current = current
      sendReadInstruction(slide.script, sendUserMessageRef.current)
    }
  }, [current, isConnected, aiSlides])

  // After narration ends and silence continues, ask if the student wants to move on.
  useEffect(() => {
    if (!isConnected || isSpeaking || !aiSlides || aiSlides.length === 0) return
    if (hasPromptedMoveOnRef.current === current) return
    if (nowMsRef.current < narrationLockUntilRef.current) return

    const timeout = setTimeout(() => {
      if (!isConnected || isSpeaking) return
      if (currentRef.current !== current) return
      if (hasPromptedMoveOnRef.current === current) return
      if (nowMsRef.current < narrationLockUntilRef.current) return

      sendUserMessageRef.current('[SYSTEM] Ask exactly: "Are you ready to move on?" Then wait silently for the student response.')
      hasPromptedMoveOnRef.current = current
      awaitingMoveOnReplyRef.current = true
    }, MOVE_ON_PROMPT_DELAY_MS)

    return () => clearTimeout(timeout)
  }, [isConnected, isSpeaking, current, aiSlides])

  // On mount, load slideshow + narrator context + uploaded material summaries
  useEffect(() => {
    const loadSessionData = async () => {
      try {
        const [slides, narratorContext] = await Promise.all([
          getSessionSlides(),
          getNarratorContext(),
        ])
        if (slides.length > 0) setAiSlides(slides)
        if (narratorContext) narratorContextRef.current = narratorContext
      } catch (error) {
        console.error('Failed to load slideshow session data:', error)
      }

      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
        const response = await fetch(`${backendUrl}/session/context`)
        if (response.ok) {
          const data = (await response.json()) as SessionContextData
          sessionDataRef.current = data
        }
      } catch (error) {
        console.error('Failed to load session context:', error)
      }
    }

    loadSessionData()
  }, [])

  const handleToggleNarration = async () => {
    if (isConnected) {
      await conversation.endSession()
      return
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      const agentId = process.env.NEXT_PUBLIC_ELEVEN_LABS_NARRATOR_AGENT_ID
      if (!agentId) {
        alert('Narrator Agent ID not configured. Set NEXT_PUBLIC_ELEVEN_LABS_NARRATOR_AGENT_ID in .env.local')
        return
      }
      await conversation.startSession({ agentId, connectionType: 'webrtc' })
    } catch (error) {
      console.error('Failed to start narration:', error)
    }
  }

  const navigateTo = (index: number) => {
    setCurrent(index)
  }

  const handleRouteWithWipe = (path: string) => {
    setIsWipingForward(true)
    setTimeout(() => {
      router.push(path)
    }, 600)
  }

  const slideCount = aiSlides ? aiSlides.length : hardcodedSlides.length
  const currentAiSlide = aiSlides ? aiSlides[current] : null
  const currentHardSlide = !aiSlides ? hardcodedSlides[current] : null

  const title = currentAiSlide?.title ?? currentHardSlide?.title ?? ''
  const subtitle = currentAiSlide?.subtitle ?? currentHardSlide?.subtitle
  const keywords = currentAiSlide?.keywords ?? currentHardSlide?.keywords ?? []
  const theorem = currentAiSlide?.theorem ?? currentHardSlide?.theorem

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden relative" style={{ backgroundColor: '#FBF6EC', fontFamily: 'Georgia, serif' }}>

      {/* Wipe Away Layer on Page Load */}
      <div
        className={`fixed top-0 left-0 w-[100vw] h-[100vh] z-[9999] bg-[#5A5145] transition-transform duration-700 ease-[cubic-bezier(0.77,0,0.175,1)] pointer-events-none ${isWipingAway ? 'translate-x-[100%]' : 'translate-x-0'}`}
      />

      {/* Wipe Forward Layer for Next Page */}
      <div
        className={`fixed top-0 left-0 w-[100vw] h-[100vh] z-[9999] bg-[#5A5145] transition-transform duration-[600ms] ease-[cubic-bezier(0.77,0,0.175,1)] pointer-events-none ${isWipingForward ? 'translate-x-0' : '-translate-x-full'}`}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-12 py-5 border-b" style={{ borderColor: '#e6d1ad' }}>
        <BrandLogo className="w-32" />
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: '#8b6b48', fontFamily: 'sans-serif' }}>
            {current + 1} / {slideCount}
          </span>
        </div>
      </header>

      {/* Main slide content with side arrows */}
      <div className="flex-1 flex items-stretch relative">

        {/* Left arrow */}
        <button
          onClick={() => navigateTo(current - 1)}
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
            <h1 className="text-6xl font-normal tracking-tight mb-2" style={{ color: '#2a1d10' }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-lg font-normal italic" style={{ color: '#6b5339' }}>
                {subtitle}
              </p>
            )}
          </div>

          {/* Diagram + right column */}
          <div className="flex flex-col lg:flex-row items-stretch gap-12 w-full flex-1">

            {/* Diagram */}
            <div
              className="w-full lg:w-[26rem] rounded-2xl flex items-center justify-center shrink-0 p-4"
              style={{ backgroundColor: '#f6ecd9', border: '1px solid #e6d1ad' }}
            >
              {current === 0 ? (
                <img
                  src="/derivatives_rules.png"
                  alt="Rules of Derivatives"
                  className="w-full h-full object-contain rounded-xl mix-blend-multiply"
                />
              ) : current === 1 ? (
                <img
                  src="/derivative_graph.png"
                  alt="Constant Derivative Graph"
                  className="w-full h-full object-contain rounded-xl mix-blend-multiply"
                />
              ) : current === 2 ? (
                <img
                  src="/power_rule_example.png"
                  alt="Power Rule Example"
                  className="w-full h-full object-contain rounded-xl mix-blend-multiply"
                />
              ) : current === 3 ? (
                <img
                  src="/power_rule_graph.png"
                  alt="Power Rule Graph"
                  className="w-full h-full object-contain rounded-xl mix-blend-multiply"
                />
              ) : currentAiSlide ? (
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
                        fallback.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8b6b48;font-family:Georgia,serif;font-style:italic;font-size:14px'
                        fallback.textContent = 'No diagram available'
                        parent.appendChild(fallback)
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ color: '#8b6b48', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '14px' }}>
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
                <div className="rounded-xl px-7 py-5" style={{ backgroundColor: '#f6ecd9', border: '1px solid #e6d1ad' }}>
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#6b5339', fontFamily: 'sans-serif' }}>
                    {theorem.label}
                  </p>
                  {currentAiSlide ? (
                    <div
                      style={{ color: '#2a1d10', fontSize: '1.4rem' }}
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
                    <p className="text-2xl" style={{ color: '#2a1d10', fontFamily: 'Georgia, serif' }}>
                      {theorem.formula}
                    </p>
                  )}
                </div>
              )}

              {/* Keywords */}
              <div className="flex flex-col gap-3">
                {keywords.map((kw) => (
                  <div key={kw} className="flex items-center gap-4">
                    <div className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: '#8b6b48' }} />
                    <span className="text-lg" style={{ color: '#5A5145' }}>{kw}</span>
                  </div>
                ))}
              </div>

              {/* Debug: exact instruction/script sent to ElevenLabs */}
              {currentAiSlide?.script && (
                <div className="rounded-xl px-5 py-4" style={{ backgroundColor: '#FBF6EC', border: '1px dashed #e6d1ad' }}>
                  <p className="text-[11px] uppercase tracking-widest mb-2" style={{ color: '#6b5339', fontFamily: 'sans-serif' }}>
                    Narration Debug
                  </p>
                  <pre className="whitespace-pre-wrap text-xs leading-5" style={{ color: '#5A5145', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {`Read this aloud exactly as written:\n${currentAiSlide.script}`}
                  </pre>
                </div>
              )}


            </div>
          </div>
        </main>

        {/* Right arrow */}
        <button
          onClick={() => navigateTo(current + 1)}
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
      <footer className="flex items-center justify-between px-8 py-7 border-t" style={{ borderColor: '#e6d1ad' }}>

        {/* Return to Generation */}
        <button
          onClick={() => handleRouteWithWipe('/record')}
          className="cta-button text-sm"
        >
          <span className="relative z-10">← Return to Generation</span>
        </button>

        {/* Center: mic button + dots */}
        <div className="flex flex-col items-center gap-3">

          {/* Mic / stop button — same format as whiteboard */}
          <button
            onClick={handleToggleNarration}
            disabled={status === 'connecting'}
            className={`rounded-2xl border transition-all duration-300 shadow-sm overflow-hidden ${isConnected
              ? isSpeaking
                ? 'bg-[#D93D3D] border-[#D93D3D]'
                : 'bg-white border-[#D93D3D]'
              : status === 'connecting'
                ? 'bg-[#F6F4EE] border-[#E0D5C5] cursor-not-allowed'
                : 'bg-white border-[#E0D5C5] hover:border-[#D93D3D] hover:shadow-md'
              }`}
          >
            <div className="flex items-center gap-4 p-4">
              <div className={`relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isConnected ? (isSpeaking ? 'bg-white/20' : 'bg-[#D93D3D]/10') : 'bg-[#D93D3D]/10'
                }`}>
                {status === 'connecting' ? (
                  <Loader2 className="w-5 h-5 text-[#8B7355] animate-spin" />
                ) : isConnected ? (
                  <Mic className={`w-5 h-5 ${isSpeaking ? 'text-white animate-pulse' : 'text-[#D93D3D]'}`} />
                ) : (
                  <MicOff className="w-5 h-5 text-[#D93D3D]" />
                )}
                {isSpeaking && (
                  <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
                )}
              </div>
              <div className="text-left">
                <p className={`text-[10px] font-black uppercase tracking-widest ${isConnected ? (isSpeaking ? 'text-white' : 'text-[#D93D3D]') : 'text-[#8b6b48]'
                  }`}>
                  {status === 'connecting' ? 'Connecting...'
                    : isConnected ? (isSpeaking ? 'Narrating' : 'Listening')
                      : 'Start Narration'}
                </p>
                <p className={`text-xs mt-0.5 ${isConnected ? (isSpeaking ? 'text-white/70' : 'text-[#8b6b48]') : 'text-[#6b5339]'
                  }`}>
                  {status === 'connecting' ? 'Please wait...'
                    : isConnected ? 'Click to end'
                      : 'Click to begin'}
                </p>
              </div>
              {isSpeaking && (
                <div className="ml-auto flex items-end gap-0.5 h-5">
                  <div className="w-1 h-2 bg-white/80 rounded-full animate-[bounce_0.6s_infinite]" />
                  <div className="w-1 h-4 bg-white/80 rounded-full animate-[bounce_0.8s_infinite]" />
                  <div className="w-1 h-3 bg-white/80 rounded-full animate-[bounce_0.7s_infinite]" />
                  <div className="w-1 h-5 bg-white/80 rounded-full animate-[bounce_0.9s_infinite]" />
                </div>
              )}
            </div>
          </button>

          {/* Dots */}
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
                    onClick={() => navigateTo(i)}
                    style={{
                      flexShrink: 0,
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: i === current ? '#8b6b48' : '#e6d1ad',
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
        </div>

        {/* Proceed to Problems */}
        <button
          onClick={() => handleRouteWithWipe('/whiteboard')}
          className="cta-button text-sm"
        >
          <span className="relative z-10">Proceed to Problems →</span>
        </button>
      </footer>

      {/* Inject CTA Button Styles globally for this page as well */}
      <style jsx>{`
        .cta-button {
          display: inline-block;
          padding: 0.625rem 2rem;
          border-radius: 9999px;
          background-color: transparent;
          color: #5A5145;
          border: 2px solid #5A5145;
          font-family: Georgia, "Times New Roman", serif;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }

        .cta-button::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: #5A5145;
          transform: translateX(-101%);
          transition: transform 0.4s cubic-bezier(0.19, 1, 0.22, 1);
          z-index: 0;
        }

        .cta-button:hover {
          color: #F6F4EE;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(90, 81, 69, 0.15);
        }

        .cta-button:active {
          transform: translateY(0);
          box-shadow: 0 5px 10px rgba(90, 81, 69, 0.1);
        }

        .cta-button:hover::before {
          transform: translateX(0);
        }

        .cta-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        
        .cta-button:disabled::before {
          transform: translateX(-101%);
        }
      `}</style>
    </div>
  )
}
