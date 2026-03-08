# Tandem
Tandem is an AI learning app that turns your lecture material into an interactive study session.

Built for HackCanada, it helps students go from passive notes to active problem-solving.

## What Tandem Does
1. You upload class material (PDF/image) and optionally record your own explanation.
2. Tandem extracts key concepts and generates a clean slideshow lesson.
3. You move into a whiteboard mode and solve a practice problem.
4. An AI tutor gives live guidance (Socratic style) instead of giving away the answer.
5. Engagement tracking helps the system detect focus lapses during recording.

## Why It Exists
Most tools summarize content, but students still get stuck when applying it.
Tandem focuses on the "last mile": guided practice, feedback, and active learning.

## Main Features
- AI-generated lesson slides from uploaded material + transcript
- Voice-assisted whiteboard tutor for step-by-step coaching
- Engagement tracking during recording (MediaPipe-based)
- Session context carried across record -> slideshow -> whiteboard

## Tech Stack
- Frontend: Next.js, React, Tailwind
- Backend: FastAPI (Python)
- AI: Vertex AI Gemini + Imagen
- Speech: ElevenLabs
- Vision/Engagement: MediaPipe Face Landmarker

## Project Structure
- `frontend/`: UI, API proxy routes, pages (`/record`, `/slideshow`, `/whiteboard`)
- `backend/`: lesson generation, whiteboard analysis, transcription, engagement endpoints

## Local Setup
### 1) Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables
Backend expects AI/speech config (for example):
- `VERTEX_PROJECT`
- `VERTEX_LOCATION`
- `ELEVEN_LABS_API_KEY`

Frontend uses:
- `BACKEND_URL` (defaults to `http://localhost:8000`)

## Demo Flow (Judge-Friendly)
1. Open landing page and click **Start Session**
2. Upload a PDF/image and record a short explanation
3. Click **Generate Lesson**
4. Walk through generated slides
5. Continue to whiteboard and interact with the tutor

## Status
Active hackathon prototype with end-to-end flow working locally.
