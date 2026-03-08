"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import EngagementTracker from "@/components/EngagementTracker";

export default function RecordPage() {
  const router = useRouter();

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  type WordStamp = { text: string; type: string; start: number; end: number };
  type EngagementEvent = { timestamp_seconds: number; engaged: boolean };
  type RecordingEntry = {
    id: number;
    duration: number;
    transcribing: boolean;
    transcript?: string;
    words?: WordStamp[];
    engagementEvents?: EngagementEvent[];
  };

  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [viewingRecording, setViewingRecording] = useState<RecordingEntry | null>(null);
  const engagementEventsRef = useRef<EngagementEvent[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStep, setGeneratingStep] = useState("");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [engagementStatus, setEngagementStatus] = useState<"engaged" | "disengaged" | "inactive">("inactive");
  const [disengagementCount, setDisengagementCount] = useState(0);
  const [customContext, setCustomContext] = useState("");

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

  // Engagement state is driven by EngagementTracker component callbacks
  useEffect(() => {
    if (!isRecording) setEngagementStatus("inactive");
    else setEngagementStatus("engaged");
  }, [isRecording]);

  const handleEngagementChange = (engaged: boolean, lapses: number) => {
    setEngagementStatus(engaged ? "engaged" : "disengaged");
    setDisengagementCount(lapses);
    if (recordingStartTimeRef.current > 0) {
      const timestamp_seconds = (Date.now() - recordingStartTimeRef.current) / 1000;
      engagementEventsRef.current.push({ timestamp_seconds, engaged });
    }
  };

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
    // Engagement reset is handled by EngagementTracker on mount
    engagementEventsRef.current = [];
    recordingStartTimeRef.current = Date.now();
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
    const snapshotEvents = [...engagementEventsRef.current];
    const mimeType = mediaRecorderRef.current.mimeType || "audio/webm";
    engagementEventsRef.current = [];
    recordingStartTimeRef.current = 0;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];

      setRecordings((prev) => [...prev, { id, duration, transcribing: true, engagementEvents: snapshotEvents }]);

      let transcript = "";
      let words: WordStamp[] = [];
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        console.log("[transcribe] blob size:", audioBlob.size, "type:", audioBlob.type);
        const res = await fetch("/api/transcribe", { method: "POST", body: formData });
        const data = await res.json();
        console.log("[transcribe] response:", res.status, data);
        if (res.ok) {
          transcript = data.text ?? "";
          words = data.words ?? [];
          transcriptsRef.current.push(transcript);
        } else {
          transcript = `[Error: ${data.error ?? res.status}]`;
        }
      } catch (err) {
        console.error("Transcription failed:", err);
      }
      setRecordings((prev) => prev.map((r) =>
        r.id === id ? { ...r, transcribing: false, transcript, words } : r
      ));
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
    setGenerationError(null);
    setGeneratingStep("Analyzing your materials...");

    try {
      const formData = new FormData();
      uploadedFiles.forEach((f) => formData.append("files", f));
      formData.append("transcript", transcriptsRef.current.join("\n\n"));
      if (customContext.trim()) formData.append("custom_context", customContext.trim());

      setGeneratingStep("Extracting key concepts...");
      const res = await fetch("/api/generate-lesson", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      setGeneratingStep("Building your lesson...");
      await res.json();

      router.push("/slideshow");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Lesson generation failed:", msg);
      setGenerationError(msg);
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
                <BrandLogo variant="mark" className="w-8 h-8" />
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
        <BrandLogo className="w-32" />
        <div>RECORDING STUDIO</div>
      </header>

      <main className="flex flex-col items-center justify-center mt-2 px-6 gap-3">
        <div className="text-center mb-2 space-y-1">
          <h1 className="text-2xl md:text-3xl font-medium tracking-tight" style={{ fontFamily: 'ui-serif, Georgia, "Times New Roman", Times, serif' }}>
            New Session
          </h1>
          <p className="italic text-[#A6977F] font-serif text-lg">Upload materials and record your explanation</p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full max-w-5xl">

          {/* Left: File Upload */}
          <div className="flex-1 rounded-2xl bg-[#EFEADF] p-4 border border-[#DFD5C2] shadow-sm flex flex-col min-h-[220px]">
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
          <div className="flex-1 rounded-2xl bg-[#EFEADF] p-4 border border-[#DFD5C2] shadow-sm flex flex-col min-h-[220px]">
            <div className="text-[10px] tracking-widest text-[#B3A48C] font-semibold mb-4">CONTROLS</div>

            <div className="flex flex-col flex-1 items-center justify-center space-y-4">
              <div
                className={`text-5xl tracking-wider transition-colors duration-300 ${isRecording && !isPaused ? "text-[#D93D3D]" : "text-[#5A5145]"}`}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              >
                {formatTime(recordingTime)}
              </div>

              <div className="flex flex-col items-center gap-1">
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

                {/* Engagement indicator */}
                {engagementStatus !== "inactive" && (
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-colors ${engagementStatus === "engaged"
                    ? "bg-[#E8F5E9] text-[#4CAF50]"
                    : "bg-[#FDECEA] text-[#D93D3D]"
                    }`}>
                    <span className={`w-2 h-2 rounded-full ${engagementStatus === "engaged" ? "bg-[#4CAF50]" : "bg-[#D93D3D] animate-pulse"
                      }`} />
                    {engagementStatus === "engaged" ? "Engaged" : "Disengaged"}
                    {disengagementCount > 0 && (
                      <span className="ml-1 opacity-70">· {disengagementCount} lapse{disengagementCount !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Browser-based FaceMesh engagement tracker */}
              <div className="w-full max-w-xs scale-90 origin-top">
                <EngagementTracker isActive={isRecording} onStatusChange={handleEngagementChange} />
              </div>

              <div className="flex items-center gap-3">
                {!isRecording ? (
                  <button onClick={handleStartRecording} className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#5A5145] text-[#F6F4EE] hover:bg-[#453D32] transition-colors shadow-sm font-medium text-sm">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg>
                    Start Recording
                  </button>
                ) : (
                  <>
                    <button onClick={handlePauseToggle} className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#D1C6B3] text-[#5A5145] hover:bg-[#EAE4D6] transition-colors font-medium text-sm">
                      {isPaused
                        ? <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Resume</>
                        : <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg> Pause</>
                      }
                    </button>
                    <button onClick={handleStopRecording} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#EADDD9] border border-[#D9C4BD] text-[#D93D3D] hover:bg-[#E3D1CC] transition-colors font-medium text-sm">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
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
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setViewingRecording(rec)}
                            className="text-xs text-[#5A5145] hover:text-[#453D32] border border-[#D1C6B3] hover:border-[#A6977F] rounded px-2 py-0.5 transition-colors"
                          >
                            View
                          </button>
                          <button onClick={() => handleRemoveRecording(rec.id, i)} className="text-[#A6977F] hover:text-[#D93D3D] transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {generationError && (
          <div className="mt-4 w-full max-w-5xl rounded-xl bg-[#FDECEA] border border-[#F5C6C6] px-5 py-3 text-sm text-[#D93D3D] font-mono break-all">
            <span className="font-semibold">Error: </span>{generationError}
          </div>
        )}

        <div className="mt-1 w-full max-w-5xl flex flex-col gap-1">
          <label className="text-[10px] tracking-widest text-[#B3A48C] font-semibold pl-1">ADDITIONAL CONTEXT (OPTIONAL)</label>
          <textarea
            value={customContext}
            onChange={(e) => setCustomContext(e.target.value)}
            placeholder="E.g., Focus on standard deviation, keep the tone encouraging..."
            className="w-full bg-[#EFEADF] border border-[#DFD5C2] rounded-xl p-3 text-sm text-[#5A5145] placeholder-[#B3A48C] focus:outline-none focus:border-[#A6977F] transition-colors resize-y min-h-[60px]"
          />
        </div>

        <div className="mt-2 w-full max-w-5xl flex justify-center pb-4">
          <button
            onClick={handleGenerateLesson}
            disabled={!canGenerate}
            className="px-8 py-3 rounded-full bg-[#5A5145] text-[#F6F4EE] hover:bg-[#453D32] transition-all shadow-md font-semibold tracking-wider text-sm hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
          >
            GENERATE LESSON
          </button>
        </div>
      </main>

      {/* Transcript Viewer Modal */}
      {viewingRecording && (() => {
        const rec = viewingRecording;
        const words = rec.words ?? [];
        const events = rec.engagementEvents ?? [];

        // Build disengaged intervals from events
        const intervals: { start: number; end: number }[] = [];
        let disStart: number | null = null;
        for (const ev of events) {
          if (!ev.engaged && disStart === null) disStart = ev.timestamp_seconds;
          if (ev.engaged && disStart !== null) {
            intervals.push({ start: disStart, end: ev.timestamp_seconds });
            disStart = null;
          }
        }
        if (disStart !== null) intervals.push({ start: disStart, end: rec.duration });

        const isWordDisengaged = (w: WordStamp) => {
          if (w.type === "spacing") return false;
          const mid = (w.start + w.end) / 2;
          return intervals.some((iv) => mid >= iv.start && mid <= iv.end);
        };

        const totalDis = intervals.reduce((acc, iv) => acc + (iv.end - iv.start), 0);
        const pct = rec.duration > 0 ? Math.round((totalDis / rec.duration) * 100) : 0;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setViewingRecording(null)}>
            <div className="bg-[#F6F4EE] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#DFD5C2]">
                <div>
                  <h2 className="text-lg font-medium text-[#5A5145]" style={{ fontFamily: 'ui-serif, Georgia, serif' }}>Transcript</h2>
                  <p className="text-xs text-[#A6977F] mt-0.5">{formatTime(rec.duration)} recording · {pct}% disengaged</p>
                </div>
                <button onClick={() => setViewingRecording(null)} className="text-[#A6977F] hover:text-[#5A5145] transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Timeline bar */}
              {rec.duration > 0 && (
                <div className="px-6 pt-4">
                  <div className="text-xs text-[#A6977F] mb-1 tracking-wider">ATTENTION TIMELINE</div>
                  <div className="relative h-3 rounded-full bg-[#E8F5E9] overflow-hidden">
                    {intervals.map((iv, idx) => (
                      <div
                        key={idx}
                        className="absolute top-0 h-full bg-[#FDECEA] border-l border-r border-[#F5C6C6]"
                        style={{
                          left: `${(iv.start / rec.duration) * 100}%`,
                          width: `${((iv.end - iv.start) / rec.duration) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-[#A6977F] mt-1">
                    <span>0:00</span>
                    <span>{formatTime(rec.duration)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-[#A6977F]">
                    <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-[#E8F5E9] border border-[#7A9E7E] inline-block" /> Engaged</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-[#FDECEA] border border-[#F5C6C6] inline-block" /> Disengaged</span>
                  </div>
                </div>
              )}

              {/* Transcript body */}
              <div className="overflow-y-auto px-6 py-4 max-h-[40vh]">
                {words.length > 0 ? (
                  <p className="text-sm text-[#5A5145] leading-relaxed">
                    {words.map((w, i) => (
                      w.type === "spacing" ? (
                        <span key={i}> </span>
                      ) : (
                        <span
                          key={i}
                          className={`rounded px-0.5 transition-colors ${isWordDisengaged(w) ? "bg-[#FDECEA] text-[#D93D3D]" : ""}`}
                          title={isWordDisengaged(w) ? "Disengaged" : undefined}
                        >
                          {w.text}
                        </span>
                      )
                    ))}
                  </p>
                ) : rec.transcript ? (
                  <p className="text-sm text-[#5A5145] leading-relaxed">{rec.transcript}</p>
                ) : rec.transcript === "" ? (
                  <p className="text-sm text-[#A6977F] italic">No speech detected in this recording.</p>
                ) : (
                  <p className="text-sm text-[#A6977F] italic">Transcription failed. Check backend is running.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <style jsx>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
