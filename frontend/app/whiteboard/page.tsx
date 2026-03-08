'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import TldrawBoard, { TldrawBoardHandle } from '@/components/TldrawBoard'
import { analyzeWhiteboard, AnalysisResponse } from '@/lib/whiteboard-api'
import BrandLogo from '@/components/BrandLogo'
import { Loader2, MessageSquare, AlertCircle, Mic, MicOff, ChevronDown, ChevronUp, PartyPopper, CheckCircle } from 'lucide-react'
import LatexRenderer from '@/components/LatexRenderer'
import confetti from 'canvas-confetti'
import { useConversation } from '@elevenlabs/react'

export function normalizeProblemMath(text: string): string {
  if (!text) return text

  // ── 1. Mask existing LaTeX so we never modify it ──────────────────
  const latexPattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g
  const latexBlocks: string[] = []
  let masked = text.replace(latexPattern, (m) => {
    const token = `\x00LATEX${latexBlocks.length}\x00`
    latexBlocks.push(m)
    return token
  })

  // ── 2. Normalise symbolic integral character ──────────────────────
  masked = masked
    .replace(/\[\s*integral symbol\s*\]/gi, '∫')
    .replace(/\bintegral symbol\b/gi, '∫')

  // Helper: ensure expression is parenthesised
  const wrapExpr = (expr: string) => {
    const cleaned = expr.trim().replace(/\s*dx\s*$/i, '').trim()
    return /^\(.+\)$/.test(cleaned) ? cleaned : `(${cleaned})`
  }

  // ── 3. Prose integrals → LaTeX ────────────────────────────────────

  // "integral of ∫(2x+3)dx from 0 to 4"  (mixed prose + symbol)
  masked = masked.replace(
    /\bintegral\s+of\s*∫?\s*(.+?)\s*dx\s+from\s+(\S+)\s+to\s+(\S+)/gi,
    (_, expr, lo, hi) => `$\\int_{${lo}}^{${hi}} ${wrapExpr(expr)}\\,dx$`
  )

  // "definite integral of ... from ... to ..."
  masked = masked.replace(
    /\b(?:the\s+)?definite\s+integral\s+of\s+(.+?)\s+from\s+(\S+)\s+to\s+(\S+)/gi,
    (_, expr, lo, hi) => `$\\int_{${lo}}^{${hi}} ${wrapExpr(expr)}\\,dx$`
  )

  // "∫(2x+3)dx from 0 to 4" (symbol only, no prose prefix)
  masked = masked.replace(
    /∫\s*(.+?)\s*dx\s+from\s+(\S+)\s+to\s+(\S+)/gi,
    (_, expr, lo, hi) => `$\\int_{${lo}}^{${hi}} ${wrapExpr(expr)}\\,dx$`
  )

  // "integral of f(x)" (indefinite, no bounds)
  masked = masked.replace(
    /\b(?:the\s+)?integral\s+of\s+(.+?)(?=[,.;!?]|$)/gi,
    (_, expr) => `$\\int ${wrapExpr(expr)}\\,dx$`
  )

  // ── 4. Caret exponents (x^2 → $x^{2}$)  — ONE pass only ─────────
  // Skip anything already inside a LaTeX block (starts with \x00) or
  // preceded by \ or $.
  masked = masked.replace(
    /(^|[^\\$\x00])([A-Za-z])\s*\^\s*(-?\d+)\b/gm,
    (_, prefix, base, exp) => `${prefix}$${base}^{${exp}}$`
  )

  // ── 5. Restore masked LaTeX blocks ────────────────────────────────
  let result = masked.replace(/\x00LATEX(\d+)\x00/g, (_, idx) => latexBlocks[Number(idx)] ?? '')

  // ── 6. Cleanup pass: fix accidental adjacent / nested $$ ──────────
  // Merge "$...$  $...$" that sit right next to each other into one block
  // and collapse "$$" inside inline math.
  result = result
    .replace(/\$\s*\$/g, ' ')          // empty $$ pairs → space
    .replace(/\${3,}/g, '$$')           // $$$ or more → $$

  return result
}

function applySmartLineBreaks(text: string): string {
  if (!text) return text

  const NBSP = '\u00A0'
  const latexPattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g
  const latexBlocks: string[] = []
  const masked = text.replace(latexPattern, (m) => {
    const token = `__LATEX_BLOCK_${latexBlocks.length}__`
    latexBlocks.push(m)
    return token
  })

  let out = masked

  // Keep common multi-word math phrases together.
  const protectedPhrases = [
    'Riemann sum',
    'right endpoints',
    'left endpoints',
    'sample points',
    'limit definition',
    'definite integral',
    'partial sums',
  ]
  for (const phrase of protectedPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (m) =>
      m.replace(/ /g, NBSP)
    )
  }

  // Keep "from a to b" together when it appears in prose.
  out = out.replace(
    /\bfrom\s+([^\s,.;!?]+)\s+to\s+([^\s,.;!?]+)\b/gi,
    (_m, a: string, b: string) => `from${NBSP}${a}${NBSP}to${NBSP}${b}`
  )

  // Restore original LaTeX blocks; these are already unbreakable tokens visually.
  out = out.replace(/__LATEX_BLOCK_(\d+)__/g, (_, idx: string) => {
    const block = latexBlocks[Number(idx)]
    return block ?? ''
  })

  return out
}

interface StudentModel {
  mastered_concepts: string[]
  struggling_concepts: string[]
  mistake_patterns: Record<string, number>
  problems_solved: number
  skill_ratings?: Record<string, {
    title: string
    rating: number
    attempts: number
    correct: number
    minor_errors: number
    major_errors: number
  }>
}

export default function WhiteboardPage() {
  const boardRef = useRef<TldrawBoardHandle>(null)
  const [isWipingAway, setIsWipingAway] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [feedback, setFeedback] = useState<AnalysisResponse | null>(null)
  const [transcript, setTranscript] = useState<{ role: 'user' | 'agent', text: string }[]>([])
  const [currentQuestion, setCurrentQuestion] = useState("What are we working on today?")
  const [studentModel, setStudentModel] = useState<StudentModel | null>(null)
  const [isProgressOpen, setIsProgressOpen] = useState(false)
  const [isProblemOpen, setIsProblemOpen] = useState(true)
  const [hasSolvedCurrent, setHasSolvedCurrent] = useState(false)
  const [showNextConfirm, setShowNextConfirm] = useState(false)
  const [isSessionComplete, setIsSessionComplete] = useState(false)
  const [sessionData, setSessionData] = useState<any>(null)
  const sessionRef = useRef<any>(null)
  // Queue: stores whiteboard analysis if Artie wasn't connected when it arrived
  const pendingObservationRef = useRef<string | null>(null)
  // Always holds the most recent analysis so we can re-inject when the student speaks
  const latestAnalysisRef = useRef<string | null>(null)
  // Ref to sendContextualUpdate so we can call it from onMessage without stale closures
  const sendUpdateRef = useRef<((text: string) => void) | null>(null)
  // Prevents sending duplicate identical snapshots to Gemini
  const lastSnapshotRef = useRef<string | null>(null)

  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const displayQuestion = useMemo(
    () => applySmartLineBreaks(normalizeProblemMath(currentQuestion)),
    [currentQuestion]
  )
  const hasStudentData = !!studentModel && (
    studentModel.mastered_concepts.length > 0 ||
    studentModel.struggling_concepts.length > 0 ||
    Object.keys(studentModel.mistake_patterns).length > 0 ||
    Object.keys(studentModel.skill_ratings || {}).length > 0
  )

  // Auto-scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript, feedback])

  // Trigger chalk wipe in on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsWipingAway(true)
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // Fetch session context on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/session/context`)
        const data = await response.json()
        setSessionData(data)
        sessionRef.current = data
        if (data.current_problem) {
          setCurrentQuestion(data.current_problem)
        }
      } catch (error) {
        console.error("Failed to fetch session context:", error)
      }
    }
    fetchSession()
    fetchStudentModel()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStudentModel = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/student-model`)
      if (res.ok) setStudentModel(await res.json())
    } catch { /* silent */ }
  }

  // ElevenLabs Conversation Hook
  const conversation = useConversation({
    onConnect: () => {
      console.log('Connected to ElevenLabs')
      const currentData = sessionRef.current
      if (currentData) {
        const fileContext = (currentData.file_summaries || []).map((f: any) => `- ${f.filename}: ${f.summary}`).join('\n')
        const fullContext = `Context: The student is working on the problem: "${currentData.current_problem}". Background materials they've uploaded:\n${fileContext}\n
You are watching their whiteboard. Greet them and mention you're ready to help with this specific problem.

CRITICAL INSTRUCTION: You must be extremely comfortable with silence. Students need time to think and solve math! If you ask a question and do not receive an immediate response, do NOT ask follow-up questions like "Are you there?", "Hello?", or "Did you hear me?". Simply wait patiently for as long as it takes until they draw something or speak to you.`
        console.log('Sending initial context to Artie:', fullContext)
        conversation.sendContextualUpdate(fullContext)
      }
    },
    onDisconnect: () => console.log('Disconnected from ElevenLabs'),
    onMessage: (message) => {
      console.log('Received message:', message)
      if (message.source === 'ai' && message.message) {
        const sanitizedText = message.message.replace(/\[.*?\]/g, '').trim()
        setTranscript(prev => [...prev, { role: 'agent', text: sanitizedText }])
      } else if (message.source === 'user' && message.message) {
        // Hide our internal system prompts from the visible chat transcript
        if (!message.message.includes('[WHITEBOARD UPDATE') && !message.message.includes('[CURRENT WHITEBOARD STATE')) {
          setTranscript(prev => [...prev, { role: 'user', text: message.message }])
        }

        // Detect help requests and penalise the skill rating accordingly
        const helpRe = /\b(help|hint|stuck|don'?t know|not sure|confused|explain|tell me|what (is|do|should)|how (do|should|does)|can you (show|tell|explain)|i give up|no idea)\b/i
        if (helpRe.test(message.message)) {
          fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/student-model/help-request`, { method: 'POST' })
            .then(() => fetchStudentModel())
            .catch(() => {/* silent */})
        }

        // Re-inject latest whiteboard state right before Artie responds
        const latest = latestAnalysisRef.current
        if (latest && sendUpdateRef.current) {
          sendUpdateRef.current(latest)
        }
      }
    },
    onError: (error) => console.error('ElevenLabs Error:', error),
  })

  // We destructure sendUserMessage to forcefully interrupt Artie mid-sentence
  const { status, isSpeaking, sendContextualUpdate, sendUserMessage } = conversation
  const isConnected = status === 'connected'

  const proceedToNext = async () => {
    setShowNextConfirm(false)
    setHasSolvedCurrent(false)
    setFeedback(null)
    // If we're on the last problem, complete the session
    if (sessionData && sessionData.current_problem_index === sessionData.practice_problems.length - 1) {
      triggerSessionComplete()
      return
    }

    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/problem/next`, { method: 'POST' })
    const data = await res.json()
    setCurrentQuestion(data.current_problem)
    setSessionData({ ...sessionData, current_problem_index: data.current_problem_index, current_problem: data.current_problem })
    boardRef.current?.clearBoard()
    lastSnapshotRef.current = null
    if (isConnected) sendContextualUpdate(`The student has moved ON to the next problem: "${data.current_problem}". Please help them with this completely new problem now.`)
  }

  const triggerSessionComplete = () => {
    setIsSessionComplete(true)
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#D93D3D', '#8B7355', '#E0D5C5']
    })
    if (isConnected) {
      sendContextualUpdate(`The student has successfully completed ALL their practice problems for this study session! Congratulate them enthusiastically for their hard work!`)
    }
  }

  // Keep sendUpdateRef in sync so onMessage can call it without stale closure
  useEffect(() => { sendUpdateRef.current = sendContextualUpdate }, [sendContextualUpdate])

  // Proactive Context Injection: fires when BOTH connected and session data ready
  // Also flushes any pending observation that arrived before connection
  useEffect(() => {
    if (!isConnected) return
    if (sessionData) {
      const fileContext = sessionData.file_summaries
        .map((f: any) => `  • ${f.filename}: ${f.summary}`)
        .join('\n')
      const fullContext = `CONTEXT UPDATE — read carefully and do not hallucinate:

PROBLEM THE STUDENT IS SOLVING: "${sessionData.current_problem}"

UPLOADED STUDY MATERIALS (background reference only — this is NOT the whiteboard):
${fileContext || '  (none uploaded)'}

WHITEBOARD STATUS: The whiteboard is currently BLANK. The student has not written anything yet.
- Do NOT describe any whiteboard content until you receive a [WHITEBOARD UPDATE] message.
- When you receive [WHITEBOARD UPDATE], immediately comment on what the student wrote.
- DO NOT invent or assume any whiteboard content from the study materials.

TUTORING RULES — follow these strictly at all times:
1. NEVER give the final answer directly. If the student asks "what's the answer?", redirect with a guiding question.
2. ALWAYS build on what the student has already written. Acknowledge their progress first.
3. Ask ONE guiding question at a time to nudge them to the next step.
4. If they made a mistake, point out WHERE the error is and ask THEM how they'd fix it — don't fix it for them.
5. Praise effort and partial progress genuinely.
6. Your goal is for the student to discover the answer themselves with your guidance.
7. PATIENCE DURING SILENCE: If the student is quiet, assume they are thinking or writing on the whiteboard. DO NOT ask "Are you still there?" or interrupt their silence. Wait patiently for them to speak or for a [WHITEBOARD UPDATE].

Greet the student, mention the specific problem, and ask them where they'd like to start.`
      sendContextualUpdate(fullContext)
    }
    // Flush any observation that was queued while Artie was offline
    const pending = pendingObservationRef.current
    if (pending) {
      pendingObservationRef.current = null
      // Small delay so greeting fires first
      setTimeout(() => sendContextualUpdate(pending), 1500)
    }
  }, [isConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVoice = useCallback(async () => {
    if (isConnected) {
      await conversation.endSession()
    } else {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
        const agentId = process.env.NEXT_PUBLIC_ELEVEN_LABS_AGENT_ID
        if (!agentId) {
          alert('ElevenLabs Agent ID not found in environment variables.')
          return
        }

        // Build context so the isConnected useEffect can inject it after connection
        // (overrides are not supported on this ElevenLabs plan — they crash LiveKit)
        const currentData = sessionRef.current
        const problem = currentData?.current_problem || currentQuestion

        // Store problem in ref so the onConnect useEffect can pick it up
        sessionRef.current = { ...(sessionRef.current || {}), _pendingGreeting: problem }

        await conversation.startSession({
          agentId: agentId,
          connectionType: 'webrtc',
        })
      } catch (error) {
        console.error('Failed to start conversation:', error)
        alert('Could not access microphone. Please check permissions.')
      }
    }
  }, [isConnected, conversation])

  const handleStrokeEnd = async (snapshot: { base64: string }) => {
    // Prevent duplicate analysis if the whiteboard hasn't visually changed
    if (snapshot.base64 === lastSnapshotRef.current) {
      console.log('Skipping analysis: Whiteboard unchanged.')
      return
    }

    lastSnapshotRef.current = snapshot.base64
    setIsAnalyzing(true)
    try {
      const result = await analyzeWhiteboard(snapshot.base64, currentQuestion)
      setFeedback(result)
      if (result.isSolved) {
        setHasSolvedCurrent(true)
      }

      let promptStatus = '✅ ON TRACK'
      if (result.hasMistake) promptStatus = '⚠️ MISTAKE DETECTED'
      if (result.isSolved) promptStatus = '🏆 CORRECT ANSWER ACHIEVED'

      const observation = `[WHITEBOARD UPDATE]
STATUS: ${promptStatus}
VISUAL ANALYSIS: ${result.feedback}
${result.hasMistake ? `ERROR: ${result.mistakeDescription}` : ''}`

      // Always store the background visual context for regular chit-chat
      latestAnalysisRef.current = `[CURRENT WHITEBOARD STATE (Background Data)]
STATUS: ${promptStatus}
VISUAL ANALYSIS: ${result.feedback}
${result.hasMistake ? `ERROR: ${result.mistakeDescription}` : ''}
Use this context to understand what is currently on the board if the student talks about their work.`

      // Fetch updated student model (includes fresh remediation state from backend)
      const smRes = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/student-model`).catch(() => null)
      const freshModel: StudentModel | null = smRes?.ok ? await smRes.json() : null
      if (freshModel) setStudentModel(freshModel)

      let aiInstruction = "\n\nINSTRUCTION: The student just added this to the whiteboard. If you were speaking, gracefully halt and immediately pivot to address this new development. Do not repeat exactly what you were saying before. Acknowledge what they wrote contextually."

      if (result.isSolved) {
        aiInstruction = "\n\nINSTRUCTION: INCREDIBLE! The student has just successfully SOLVED the entire problem and got the final correct answer! You must immediately and enthusiastically congratulate them by name or say 'Congrats you got the correct answer!' Celebrate this victory!"
      } else if (result.hasMistake) {
        aiInstruction = "\n\nINSTRUCTION: The student just made a mathematical mistake on the board. Gently and politely point out where they went wrong based on the analysis, and ask a guiding question to help them fix it."
      }

      if (isConnected) {
        // We interrupt Artie by sending the visual observation as a system event.
        // Because ElevenLabs is the main conversational LLM, it will naturally
        // halt its current output, process this new information, and dynamically pivot!
        sendUserMessage(observation + aiInstruction)
      } else {
        // Artie offline — queue for next connection
        pendingObservationRef.current = observation + aiInstruction
        console.log('Artie offline — observation queued for next connection.')
      }

      if (result.coordinates) {
        boardRef.current?.pointTo(result.coordinates.x, result.coordinates.y)
      }
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="flex w-screen h-screen bg-[#FAF6EF] overflow-hidden font-serif relative">
      {/* Session Complete Overlay */}
      {isSessionComplete && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#FAF6EF]/90 backdrop-blur-sm transition-all duration-500">
          <div className="bg-white p-10 rounded-3xl shadow-xl border border-[#E0D5C5] text-center max-w-md mx-4 transform animate-in zoom-in-95 duration-300">
            <div className="mx-auto w-16 h-16 bg-[#D93D3D]/10 rounded-full flex items-center justify-center mb-6">
              <PartyPopper className="w-8 h-8 text-[#D93D3D]" />
            </div>
            <h1 className="text-3xl font-black text-[#3D2F1E] mb-3">Session Complete!</h1>
            <p className="text-[#8B7355] mb-8 leading-relaxed">
              Incredible work today. You've successfully finished all the practice problems for this section and demonstrated a solid understanding of the material.
            </p>
            <button
              onClick={() => window.location.href = '/'}
              className="w-full py-4 bg-[#3D2F1E] hover:bg-[#2A2015] text-white rounded-xl font-bold uppercase tracking-widest text-xs transition-colors shadow-sm"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Wipe Away Layer on Page Load */}
      <div
        className={`fixed top-0 left-0 w-[100vw] h-[100vh] z-[9999] bg-[#5A5145] transition-transform duration-700 ease-[cubic-bezier(0.77,0,0.175,1)] pointer-events-none ${isWipingAway ? 'translate-x-[100%]' : 'translate-x-0'}`}
      />

      {/* Main Whiteboard Area */}
      <div className="flex-1 relative flex flex-col">
        {/* Brand Header */}
        <div className="absolute top-6 left-8 z-20 flex items-center gap-2">
          <BrandLogo variant="mark" className="w-5 h-5 opacity-70" />
          <span className="text-[10px] font-black text-[#A08060] uppercase tracking-[0.3em] opacity-40">
            Whiteboard
          </span>
        </div>
        {/* Status Indicator */}
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          {isAnalyzing && (
            <div className="flex items-center gap-2 bg-[#FAF6EF]/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-[#E0D5C5] shadow-sm animate-pulse">
              <Loader2 className="w-3.5 h-3.5 text-[#D93D3D] animate-spin" />
              <span className="text-[10px] font-bold text-[#8B7355] uppercase tracking-widest">Thinking</span>
            </div>
          )}
        </div>

        <TldrawBoard
          ref={boardRef}
          onStrokeEnd={handleStrokeEnd}
          strokeEndDebounceMs={500}
        />
      </div>

      {/* Right Sidebar */}
      <div className="w-[350px] border-l border-[#E0D5C5] flex flex-col bg-[#F6F4EE]">

        {/* Question Box */}
        <div className="bg-[#FAF6EF] border-b border-[#E0D5C5]">
          <button
            onClick={() => setIsProblemOpen(!isProblemOpen)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#E0D5C5]/20 transition-colors"
          >
            <h2 className="text-[10px] font-black text-[#8B7355] uppercase tracking-[0.2em]">
              Current Problem {sessionData?.practice_problems && sessionData.practice_problems.length > 0 ? `(${sessionData.current_problem_index + 1} of ${sessionData.practice_problems.length})` : ''}
            </h2>
            {isProblemOpen ? (
              <ChevronUp className="w-4 h-4 text-[#8B7355] opacity-60" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#8B7355] opacity-60" />
            )}
          </button>

          <div
            className={`px-6 overflow-hidden transition-all duration-300 ease-in-out ${isProblemOpen ? 'max-h-[400px] pb-4 opacity-100' : 'max-h-0 pb-0 opacity-0'
              }`}
          >
            <div className="h-[130px] overflow-y-auto overflow-x-hidden custom-scrollbar p-4 bg-white border border-[#E0D5C5] rounded-2xl shadow-sm">
              <div className="min-h-full flex items-center justify-center">
                <p className="text-[#3D2F1E] font-medium text-base leading-relaxed text-center">
                  <LatexRenderer>{displayQuestion}</LatexRenderer>
                </p>
              </div>
            </div>

            {sessionData?.practice_problems && sessionData.practice_problems.length > 1 && (
              <div className="mt-4 flex flex-col gap-3">
                {showNextConfirm ? (
                  <div className="flex flex-col gap-2 p-3 bg-[#FAF6EF] border border-[#E0D5C5] rounded-xl text-center">
                    <p className="text-xs text-[#8B7355] font-medium leading-tight">
                      Are you sure? You haven't solved this problem yet, and they build on each other!
                    </p>
                    <div className="flex gap-2 justify-center mt-1">
                      <button onClick={() => setShowNextConfirm(false)} className="flex-1 py-1.5 px-3 text-[10px] font-black text-[#8B7355] hover:bg-[#E0D5C5]/20 border border-[#E0D5C5] uppercase tracking-wider rounded-lg transition-all">Go Back</button>
                      <button onClick={proceedToNext} className="flex-1 py-1.5 px-3 text-[10px] font-black text-white hover:bg-[#c13636] bg-[#D93D3D] uppercase tracking-wider rounded-lg transition-all">Continue Anyway</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button
                      disabled={sessionData.current_problem_index === 0}
                      onClick={async () => {
                        setHasSolvedCurrent(false)
                        setFeedback(null)
                        setShowNextConfirm(false)
                        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/problem/prev`, { method: 'POST' })
                        const data = await res.json()
                        setCurrentQuestion(data.current_problem)
                        setSessionData({ ...sessionData, current_problem_index: data.current_problem_index, current_problem: data.current_problem })
                        boardRef.current?.clearBoard()
                        lastSnapshotRef.current = null
                        if (isConnected) sendContextualUpdate(`The student has moved BACK to a previous problem: "${data.current_problem}". Please help them with this one now.`)
                      }}
                      className="flex-1 py-2 px-3 text-[10px] font-black text-[#8B7355] uppercase tracking-wider border border-[#E0D5C5] rounded-xl hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-all shadow-sm"
                    >
                      Previous
                    </button>
                    {sessionData.current_problem_index === sessionData.practice_problems.length - 1 ? (
                      <button
                        onClick={() => {
                          if (!hasSolvedCurrent) {
                            setShowNextConfirm(true)
                            return
                          }
                          proceedToNext()
                        }}
                        className="flex-1 py-2 px-3 text-[10px] font-black text-white bg-[#428751] hover:bg-[#32693e] uppercase tracking-wider rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"
                      >
                        <PartyPopper className="w-3 h-3" /> Complete Session
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (!hasSolvedCurrent) {
                            setShowNextConfirm(true)
                            return
                          }
                          proceedToNext()
                        }}
                        className="flex-1 py-2 px-3 text-[10px] font-black text-white bg-[#D93D3D] hover:bg-[#c13636] uppercase tracking-wider rounded-xl transition-all shadow-sm"
                      >
                        Next Problem
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* AI Description & Responses */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          <h2 className="text-[10px] font-black text-[#8B7355] uppercase tracking-[0.2em] mb-4">Tutor Interaction</h2>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar mb-4">
            {transcript.length === 0 && !feedback && (
              <div className="bg-white p-5 rounded-2xl border border-[#E0D5C5] shadow-sm italic text-center">
                <p className="text-sm text-[#8B7355] leading-relaxed">
                  "I'm keeping an eye on your progress. Feel free to start anytime."
                </p>
              </div>
            )}

            {/* Transcript Messages */}
            {transcript.map((msg, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-2xl border animate-in slide-in-from-bottom-2 duration-300 shadow-sm ${msg.role === 'agent'
                  ? 'bg-white border-[#E0D5C5] text-[#3D2F1E] mr-4'
                  : 'bg-[#FAF6EF] border-[#E0D5C5] text-[#3D2F1E] ml-4 border-dashed opacity-80 self-end'
                  }`}
              >
                <div className={`flex items-start gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${msg.role === 'agent' ? 'text-[#D93D3D]' : 'text-[#8B7355]'}`}>
                    {msg.role === 'agent' ? 'Artie' : 'You'}
                  </span>
                </div>
                <p className={`text-sm mt-1 leading-relaxed ${msg.role === 'user' ? 'text-right' : ''}`}>{msg.text}</p>
              </div>
            ))}

            {feedback && (
              <div className={`p-5 rounded-2xl border animate-in slide-in-from-bottom-2 duration-300 shadow-sm ${feedback.hasMistake
                ? 'bg-red-50 border-[#D93D3D]/50 text-[#D93D3D]'
                : feedback.isSolved
                  ? 'bg-green-50 border-[#428751]/50 text-[#428751]'
                  : 'bg-white border-[#E0D5C5] text-[#3D2F1E]'
                }`}>
                <div className="flex items-start gap-3">
                  {feedback.hasMistake ? (
                    <AlertCircle className="w-5 h-5 shrink-0 text-[#D93D3D]" />
                  ) : feedback.isSolved ? (
                    <CheckCircle className="w-5 h-5 shrink-0 text-[#428751]" />
                  ) : (
                    <MessageSquare className="w-5 h-5 shrink-0 text-[#8B7355]" />
                  )}
                  <div>
                    <p className={`font-bold text-[10px] uppercase tracking-widest mb-2 opacity-80 ${feedback.hasMistake ? 'text-[#D93D3D]' : feedback.isSolved ? 'text-[#428751]' : 'text-[#8B7355]'
                      }`}>
                      {feedback.hasMistake ? 'Mistake Spotted' : feedback.isSolved ? 'Correct Answer!' : 'Observation'}
                    </p>
                    <p className="text-sm leading-relaxed text-[#3D2F1E]">{feedback.feedback}</p>
                  </div>
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Unified Artie Panel — replaces floating mic button */}
          <button
            onClick={toggleVoice}
            disabled={status === 'connecting'}
            className={`w-full rounded-2xl border transition-all duration-300 shadow-sm overflow-hidden ${isConnected
              ? isSpeaking
                ? 'bg-[#D93D3D] border-[#D93D3D]'
                : 'bg-white border-[#D93D3D]'
              : status === 'connecting'
                ? 'bg-[#F6F4EE] border-[#E0D5C5] cursor-not-allowed'
                : 'bg-white border-[#E0D5C5] hover:border-[#D93D3D] hover:shadow-md'
              }`}
          >
            <div className="flex items-center gap-4 p-4">
              {/* Icon */}
              <div className={`relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isConnected ? (isSpeaking ? 'bg-white/20' : 'bg-[#D93D3D]/10') : 'bg-[#D93D3D]/10'
                }`}>
                {status === 'connecting' ? (
                  <Loader2 className="w-5 h-5 text-[#8B7355] animate-spin" />
                ) : isConnected ? (
                  <Mic className={`w-5 h-5 ${isSpeaking ? 'text-white animate-pulse' : 'text-[#D93D3D]'}`} />
                ) : (
                  <MicOff className="w-5 h-5 text-[#D93D3D]" />
                )}
                {/* Ping ring when speaking */}
                {isSpeaking && (
                  <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
                )}
              </div>

              {/* Text */}
              <div className="text-left">
                <p className={`text-[10px] font-black uppercase tracking-widest ${isConnected ? (isSpeaking ? 'text-white' : 'text-[#D93D3D]') : 'text-[#8B7355]'
                  }`}>
                  {status === 'connecting' ? 'Connecting...'
                    : isConnected
                      ? (isSpeaking ? 'Artie is Speaking' : 'Artie is Listening')
                      : 'Start Tutor Conversation'}
                </p>
                <p className={`text-xs mt-0.5 ${isConnected ? (isSpeaking ? 'text-white/70' : 'text-[#8B7355]') : 'text-[#A08060]'
                  }`}>
                  {status === 'connecting' ? 'Please wait...'
                    : isConnected
                      ? 'Click to end session'
                      : 'Click to begin with Artie'}
                </p>
              </div>

              {/* Sound bars (when speaking) */}
              {isSpeaking && (
                <div className="ml-auto flex items-end gap-0.5 h-5">
                  <div className="w-1 h-2 bg-white/80 rounded-full animate-[bounce_0.6s_infinite]" />
                  <div className="w-1 h-4 bg-white/80 rounded-full animate-[bounce_0.8s_infinite]" />
                  <div className="w-1 h-3 bg-white/80 rounded-full animate-[bounce_0.7s_infinite]" />
                  <div className="w-1 h-5 bg-white/80 rounded-full animate-[bounce_0.9s_infinite]" />
                </div>
              )}

              {/* Arrow hint (when idle) */}
              {!isConnected && status !== 'connecting' && (
                <div className="ml-auto text-[#D93D3D] opacity-40">›</div>
              )}
            </div>
          </button>

          {/* Student Learning Profile — collapsed by default, below chat */}
          <div className="mt-3 border border-[#E0D5C5] rounded-xl overflow-hidden">
            <button
              onClick={() => setIsProgressOpen(!isProgressOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-[#FAF6EF] hover:bg-[#E0D5C5]/30 transition-colors"
            >
              <h2 className="text-[10px] font-black text-[#8B7355] uppercase tracking-[0.2em]">
                Learning Profile
              </h2>
              {isProgressOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[#8B7355] opacity-60" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[#8B7355] opacity-60" />
              )}
            </button>

            <div
              className={`overflow-y-auto transition-all duration-300 ease-in-out bg-white ${
                isProgressOpen ? 'max-h-[180px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="px-4 py-3">
                {!hasStudentData ? (
                  <p className="text-xs text-[#8B7355] opacity-70 leading-relaxed">
                    No profile data yet. It will appear after whiteboard analyses.
                  </p>
                ) : (
                  <div className="space-y-1.5 text-xs text-[#3D2F1E]">
                    {studentModel && studentModel.mastered_concepts.length > 0 && (
                      <p><span className="font-bold text-[#428751]">Mastered:</span> {studentModel.mastered_concepts.join(', ')}</p>
                    )}
                    {studentModel && studentModel.struggling_concepts.length > 0 && (
                      <p><span className="font-bold text-[#D93D3D]">Struggling:</span> {studentModel.struggling_concepts.join(', ')}</p>
                    )}
                    {studentModel && Object.keys(studentModel.mistake_patterns).length > 0 && (
                      <p>
                        <span className="font-bold text-[#8B7355]">Patterns:</span>{' '}
                        {Object.entries(studentModel.mistake_patterns)
                          .sort((a, b) => b[1] - a[1])
                          .map(([k, v]) => `${k} (×${v})`)
                          .join(', ')}
                      </p>
                    )}
                    {studentModel?.skill_ratings && Object.keys(studentModel.skill_ratings).length > 0 && (
                      <div>
                        <p className="font-bold text-[#8B7355] mb-1">Skill ratings:</p>
                        {Object.values(studentModel.skill_ratings)
                          .sort((a, b) => b.rating - a.rating)
                          .slice(0, 5)
                          .map((skill) => (
                            <p key={skill.title}>{skill.title}: <span className="font-semibold">{skill.rating}</span>/100</p>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
