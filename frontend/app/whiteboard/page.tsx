'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import TldrawBoard, { TldrawBoardHandle } from '@/components/TldrawBoard'
import { analyzeWhiteboard, AnalysisResponse } from '@/lib/whiteboard-api'
import BrandLogo from '@/components/BrandLogo'
import { Brain, Loader2, MessageSquare, AlertCircle, Mic, MicOff, ChevronDown, ChevronUp } from 'lucide-react'
import { useConversation } from '@elevenlabs/react'

export default function WhiteboardPage() {
  const boardRef = useRef<TldrawBoardHandle>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [feedback, setFeedback] = useState<AnalysisResponse | null>(null)
  const [transcript, setTranscript] = useState<{ role: 'user' | 'agent', text: string }[]>([])
  const [currentQuestion, setCurrentQuestion] = useState("What are we working on today?")
  const [isProblemOpen, setIsProblemOpen] = useState(true)
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

  // Auto-scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript, feedback])

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
  }, [])

  // ElevenLabs Conversation Hook
  const conversation = useConversation({
    onConnect: () => {
      console.log('Connected to ElevenLabs')
      const currentData = sessionRef.current
      if (currentData) {
        const fileContext = (currentData.file_summaries || []).map((f: any) => `- ${f.filename}: ${f.summary}`).join('\n')
        const fullContext = `Context: The student is working on the problem: "${currentData.current_problem}". Background materials they've uploaded:\n${fileContext}\nYou are watching their whiteboard. Greet them and mention you're ready to help with this specific problem.`
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

        // Re-inject latest whiteboard state right before Artie responds
        // This is the KEY fix: sendContextualUpdate is dropped while Artie speaks,
        // so we re-send on every user turn to guarantee fresh whiteboard context
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

      const status = result.hasMistake ? '⚠️ MISTAKE DETECTED' : '✅ ON TRACK'
      const observation = `[WHITEBOARD UPDATE]
STATUS: ${status}
VISUAL ANALYSIS: ${result.feedback}
${result.hasMistake ? `ERROR: ${result.mistakeDescription}` : ''}`

      // Always store the background visual context for regular chit-chat
      latestAnalysisRef.current = `[CURRENT WHITEBOARD STATE (Background Data)]
STATUS: ${status}
VISUAL ANALYSIS: ${result.feedback}
${result.hasMistake ? `ERROR: ${result.mistakeDescription}` : ''}
Use this context to understand what is currently on the board if the student talks about their work.`

      if (isConnected) {
        // We interrupt Artie by sending the visual observation as a system event.
        // Because ElevenLabs is the main conversational LLM, it will naturally 
        // halt its current output, process this new information, and dynamically pivot!
        sendUserMessage(observation + "\n\nINSTRUCTION: The student just added this to the whiteboard. If you were speaking, gracefully halt and immediately pivot to address this new development. Do not repeat exactly what you were saying before. Acknowledge what they wrote contextually.")
      } else {
        // Artie offline — queue for next connection
        pendingObservationRef.current = observation + "\n\nINSTRUCTION: The student just added this to the whiteboard. If you were speaking, gracefully halt and immediately pivot to address this new development. Do not repeat exactly what you were saying before. Acknowledge what they wrote contextually."
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
    <div className="flex w-screen h-screen bg-[#FAF6EF] overflow-hidden font-serif">
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
        <div className="px-6 py-1.5 border-b border-[#E0D5C5] bg-[#FAF6EF]">
          <BrandLogo className="w-20" />
        </div>

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
            className={`px-6 overflow-hidden transition-all duration-300 ease-in-out ${
              isProblemOpen ? 'max-h-[500px] pb-6 opacity-100' : 'max-h-0 pb-0 opacity-0'
            }`}
          >
            <div className="p-5 bg-white border border-[#E0D5C5] rounded-2xl shadow-sm text-center">
              <p className="text-[#3D2F1E] font-medium text-lg leading-relaxed italic">
                "{currentQuestion}"
              </p>
            </div>
            
            {sessionData?.practice_problems && sessionData.practice_problems.length > 1 && (
              <div className="mt-4 flex gap-3">
                <button 
                  disabled={sessionData.current_problem_index === 0}
                  onClick={async () => {
                    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/problem/prev`, { method: 'POST' })
                    const data = await res.json()
                    setCurrentQuestion(data.current_problem)
                    setSessionData({...sessionData, current_problem_index: data.current_problem_index, current_problem: data.current_problem})
                    if (isConnected) sendContextualUpdate(`The student has moved BACK to a previous problem: "${data.current_problem}". Please help them with this one now.`)
                  }}
                  className="flex-1 py-2 px-3 text-[10px] font-black text-[#8B7355] uppercase tracking-wider border border-[#E0D5C5] rounded-xl hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                >
                  Previous
                </button>
                <button 
                  disabled={sessionData.current_problem_index === sessionData.practice_problems.length - 1}
                  onClick={async () => {
                    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/problem/next`, { method: 'POST' })
                    const data = await res.json()
                    setCurrentQuestion(data.current_problem)
                    setSessionData({...sessionData, current_problem_index: data.current_problem_index, current_problem: data.current_problem})
                    if (isConnected) sendContextualUpdate(`The student has moved ON to the next problem: "${data.current_problem}". Please help them with this completely new problem now.`)
                  }}
                  className="flex-1 py-2 px-3 text-[10px] font-black text-white bg-[#D93D3D] hover:bg-[#c13636] uppercase tracking-wider rounded-xl disabled:opacity-30 disabled:hover:bg-[#D93D3D] transition-all shadow-sm"
                >
                  Next Problem
                </button>
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
                  ? 'bg-white border-[#D93D3D] text-[#D93D3D]'
                  : 'bg-white border-[#E0D5C5] text-[#3D2F1E]'
                }`}>
                <div className="flex items-start gap-3">
                  <MessageSquare className={`w-5 h-5 shrink-0 ${feedback.hasMistake ? 'text-[#D93D3D]' : 'text-[#D93D3D]'}`} />
                  <div>
                    <p className={`font-bold text-[10px] uppercase tracking-widest mb-2 opacity-60 ${feedback.hasMistake ? 'text-[#D93D3D]' : ''}`}>
                      {feedback.hasMistake ? 'Mistake Spotted' : 'Observation'}
                    </p>
                    <p className="text-sm leading-relaxed">{feedback.feedback}</p>
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
        </div>
      </div>
    </div>
  )
}

