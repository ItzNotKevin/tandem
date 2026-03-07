"use client";

import { useState, useRef, useEffect } from "react";
import Head from "next/head";

export default function RecordPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordings, setRecordings] = useState<{ id: number; duration: number }[]>([]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

  const handleStartRecording = () => {
    setIsRecording(true);
    setIsPaused(false);
    setRecordingTime(0);
  };

  const handlePauseToggle = () => {
    setIsPaused(!isPaused);
  };

  const handleStopRecording = () => {
    if (recordingTime > 0) {
      setRecordings((prev) => [...prev, { id: Date.now(), duration: recordingTime }]);
    }
    setIsRecording(false);
    setIsPaused(false);
    setRecordingTime(0);
  };

  const handleDeleteRecording = (id: number) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#F6F4EE] text-[#5A5145] font-sans selection:bg-[#E3D8C3]">
      {/* Top Navigation Bar */}
      <header className="flex justify-between items-center px-8 py-4 text-xs font-semibold tracking-[0.15em] text-[#A6977F]">
        <div>RECORDING STUDIO</div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center mt-12 md:mt-24 px-6 gap-6">
        {/* Header Section */}
        <div className="text-center mb-10 space-y-4">
          <h1
            className="text-4xl md:text-5xl font-medium tracking-tight"
            style={{ fontFamily: 'ui-serif, Georgia, "Times New Roman", Times, serif' }}
          >
            New Session
          </h1>
          <p className="italic text-[#A6977F] font-serif text-lg">
            Upload materials and record your explanation
          </p>
        </div>

        {/* Two Column Layout */}
        <div className="flex flex-col md:flex-row gap-8 w-full max-w-5xl">

          {/* Left Side: File Upload */}
          <div className="flex-1 rounded-2xl bg-[#EFEADF] p-8 border border-[#DFD5C2] shadow-sm flex flex-col items-center justify-center min-h-[320px] transition-colors hover:bg-[#EAE4D6]">
            <div className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-6 self-start w-full">
              ATTACHMENTS
            </div>

            <label className="flex flex-col items-center justify-center w-full h-full rounded-xl border-2 border-dashed border-[#D1C6B3] bg-transparent cursor-pointer hover:bg-[#F4EFE6] transition p-6 text-center">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg
                  className="w-10 h-10 mb-4 text-[#A6977F]"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 20 16"
                >
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
                  />
                </svg>
                <p className="mb-2 text-sm text-[#736859]">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-[#A6977F]">
                  PDF, DOCX, PNG, JPG (Max 50MB)
                </p>
              </div>
              <input id="dropzone-file" type="file" className="hidden" />
            </label>
          </div>

          {/* Right Side: Recording Interface */}
          <div className="flex-1 rounded-2xl bg-[#EFEADF] p-8 border border-[#DFD5C2] shadow-sm flex flex-col min-h-[320px]">
            <div className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-6">
              CONTROLS
            </div>

            <div className="flex flex-col flex-1 items-center justify-center space-y-8">
              {/* Timer Display */}
              <div
                className={`text-6xl tracking-wider transition-colors duration-300 ${isRecording && !isPaused ? "text-[#D93D3D]" : "text-[#5A5145]"
                  }`}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              >
                {formatTime(recordingTime)}
              </div>

              {/* Status Text */}
              <div className="h-6">
                {isRecording ? (
                  isPaused ? (
                    <span className="text-[#A6977F] italic flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#A6977F]"></span>
                      Paused
                    </span>
                  ) : (
                    <span className="text-[#D93D3D] font-medium flex items-center gap-2 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-[#D93D3D]"></span>
                      Recording...
                    </span>
                  )
                ) : (
                  <span className="text-[#A6977F] italic">Ready to record</span>
                )}
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-4">
                {!isRecording ? (
                  <button
                    onClick={handleStartRecording}
                    className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#5A5145] text-[#F6F4EE] hover:bg-[#453D32] transition-colors shadow-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                    Start Recording
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handlePauseToggle}
                      className="flex items-center gap-2 px-5 py-3 rounded-full border border-[#D1C6B3] text-[#5A5145] hover:bg-[#EAE4D6] transition-colors font-medium"
                    >
                      {isPaused ? (
                        <>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          Resume
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                          </svg>
                          Pause
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleStopRecording}
                      className="flex items-center gap-2 px-5 py-3 rounded-full bg-[#EADDD9] border border-[#D9C4BD] text-[#D93D3D] hover:bg-[#E3D1CC] transition-colors font-medium"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 6h12v12H6z" />
                      </svg>
                      End
                    </button>
                  </>
                )}
              </div>

              {/* Saved Recordings List */}
              {recordings.length > 0 && !isRecording && (
                <div className="w-full mt-4 flex flex-col gap-3">
                  <div className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-2 text-center border-b border-[#D1C6B3] pb-2">
                    SAVED RECORDINGS
                  </div>
                  {recordings.map((rec, index) => (
                    <div key={rec.id} className="flex justify-between items-center bg-[#F4EFE6] px-4 py-3 rounded-xl border border-[#D1C6B3]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#EADDD9] text-[#D93D3D] flex items-center justify-center">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                        <div className="flex flex-col text-left">
                          <span className="text-sm font-medium text-[#5A5145]">Recording {index + 1}</span>
                          <span className="text-xs text-[#A6977F] font-mono">{formatTime(rec.duration)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteRecording(rec.id)}
                        className="text-[#A6977F] hover:text-[#D93D3D] transition-colors p-2"
                        title="Delete recording"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>


      </main>
    </div>
  );
}
