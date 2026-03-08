import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export async function POST() {
  await fetch(`${BACKEND_URL}/engagement/reset`, { method: 'POST' })
  return NextResponse.json({ status: 'ok' })
}
