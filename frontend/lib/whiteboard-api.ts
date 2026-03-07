/**
 * whiteboard-api.ts
 *
 * Utility for sending tldraw canvas snapshots to the backend for AI analysis.
 * The backend (FastAPI) will forward the image to the VLM and return feedback.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SnapshotPayload {
  /** Base64-encoded PNG data URL of the canvas */
  imageBase64: string
  /** The question the student is currently answering */
  questionContext: string
  timestamp: number
}

export interface FeedbackResponse {
  hasMistake: boolean
  /** Human-readable feedback to pass to ElevenLabs for voice delivery */
  feedback: string | null
  /** Optional hint about where on the board the mistake is */
  mistakeDescription: string | null
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * Sends a whiteboard snapshot to the Next.js API route, which proxies it to
 * the FastAPI backend for VLM analysis.
 *
 * @param imageBase64 - data-URL string from `WhiteboardSnapshot.base64`
 * @param questionContext - the current practice question text
 */
export async function analyzeWhiteboard(
  imageBase64: string,
  questionContext: string
): Promise<FeedbackResponse> {
  const payload: SnapshotPayload = {
    imageBase64,
    questionContext,
    timestamp: Date.now(),
  }

  const res = await fetch('/api/whiteboard/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error(`Whiteboard analysis request failed: ${res.status}`)
  }

  return res.json() as Promise<FeedbackResponse>
}
