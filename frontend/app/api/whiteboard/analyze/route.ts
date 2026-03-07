/**
 * POST /api/whiteboard/analyze
 *
 * Proxies the canvas snapshot + question context to the FastAPI backend.
 * The backend forwards to the VLM (Gemini 2.5 Pro / GPT-4o) and returns
 * structured feedback.
 *
 * Expected request body: SnapshotPayload (see lib/whiteboard-api.ts)
 * Expected response:     FeedbackResponse (see lib/whiteboard-api.ts)
 */

import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export async function POST(req: NextRequest) {
  const body = await req.json()

  const backendRes = await fetch(`${BACKEND_URL}/whiteboard/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!backendRes.ok) {
    return NextResponse.json(
      { error: 'Backend analysis failed', status: backendRes.status },
      { status: 502 }
    )
  }

  const data = await backendRes.json()
  return NextResponse.json(data)
}
