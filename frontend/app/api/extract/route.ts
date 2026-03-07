import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export async function POST(req: NextRequest) {
  const formData = await req.formData()

  const backendRes = await fetch(`${BACKEND_URL}/extract`, {
    method: 'POST',
    body: formData,
  })

  if (!backendRes.ok) {
    return NextResponse.json(
      { error: 'Extraction failed', status: backendRes.status },
      { status: 502 }
    )
  }

  const data = await backendRes.json()
  return NextResponse.json(data)
}
