'use client'

import { useState, useRef } from 'react'
import TldrawBoard, { TldrawBoardHandle } from '@/components/TldrawBoard'
import { analyzeWhiteboard, AnalysisResponse } from '@/lib/whiteboard-api'
import { Brain, Loader2, MessageSquare, AlertCircle, Mic, MicOff } from 'lucide-react'

export default function WhiteboardPage() {
  const boardRef = useRef<TldrawBoardHandle>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [feedback, setFeedback] = useState<AnalysisResponse | null>(null)
  const [isVoiceActive, setIsVoiceActive] = useState(false)
  
  const currentQuestion = "Find the derivative of 3x² + 5x + 2"

  const handleStrokeEnd = async (snapshot: { base64: string }) => {
    setIsAnalyzing(true)
    try {
      const result = await analyzeWhiteboard(snapshot.base64, currentQuestion)
      setFeedback(result)
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
            onClick={() => setIsVoiceActive(!isVoiceActive)}
            className={`group relative p-4 rounded-full transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-[0_5px_25px_-5px_rgba(239,68,68,0.4)] ${
              isVoiceActive 
                ? 'bg-red-500' 
                : 'bg-white border border-gray-100 hover:border-red-200'
            }`}
          >
            {/* Subtle Inner Glow for Matte Effect */}
            <div className={`absolute inset-0 rounded-full transition-opacity duration-300 ${
              isVoiceActive ? 'opacity-20 bg-gradient-to-tr from-black/20 to-white/20' : 'opacity-0'
            }`} />

            <div className={`relative z-10 transition-colors duration-300 ${
              isVoiceActive ? 'text-white' : 'text-red-500'
            }`}>
              {isVoiceActive ? (
                <Mic className="w-6 h-6 animate-pulse" />
              ) : (
                <MicOff className="w-6 h-6" />
              )}
            </div>
            
            {/* Ping animation when active */}
            {isVoiceActive && (
              <div className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-20" />
            )}

            {/* Tooltip */}
            <div className="absolute bottom-full right-0 mb-6 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 pointer-events-none whitespace-nowrap bg-gray-900 text-white text-[10px] font-bold py-1.5 px-3 rounded-lg uppercase tracking-widest shadow-xl">
              {isVoiceActive ? 'Stop Listening' : 'Start Tutor Conversation'}
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
            {!feedback && (
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                <p className="text-sm text-gray-500 leading-relaxed">
                  Welcome! I'm watching your progress on the board. Start solving the derivative above, and I'll jump in if you need a hand.
                </p>
              </div>
            )}
            
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
                       {feedback.hasMistake ? 'Observation' : 'Great Work'}
                    </p>
                    <p className="text-sm leading-relaxed">{feedback.feedback}</p>
                  </div>
                </div>
              </div>
            )}

            {isVoiceActive && (
              <div className="bg-red-50 p-5 rounded-2xl border border-red-100 flex items-center gap-4 animate-pulse">
                <div className="w-2 h-2 bg-red-500 rounded-full" />
                <span className="text-xs font-bold text-red-700 uppercase tracking-widest">Listening for voice...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
