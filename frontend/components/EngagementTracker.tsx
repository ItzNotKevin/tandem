"use client";

import { useEffect, useRef, useState } from "react";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";

// Head pose thresholds
const MAX_YAW = 80;              // hard limit — basically full profile view, very rare in class
const BOARD_YAW = 35;            // looking at board/teacher starts here
const LOOK_DOWN_PITCH = -18;     // soft looking-down threshold
const MIN_PITCH = -60;           // hard limit
const MAX_PITCH = 55;
const MAX_LOOK_DOWN_MS = 15000;

// Context-aware grace periods — head pose is NOT a primary disengagement signal.
// Eyes closed, yawning, and drowsiness are. Head movement just reduces the score.
const MAX_AWAY_MS           = 35000; // universal limit: notes, board, or sideways — after this → distracted
const GENERIC_GRACE_MS      = 5000;  // face lost with no context → disengaged soon
const NOTES_LOST_PITCH      = -8;    // pitch threshold for "taking notes" when face disappears
const PITCH_TREND_WINDOW    = 5;     // frames to compute pitch trend over

// Eye / yawn thresholds
const EAR_THRESHOLD = 0.18;          // eyes fully closed
const EAR_DROWSY_THRESHOLD = 0.23;   // eyes heavy / half-closed
const YAWN_JAW_THRESHOLD = 0.55;     // jawOpen blendshape score
const YAWN_SUSTAIN_MS = 900;         // must hold for this long to count as yawn

// Engagement logic
const DISENGAGEMENT_THRESHOLD_MS = 6000;
const CHECK_INTERVAL_MS = 400;
const SCORE_HISTORY_LEN = 8;         // frames to smooth attention score over

function eyeAspectRatio(
  lm: { x: number; y: number }[],
  outer: number, inner: number, top: number, bottom: number
) {
  const h = Math.hypot(lm[outer].x - lm[inner].x, lm[outer].y - lm[inner].y);
  if (h < 1e-6) return 1;
  return Math.hypot(lm[top].x - lm[bottom].x, lm[top].y - lm[bottom].y) / h;
}

interface Props {
  isActive: boolean;
  onStatusChange: (engaged: boolean, lapses: number) => void;
}

export default function EngagementTracker({ isActive, onStatusChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectAt = useRef(0);
  const activeRef = useRef(false);

  const [engagedUI, setEngagedUI] = useState(true);
  const [reason, setReason] = useState("");
  const [attentionScore, setAttentionScore] = useState(100);
  const [loaded, setLoaded] = useState(false);

  // Mutable tracking state
  const startTime = useRef(0);
  const disengagedSince = useRef<number | null>(null);
  const currentlyEngaged = useRef(true);
  const lookingDownSince = useRef<number | null>(null);
  const yawningSince = useRef<number | null>(null);
  const lapseCount = useRef(0);
  const scoreHistory = useRef<number[]>([]);

  // Last-known pose — used for context when face disappears
  const lastKnownYaw   = useRef(0);
  const lastKnownPitch = useRef(0);
  const faceLostSince  = useRef<number | null>(null);
  const pitchHistory      = useRef<number[]>([]);  // for trend detection
  const boardGlanceSince  = useRef<number | null>(null); // when sideways glance started

  // Load MediaPipe once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const fl = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.2,
        minFacePresenceConfidence: 0.2,
        minTrackingConfidence: 0.2,
      });
      if (!cancelled) {
        landmarkerRef.current = fl;
        setLoaded(true);
      }
    })().catch(console.error);
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
    };
  }, []);

  // Start/stop camera when isActive or loaded changes
  useEffect(() => {
    if (!isActive || !loaded) return;
    let active = true;

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
      });
      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      // Reset all state
      startTime.current = Date.now();
      disengagedSince.current = null;
      currentlyEngaged.current = true;
      lookingDownSince.current = null;
      yawningSince.current = null;
      lapseCount.current = 0;
      scoreHistory.current = [];
      lastKnownYaw.current = 0;
      lastKnownPitch.current = 0;
      faceLostSince.current = null;
      pitchHistory.current = [];
      boardGlanceSince.current = null;

      fetch("/api/engagement/reset", { method: "POST" }).catch(() => {});

      activeRef.current = true;
      lastDetectAt.current = 0;

      function loop(ts: DOMHighResTimeStamp) {
        if (!activeRef.current) return;
        if (ts - lastDetectAt.current >= CHECK_INTERVAL_MS) {
          lastDetectAt.current = ts;
          detect(ts);
        }
        rafRef.current = requestAnimationFrame(loop);
      }
      rafRef.current = requestAnimationFrame(loop);
    })().catch(console.error);

    return () => {
      active = false;
      activeRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [isActive, loaded]);

  function detect(ts: DOMHighResTimeStamp) {
    const video = videoRef.current;
    const fl = landmarkerRef.current;
    if (!video || !fl || video.readyState < 2 || video.videoWidth === 0) return;

    let result: any;
    try { result = fl.detectForVideo(video, ts); } catch { return; }
    if (!result) return;

    if (!result.faceLandmarks?.length) {
      const now = Date.now();
      if (!faceLostSince.current) faceLostSince.current = now;
      const lostMs = now - faceLostSince.current;

      const lastPitch = lastKnownPitch.current;
      const lastYaw   = Math.abs(lastKnownYaw.current);

      // Pitch trend: negative = was trending downward when face disappeared
      const ph = pitchHistory.current;
      const pitchTrend = ph.length >= 2 ? ph[ph.length - 1] - ph[0] : 0;
      const trendingDown = pitchTrend < -3;  // at least 3° downward movement

      // Priority: check pitch (taking notes) BEFORE yaw (board)
      // Use NOTES_LOST_PITCH (looser than LOOK_DOWN_PITCH) because the face
      // detector often loses the face before pitch reaches the soft threshold
      const likelyNotes = lastPitch < NOTES_LOST_PITCH || trendingDown;
      const likelyBoard = lastYaw > BOARD_YAW && !likelyNotes;

      if (lostMs >= MAX_AWAY_MS) {
        // Been away too long regardless of context — probably distracted
        computeAndUpdate(false, `possibly on phone (${Math.round(lostMs / 1000)}s)`, false, false, 0);
      } else if (likelyNotes) {
        computeAndUpdate(true, `taking notes (${Math.round(lostMs / 1000)}s)`, true, false, 0);
      } else if (likelyBoard) {
        computeAndUpdate(true, `looking at board (${Math.round(lostMs / 1000)}s)`, false, false, 0);
      } else if (lostMs < GENERIC_GRACE_MS) {
        computeAndUpdate(true, `head moved (${Math.round(lostMs / 1000)}s)`, false, false, 0);
      } else {
        computeAndUpdate(false, "face not visible", false, false, 0);
      }
      return;
    }

    // Face found — reset lost timer and update last known pose
    faceLostSince.current = null;

    const lm = result.faceLandmarks[0];
    const now = Date.now();

    // ── Eye closure (EAR) ────────────────────────────────────────────────
    const leftEAR  = eyeAspectRatio(lm, 33, 133, 159, 145);
    const rightEAR = eyeAspectRatio(lm, 362, 263, 386, 374);
    const avgEAR   = (leftEAR + rightEAR) / 2;
    const eyesClosed = avgEAR < EAR_THRESHOLD;
    const eyesDrowsy = !eyesClosed && avgEAR < EAR_DROWSY_THRESHOLD;

    if (eyesClosed) {
      computeAndUpdate(false, `eyes closed (EAR ${avgEAR.toFixed(2)})`, false, false, 0);
      return;
    }

    // ── Yawn detection (jawOpen blendshape) ─────────────────────────────
    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
    const jawOpen: number = blendshapes.find((b: any) => b.categoryName === "jawOpen")?.score ?? 0;
    const isYawning = jawOpen > YAWN_JAW_THRESHOLD;

    if (isYawning) {
      if (!yawningSince.current) yawningSince.current = now;
    } else {
      yawningSince.current = null;
    }
    const sustainedYawn = isYawning && yawningSince.current !== null &&
      (now - yawningSince.current) > YAWN_SUSTAIN_MS;

    if (sustainedYawn) {
      computeAndUpdate(false, `yawning (jaw=${jawOpen.toFixed(2)})`, false, false, 0);
      return;
    }

    // ── Head pose ────────────────────────────────────────────────────────
    if (!result.facialTransformationMatrixes?.length) {
      computeAndUpdate(true, "tracking", false, eyesDrowsy, jawOpen);
      return;
    }
    const d     = result.facialTransformationMatrixes[0].data;
    const sy    = Math.sqrt(d[0] ** 2 + d[1] ** 2);
    const pitch = Math.atan2(-d[2], sy) * (180 / Math.PI);
    const yaw   = Math.atan2(d[1], d[0]) * (180 / Math.PI);

    // Store pose so we can use it if face disappears next frame
    lastKnownYaw.current   = yaw;
    lastKnownPitch.current = pitch;
    pitchHistory.current.push(pitch);
    if (pitchHistory.current.length > PITCH_TREND_WINDOW) pitchHistory.current.shift();

    // Hard limits
    if (Math.abs(yaw) > MAX_YAW) {
      computeAndUpdate(false, `looking too far sideways (yaw=${yaw.toFixed(0)}°)`, false, eyesDrowsy, jawOpen);
      return;
    }
    if (pitch < MIN_PITCH) {
      computeAndUpdate(false, `head too far down (pitch=${pitch.toFixed(0)}°)`, true, eyesDrowsy, jawOpen);
      return;
    }
    if (pitch > MAX_PITCH) {
      computeAndUpdate(false, `head too far up (pitch=${pitch.toFixed(0)}°)`, false, eyesDrowsy, jawOpen);
      return;
    }

    // Sideways glance — treated like "looking at board", same MAX_AWAY_MS limit
    if (Math.abs(yaw) > BOARD_YAW) {
      const now = Date.now();
      if (!boardGlanceSince.current) boardGlanceSince.current = now;
      const glanceMs = now - boardGlanceSince.current;
      if (glanceMs >= MAX_AWAY_MS) {
        computeAndUpdate(false, `looking away too long (${Math.round(glanceMs / 1000)}s)`, false, eyesDrowsy, jawOpen, Math.abs(yaw), pitch);
      } else {
        computeAndUpdate(true, `looking at board (yaw=${yaw.toFixed(0)}°)`, false, eyesDrowsy, jawOpen, Math.abs(yaw), pitch);
      }
      return;
    }
    // Facing forward again — reset sideways timer
    boardGlanceSince.current = null;

    const isLookingDown = pitch < LOOK_DOWN_PITCH;
    const label = isLookingDown
      ? `taking notes (pitch=${pitch.toFixed(0)}°)`
      : `yaw=${yaw.toFixed(0)}° pitch=${pitch.toFixed(0)}°`;
    computeAndUpdate(true, label, isLookingDown, eyesDrowsy, jawOpen, Math.abs(yaw), pitch);
  }

  function computeAndUpdate(
    rawEngaged: boolean,
    newReason: string,
    isLookingDown: boolean,
    eyesDrowsy: boolean,
    jawOpen: number,
    absYaw = 0,
    pitch = 0,
  ) {
    let engaged = rawEngaged;
    const now = Date.now();

    // ── Looking-down duration rule ───────────────────────────────────────
    if (isLookingDown && engaged) {
      if (!lookingDownSince.current) lookingDownSince.current = now;
      else if (now - lookingDownSince.current > MAX_LOOK_DOWN_MS) {
        engaged = false;
        newReason = `looking down too long (${Math.floor((now - lookingDownSince.current) / 1000)}s)`;
      }
    } else if (!isLookingDown) {
      lookingDownSince.current = null;
    }

    // ── Attention score (0–100) ──────────────────────────────────────────
    let score = 100;

    if (!engaged) {
      // Hard disengagement signals get low scores
      score = newReason.includes("yawn") ? 30
        : newReason.includes("sideways") ? 20
        : newReason.includes("down too long") ? 25
        : newReason.includes("no face") ? 10
        : 15;
    } else {
      // Partial penalties while still "engaged"
      // Yaw: linear penalty from 15° → MAX_YAW
      const yawPenalty = Math.min(20, Math.max(0, (absYaw - 15) / (MAX_YAW - 15) * 20));
      // Pitch: penalty for looking down toward LOOK_DOWN range
      const pitchPenalty = pitch < LOOK_DOWN_PITCH
        ? Math.min(15, ((LOOK_DOWN_PITCH - pitch) / (LOOK_DOWN_PITCH - MIN_PITCH)) * 15)
        : 0;
      // Drowsy eyes
      const drowsyPenalty = eyesDrowsy ? 15 : 0;
      // Jaw slightly open (pre-yawn)
      const jawPenalty = jawOpen > 0.35 ? Math.min(10, (jawOpen - 0.35) / 0.2 * 10) : 0;

      score = Math.round(Math.max(0, 100 - yawPenalty - pitchPenalty - drowsyPenalty - jawPenalty));
    }

    // Smooth over last N frames
    scoreHistory.current.push(score);
    if (scoreHistory.current.length > SCORE_HISTORY_LEN) scoreHistory.current.shift();
    const smoothed = Math.round(
      scoreHistory.current.reduce((a, b) => a + b, 0) / scoreHistory.current.length
    );
    setAttentionScore(smoothed);

    // ── Engagement state machine ─────────────────────────────────────────
    setEngagedUI(engaged);
    setReason(newReason);

    if (!engaged) {
      if (!disengagedSince.current) {
        disengagedSince.current = now;
      } else if (now - disengagedSince.current >= DISENGAGEMENT_THRESHOLD_MS && currentlyEngaged.current) {
        currentlyEngaged.current = false;
        lapseCount.current++;
        postEvent(false);
        onStatusChange(false, lapseCount.current);
        disengagedSince.current = null;
      }
    } else {
      if (!currentlyEngaged.current) {
        currentlyEngaged.current = true;
        postEvent(true);
        onStatusChange(true, lapseCount.current);
      }
      disengagedSince.current = null;
    }
  }

  function postEvent(engaged: boolean) {
    const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
    fetch("/api/engagement/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp_seconds: elapsed, engaged }),
    }).catch(() => {});
  }

  // Score color
  const scoreColor =
    attentionScore >= 70 ? "#4CAF50"
    : attentionScore >= 40 ? "#FF9800"
    : "#D93D3D";

  if (!isActive) return null;

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-[#D1C6B3] bg-[#1a1a1a]">
      <video ref={videoRef} className="w-full aspect-video object-cover" muted playsInline />

      {/* Attention score bar */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-black/30">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${attentionScore}%`, backgroundColor: scoreColor }}
        />
      </div>

      {/* Score badge */}
      <div
        className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full text-white"
        style={{ backgroundColor: scoreColor + "cc" }}
      >
        {attentionScore}
      </div>

      {/* Status overlay */}
      <div
        className={`absolute bottom-2 left-2 right-2 flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm ${
          engagedUI ? "bg-[#E8F5E9]/90 text-[#2e7d32]" : "bg-[#FDECEA]/90 text-[#D93D3D]"
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${engagedUI ? "bg-[#4CAF50]" : "bg-[#D93D3D] animate-pulse"}`} />
        <span className="truncate font-mono">
          {engagedUI ? "Engaged" : "Disengaged"} — {reason}
        </span>
      </div>

      {/* Loading overlay */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#F6F4EE]/80 text-xs text-[#A6977F] italic">
          Loading face tracker...
        </div>
      )}
    </div>
  );
}
