"use client";

import { useState, useRef, useEffect } from "react";

const BACKEND_WS = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000").replace(/^http/, "ws");

export default function RecordPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordings, setRecordings] = useState<{ id: number; duration: number; transcript: string }[]>([]);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef("");
  const [isTranscribing, setIsTranscribing] = useState(false);

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

  const handleStartRecording = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Microphone access denied.");
      return;
    }

    setIsRecording(true);
    setIsPaused(false);
    setRecordingTime(0);
    setTranscript("");
    setPartialTranscript("");
    transcriptRef.current = "";

    audioChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.start(1000);
  };

  const handlePauseToggle = () => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
    } else {
      mediaRecorderRef.current.pause();
    }
    setIsPaused(!isPaused);
  };

  const handleStopRecording = () => {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      audioChunksRef.current = [];

      setIsTranscribing(true);
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        const res = await fetch("/api/transcribe", { method: "POST", body: formData });
        if (res.ok) {
          const { text } = await res.json();
          transcriptRef.current = text;
          setTranscript(text);
        }
      } catch (err) {
        console.error("Transcription failed:", err);
      } finally {
        setIsTranscribing(false);
      }
    };

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());

    if (recordingTime > 0) {
      setRecordings((prev) => [
        ...prev,
        { id: Date.now(), duration: recordingTime, transcript: transcriptRef.current },
      ]);
    }
    setIsRecording(false);
    setIsPaused(false);
    setRecordingTime(0);
    setPartialTranscript("");
  };

  const handleDeleteRecording = (id: number) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  };

  const handleFileUpload = async (file: File) => {
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowed.includes(file.type)) {
      setUploadError("Unsupported file type. Please upload a PDF, PNG, or JPG.");
      return;
    }

    setUploadedFileName(file.name);
    setIsExtracting(true);
    setUploadError(null);
    setExtractedText(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/extract", { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const { text } = await res.json();
      setExtractedText(text);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Extraction failed.");
      setExtractedText(null);
    } finally {
      setIsExtracting(false);
    }
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
          <div className="flex-1 rounded-2xl bg-[#EFEADF] p-8 border border-[#DFD5C2] shadow-sm flex flex-col min-h-[320px]">
            <div className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-6 self-start w-full">
              ATTACHMENTS
            </div>

            <label
              className={`flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition p-6 text-center ${isDragging ? "border-[#5A5145] bg-[#EAE4D6]" : "border-[#D1C6B3] bg-transparent hover:bg-[#F4EFE6]"}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) handleFileUpload(file);
              }}
            >
              <div className="flex flex-col items-center justify-center py-4">
                {isExtracting ? (
                  <>
                    <svg className="w-8 h-8 mb-3 text-[#A6977F] animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <p className="text-sm text-[#736859]">Extracting concepts...</p>
                    <p className="text-xs text-[#A6977F] mt-1 truncate max-w-[200px]">{uploadedFileName}</p>
                  </>
                ) : uploadedFileName && !uploadError ? (
                  <>
                    <svg className="w-8 h-8 mb-3 text-[#7A9E7E]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm font-medium text-[#5A5145] truncate max-w-[200px]">{uploadedFileName}</p>
                    <p className="text-xs text-[#A6977F] mt-1">Click to replace</p>
                  </>
                ) : (
                  <>
                    <svg className="w-10 h-10 mb-4 text-[#A6977F]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
                      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" />
                    </svg>
                    <p className="mb-2 text-sm text-[#736859]">
                      <span className="font-semibold">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-[#A6977F]">PDF, PNG, JPG (Max 50MB)</p>
                  </>
                )}
              </div>
              <input
                id="dropzone-file"
                type="file"
                className="hidden"
                accept=".pdf,image/png,image/jpeg"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
              />
            </label>

            {uploadError && (
              <p className="mt-3 text-xs text-[#D93D3D]">{uploadError}</p>
            )}

            {extractedText && (
              <div className="mt-4">
                <p className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-2">EXTRACTED TEXT</p>
                <div className="max-h-48 overflow-y-auto text-xs text-[#736859] whitespace-pre-wrap leading-relaxed">
                  {extractedText}
                </div>
              </div>
            )}
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

              {/* Transcript */}
              {(isTranscribing || transcript) && (
                <div className="w-full">
                  <p className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-2">TRANSCRIPT</p>
                  <div className="max-h-36 overflow-y-auto text-xs text-[#736859] leading-relaxed bg-[#F4EFE6] rounded-xl p-3 border border-[#D1C6B3]">
                    {isTranscribing ? (
                      <span className="text-[#A6977F] italic animate-pulse">Transcribing...</span>
                    ) : (
                      <span>{transcript}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Generate Lesson Button */}
        <div className="mt-12 w-full max-w-5xl flex justify-center">
          <button className="px-10 py-4 rounded-full bg-[#5A5145] text-[#F6F4EE] hover:bg-[#453D32] transition-all shadow-md font-semibold tracking-wider text-sm hover:-translate-y-0.5" onClick={() => console.log('Generate Lesson clicked')}>
            GENERATE LESSON
          </button>
        </div>

      </main>
    </div>
  );
}
