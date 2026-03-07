"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";

export default function RecordPage() {
  const router = useRouter();

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [recordings, setRecordings] = useState<{ id: number; duration: number; transcribing: boolean }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStep, setGeneratingStep] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptsRef = useRef<string[]>([]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && !isPaused) {
      interval = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    const valid = Array.from(files).filter((f) => allowed.includes(f.type));
    setUploadedFiles((prev) => [...prev, ...valid]);
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

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
    const id = Date.now();
    const duration = recordingTime;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      audioChunksRef.current = [];

      setRecordings((prev) => [...prev, { id, duration, transcribing: true }]);

      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        const res = await fetch("/api/transcribe", { method: "POST", body: formData });
        if (res.ok) {
          const { text } = await res.json();
          transcriptsRef.current.push(text);
        }
      } catch (err) {
        console.error("Transcription failed:", err);
      } finally {
        setRecordings((prev) => prev.map((r) => r.id === id ? { ...r, transcribing: false } : r));
      }
    };

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
    setIsPaused(false);
    setRecordingTime(0);
  };

  const handleRemoveRecording = (id: number, index: number) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    transcriptsRef.current.splice(index, 1);
  };

  const handleGenerateLesson = async () => {
    setIsGenerating(true);
    setGeneratingStep("Analyzing your materials...");

    try {
      const formData = new FormData();
      uploadedFiles.forEach((f) => formData.append("files", f));
      formData.append("transcript", transcriptsRef.current.join("\n\n"));

      setGeneratingStep("Extracting key concepts...");
      const res = await fetch("/api/generate-lesson", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Generation failed");

      setGeneratingStep("Building your lesson...");
      await res.json();

      router.push("/slideshow");
    } catch (err) {
      console.error("Lesson generation failed:", err);
      setIsGenerating(false);
    }
  };

  const anyTranscribing = recordings.some((r) => r.transcribing);
  const canGenerate = !isGenerating && !anyTranscribing && (uploadedFiles.length > 0 || recordings.length > 0);

  return (
    <div className="min-h-screen bg-[#F6F4EE] text-[#5A5145] font-sans selection:bg-[#E3D8C3]">

      {/* Loading Overlay */}
      {isGenerating && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#F6F4EE]">
          <div className="flex flex-col items-center gap-8">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 rounded-full border-2 border-[#D1C6B3] animate-ping opacity-30" />
              <div className="absolute inset-2 rounded-full border-2 border-[#A6977F] animate-ping opacity-50" style={{ animationDelay: "0.3s" }} />
              <div className="absolute inset-4 rounded-full border-2 border-[#5A5145] animate-ping opacity-70" style={{ animationDelay: "0.6s" }} />
              <div className="absolute inset-5 flex items-center justify-center">
                <BrandLogo variant="mark" className="w-10 h-10" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-medium tracking-tight text-[#5A5145]" style={{ fontFamily: 'ui-serif, Georgia, "Times New Roman", Times, serif' }}>
                Crafting your lesson
              </h2>
              <p className="text-sm text-[#A6977F] italic animate-pulse">{generatingStep}</p>
            </div>
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-[#A6977F]" style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      <header className="flex justify-between items-center px-8 py-4 text-xs font-semibold tracking-[0.15em] text-[#A6977F]">
        <BrandLogo className="w-36" />
        <div>RECORDING STUDIO</div>
      </header>

      <main className="flex flex-col items-center justify-center mt-12 md:mt-24 px-6 gap-6">
        <div className="text-center mb-10 space-y-4">
          <h1 className="text-4xl md:text-5xl font-medium tracking-tight" style={{ fontFamily: 'ui-serif, Georgia, "Times New Roman", Times, serif' }}>
            New Session
          </h1>
          <p className="italic text-[#A6977F] font-serif text-lg">Upload materials and record your explanation</p>
        </div>

        <div className="flex flex-col md:flex-row gap-8 w-full max-w-5xl">

          {/* Left: File Upload */}
          <div className="flex-1 rounded-2xl bg-[#EFEADF] p-8 border border-[#DFD5C2] shadow-sm flex flex-col min-h-[320px]">
            <div className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-6">ATTACHMENTS</div>

            <label
              className={`flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition p-6 text-center ${isDragging ? "border-[#5A5145] bg-[#EAE4D6]" : "border-[#D1C6B3] bg-transparent hover:bg-[#F4EFE6]"}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileSelect(e.dataTransfer.files); }}
            >
              <div className="flex flex-col items-center justify-center py-3">
                <svg className="w-8 h-8 mb-3 text-[#A6977F]" fill="none" viewBox="0 0 20 16" xmlns="http://www.w3.org/2000/svg">
                  <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" />
                </svg>
                <p className="mb-1 text-sm text-[#736859]"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                <p className="text-xs text-[#A6977F]">PDF, PNG, JPG — multiple files supported</p>
              </div>
              <input type="file" className="hidden" accept=".pdf,image/png,image/jpeg" multiple onChange={(e) => handleFileSelect(e.target.files)} />
            </label>

            {uploadedFiles.length > 0 && (
              <div className="mt-4 flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                {uploadedFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#F4EFE6] px-3 py-2 rounded-lg border border-[#D1C6B3]">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="w-4 h-4 text-[#7A9E7E] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs text-[#5A5145] truncate">{f.name}</span>
                    </div>
                    <button onClick={() => handleRemoveFile(i)} className="text-[#A6977F] hover:text-[#D93D3D] transition-colors ml-2 shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Recording Interface */}
          <div className="flex-1 rounded-2xl bg-[#EFEADF] p-8 border border-[#DFD5C2] shadow-sm flex flex-col min-h-[320px]">
            <div className="text-xs tracking-widest text-[#B3A48C] font-semibold mb-6">CONTROLS</div>

            <div className="flex flex-col flex-1 items-center justify-center space-y-8">
              <div
                className={`text-6xl tracking-wider transition-colors duration-300 ${isRecording && !isPaused ? "text-[#D93D3D]" : "text-[#5A5145]"}`}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              >
                {formatTime(recordingTime)}
              </div>

              <div className="h-6">
                {isRecording ? (
                  isPaused ? (
                    <span className="text-[#A6977F] italic flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#A6977F]" /> Paused</span>
                  ) : (
                    <span className="text-[#D93D3D] font-medium flex items-center gap-2 animate-pulse"><span className="w-2 h-2 rounded-full bg-[#D93D3D]" /> Recording...</span>
                  )
                ) : (
                  <span className="text-[#A6977F] italic">Ready to record</span>
                )}
              </div>

              <div className="flex items-center gap-4">
                {!isRecording ? (
                  <button onClick={handleStartRecording} className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#5A5145] text-[#F6F4EE] hover:bg-[#453D32] transition-colors shadow-sm font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg>
                    Start Recording
                  </button>
                ) : (
                  <>
                    <button onClick={handlePauseToggle} className="flex items-center gap-2 px-5 py-3 rounded-full border border-[#D1C6B3] text-[#5A5145] hover:bg-[#EAE4D6] transition-colors font-medium">
                      {isPaused
                        ? <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Resume</>
                        : <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg> Pause</>
                      }
                    </button>
                    <button onClick={handleStopRecording} className="flex items-center gap-2 px-5 py-3 rounded-full bg-[#EADDD9] border border-[#D9C4BD] text-[#D93D3D] hover:bg-[#E3D1CC] transition-colors font-medium">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
                      End
                    </button>
                  </>
                )}
              </div>

              {recordings.length > 0 && (
                <div className="w-full flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                  {recordings.map((rec, i) => (
                    <div key={rec.id} className="flex items-center justify-between bg-[#F4EFE6] px-3 py-2 rounded-lg border border-[#D1C6B3]">
                      <div className="flex items-center gap-2">
                        {rec.transcribing ? (
                          <svg className="w-4 h-4 text-[#A6977F] animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-[#7A9E7E]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        <span className="text-xs text-[#5A5145] font-medium">Recording {i + 1}</span>
                        <span className="text-xs text-[#A6977F] font-mono">{formatTime(rec.duration)}</span>
                        {rec.transcribing && <span className="text-xs text-[#A6977F] italic">Transcribing...</span>}
                      </div>
                      {!rec.transcribing && (
                        <button onClick={() => handleRemoveRecording(rec.id, i)} className="text-[#A6977F] hover:text-[#D93D3D] transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-12 w-full max-w-5xl flex justify-center">
          <button
            onClick={handleGenerateLesson}
            disabled={!canGenerate}
            className="px-10 py-4 rounded-full bg-[#5A5145] text-[#F6F4EE] hover:bg-[#453D32] transition-all shadow-md font-semibold tracking-wider text-sm hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
          >
            GENERATE LESSON
          </button>
        </div>
      </main>

      <style jsx>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
