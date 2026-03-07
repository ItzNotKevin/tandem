'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import TldrawBoard, { TldrawBoardHandle } from '@/components/TldrawBoard'
import { analyzeWhiteboard, AnalysisResponse } from '@/lib/whiteboard-api'
import { Brain, Loader2, MessageSquare, AlertCircle, Mic, MicOff, Volume2 } from 'lucide-react'
import { useConversation } from '@elevenlabs/react'

export default function WhiteboardPage() {
  const boardRef = useRef<TldrawBoardHandle>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [feedback, setFeedback] = useState<AnalysisResponse | null>(null)
  const [transcript, setTranscript] = useState<{ role: 'user' | 'agent', text: string }[]>([])
  const [currentQuestion, setCurrentQuestion] = useState("Find the derivative of 3x² + 5x + 2")
  const [sessionData, setSessionData] = useState<any>(null)
  
  // Fetch session context on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/session/context`)
        const data = await response.json()
        setSessionData(data)
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
      // Send initial context immediately upon connection
      if (sessionData) {
        const fileContext = sessionData.file_summaries.map((f: any) => `- ${f.filename}: ${f.summary}`).join('\n')
        const fullContext = `Context: The student is working on the problem: "${sessionData.current_problem}". Background materials they've uploaded:\n${fileContext}\nYou are watching their whiteboard. Greet them and mention you're ready to help with this specific problem.`
        conversation.sendContextualUpdate(fullContext)
      }
    },
    onDisconnect: () => console.log('Disconnected from ElevenLabs'),
    onMessage: (message) => {
      console.log('Received message:', message)
      if (message.source === 'ai' && message.message) {
        setTranscript(prev => [...prev, { role: 'agent', text: message.message }])
      } else if (message.source === 'user' && message.message) {
        setTranscript(prev => [...prev, { role: 'user', text: message.message }])
      }
    },
    onError: (error) => console.error('ElevenLabs Error:', error),
  })

  const { status, isSpeaking, sendContextualUpdate } = conversation
  const isConnected = status === 'connected'
  
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
    setIsAnalyzing(true)
    try {
      const result = await analyzeWhiteboard(snapshot.base64, currentQuestion)
      setFeedback(result)
      
      // Voice-Vision Handshake: Send background info to the voice agent
      if (isConnected) {
        const visionContext = `Whiteboard Update: ${result.feedback}. ${result.hasMistake ? 'The student made a mistake.' : 'The student is on the right track.'}`
        await sendContextualUpdate(visionContext)
      }

      if (result.coordinates) {
        boardRef.current?.pointTo(result.coordinates.x, result.coordinates.y)
      }
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="flex w-screen h-screen bg-white overflow-hidden font-sans">
      {/* Main Whiteboard Area */}
      <div className="flex-1 relative flex flex-col">
        {/* Status Indicator */}
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          {isAnalyzing && (
            <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-blue-100 shadow-sm animate-pulse">
              <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter">Thinking</span>
            </div>
          )}
        </div>

        <TldrawBoard 
          ref={boardRef} 
          onStrokeEnd={handleStrokeEnd} 
          strokeEndDebounceMs={3000} 
        />

        {/* Voice Toggle Button - Bottom Right */}
        <div className="absolute bottom-8 right-8 z-50">
          <button 
            onClick={toggleVoice}
            disabled={status === 'connecting'}
            className={`group relative p-4 rounded-full transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-[0_5px_25px_-5px_rgba(239,68,68,0.4)] ${
              isConnected 
                ? 'bg-red-500' 
                : status === 'connecting'
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-white border border-gray-100 hover:border-red-200'
            }`}
          >
            {/* Subtle Inner Glow for Matte Effect */}
            <div className={`absolute inset-0 rounded-full transition-opacity duration-300 ${
              isConnected ? 'opacity-20 bg-gradient-to-tr from-black/20 to-white/20' : 'opacity-0'
            }`} />

            <div className={`relative z-10 transition-colors duration-300 ${
              isConnected ? 'text-white' : 'text-red-500'
            }`}>
              {status === 'connecting' ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : isConnected ? (
                <Mic className={`w-6 h-6 ${isSpeaking ? 'animate-bounce' : 'animate-pulse'}`} />
              ) : (
                <MicOff className="w-6 h-6" />
              )}
            </div>
            
            {/* Ping animation when active */}
            {isConnected && (
              <div className={`absolute inset-0 rounded-full bg-red-400 opacity-20 ${isSpeaking ? 'animate-[ping_1.5s_linear_infinite]' : 'animate-ping'}`} />
            )}

            {/* Tooltip */}
            <div className="absolute bottom-full right-0 mb-6 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 pointer-events-none whitespace-nowrap bg-gray-900 text-white text-[10px] font-bold py-1.5 px-3 rounded-lg uppercase tracking-widest shadow-xl">
              {status === 'connecting' ? 'Connecting...' : isConnected ? 'Stop Session' : 'Start Tutor Conversation'}
            </div>
          </button>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-[350px] border-l border-gray-200 flex flex-col bg-gray-50/50">
        {/* Question Box */}
        <div className="p-6 bg-white border-b border-gray-200">
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Current Problem</h2>
          <div className="p-5 bg-gray-900 rounded-2xl shadow-inner">
            <p className="text-white font-medium text-lg leading-relaxed italic">
              "{currentQuestion}"
            </p>
          </div>
        </div>

        {/* AI Description & Responses */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Tutor Interaction</h2>
          <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
            {transcript.length === 0 && !feedback && (
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                <p className="text-sm text-gray-500 leading-relaxed">
                  Welcome! I'm watching your progress on the board. Start solving the problem above, and I'll jump in if you need a hand.
                </p>
              </div>
            )}
            
            {/* Transcript Messages */}
            {transcript.map((msg, idx) => (
              <div 
                key={idx} 
                className={`p-4 rounded-2xl border animate-in slide-in-from-bottom-2 duration-300 shadow-sm ${
                  msg.role === 'agent' 
                    ? 'bg-blue-50 border-blue-100 text-blue-800 ml-4' 
                    : 'bg-white border-gray-100 text-gray-800 mr-4'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${msg.role === 'agent' ? 'text-blue-500' : 'text-gray-400'}`}>
                    {msg.role === 'agent' ? 'Artie' : 'You'}
                  </span>
                </div>
                <p className="text-sm mt-1 leading-relaxed">{msg.text}</p>
              </div>
            ))}

            {feedback && (
              <div className={`p-5 rounded-2xl border animate-in slide-in-from-bottom-2 duration-300 shadow-sm ${
                feedback.hasMistake 
                  ? 'bg-red-50 border-red-100 text-red-800' 
                  : 'bg-blue-50 border-blue-100 text-blue-800'
              }`}>
                <div className="flex items-start gap-3">
                  <MessageSquare className={`w-5 h-5 shrink-0 ${feedback.hasMistake ? 'text-red-500' : 'text-blue-500'}`} />
                  <div>
                    <p className="font-bold text-xs uppercase tracking-widest mb-2">
                       {feedback.hasMistake ? 'Observation' : 'Board Summary'}
                    </p>
                    <p className="text-sm leading-relaxed">{feedback.feedback}</p>
                  </div>
                </div>
              </div>
            )}

            {isConnected && (
              <div className={`p-5 rounded-2xl border transition-all duration-300 flex items-center gap-4 ${
                isSpeaking 
                  ? 'bg-red-100 border-red-200 shadow-md scale-[1.02]' 
                  : 'bg-red-50 border-red-100 opacity-80'
              }`}>
                <div className="relative">
                  <Volume2 className={`w-5 h-5 ${isSpeaking ? 'text-red-600 animate-pulse' : 'text-red-400'}`} />
                  {isSpeaking && (
                    <div className="absolute -top-1 -right-1 flex gap-0.5">
                      <div className="w-0.5 h-2 bg-red-500 animate-[bounce_0.6s_infinite]" />
                      <div className="w-0.5 h-3 bg-red-500 animate-[bounce_0.8s_infinite]" />
                      <div className="w-0.5 h-2 bg-red-500 animate-[bounce_0.7s_infinite]" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest">
                    {isSpeaking ? 'Tutor is Speaking' : 'Listening...'}
                  </p>
                  <p className="text-xs text-red-800/60 mt-0.5">
                    {isSpeaking ? 'Tap to interrupt' : 'I can hear you now'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
