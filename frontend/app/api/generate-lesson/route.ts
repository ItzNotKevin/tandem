import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''
    const body = await req.arrayBuffer()

    const backendRes = await fetch(`${BACKEND_URL}/generate-lesson`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    })

    if (!backendRes.ok) {
      const errorText = await backendRes.text()
      console.error('[generate-lesson] Backend error:', backendRes.status, errorText)
      return NextResponse.json({ error: errorText }, { status: 502 })
    }

    return NextResponse.json(await backendRes.json())
  } catch (e) {
    console.error('[generate-lesson] Route error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
