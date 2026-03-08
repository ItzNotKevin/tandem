const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

export interface AISlide {
  title: string
  subtitle: string
  keywords: string[]
  theorem: { label: string; formula: string } | null
  diagram_image_url: string | null
  script: string
}

export async function generateSlides(prompt: string, numSlides = 8): Promise<AISlide[]> {
  const res = await fetch(`${BACKEND_URL}/slideshow/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, num_slides: numSlides }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSessionSlides(): Promise<AISlide[]> {
  const res = await fetch(`${BACKEND_URL}/slideshow/slides`)
  if (!res.ok) return []
  return res.json()
}

export async function getNarratorContext(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/slideshow/narrator-context`)
  if (!res.ok) return ''
  const data = await res.json()
  return data.context || ''
}
