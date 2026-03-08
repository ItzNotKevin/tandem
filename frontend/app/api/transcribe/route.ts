import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export async function POST(req: NextRequest) {
  const formData = await req.formData()

  const backendRes = await fetch(`${BACKEND_URL}/transcribe`, {
    method: 'POST',
    body: formData,
  })

  if (!backendRes.ok) {
    const detail = await backendRes.text()
    return NextResponse.json({ error: detail }, { status: 502 })
  }

  return NextResponse.json(await backendRes.json())
}
