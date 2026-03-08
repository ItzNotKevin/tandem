# Tandem
Tandem is an AI-powered lecture companion that converts raw class input into a structured study session and guided problem-solving flow.

It helps students transition from passive note taking, to actual problem solving and memorization.

## Product Overview
Most students can collect notes, but still struggle to turn those notes into understanding they can apply under pressure.  
Tandem is designed to bridge that gap with a single workflow:

1. Ingest lecture material (PDFs/images) and lecture audio.
2. Extract key concepts and generate a focused lesson slideshow.
3. Move into an interactive whiteboard stage for active practice.
4. Receive tutor-style guidance that nudges the student to think, not just copy answers.

## What Tandem Actually Records
Tandem records and transcribes **lecture audio** for study context.  
It does **not** record the student as a video lecture.

The engagement module may access camera input locally for attention signals during a session, but the core lesson-generation recording flow is lecture audio + uploaded materials.

## Core Experience
### 1) Session Setup (`/record`)
- Upload supporting files (PDF, PNG, JPG).
- Record lecture audio clips.
- Transcribe clips and combine transcript + file content into one learning context.
- Track engagement signals while the session is active.

### 2) Lesson Generation (`/api/generate-lesson` -> backend)
- Backend extracts text from uploads.
- Gemini generates a structured slide set (titles, keywords, formulas, diagram search hints).
- Relevant diagram images are selected and attached.
- Output is saved as slideshow session context.

### 3) Slideshow Learning (`/slideshow`)
- Student reviews AI-generated concept slides.
- Each slide emphasizes concise explanations, key points, and formulas.
- Flow moves directly into problem-solving mode.

### 4) Whiteboard Tutoring (`/whiteboard`)
- Student writes out steps in a whiteboard UI.
- Backend analyzes whiteboard snapshots.
- Tutor responds in a Socratic style (ask guiding questions, identify mistakes, avoid giving final answer directly).

## Main Features
- AI lesson generation from mixed inputs (docs + lecture audio transcript)
- Whiteboard-first guided tutoring loop
- Formula rendering support for math-heavy content
- Engagement signal tracking integrated into session context
- Persistent cross-stage context from record -> slideshow -> whiteboard

## Tech Stack
- Frontend: Next.js, React, Tailwind
- Backend: FastAPI (Python)
- AI Models: Vertex AI Gemini + Imagen
- Speech/Transcription: ElevenLabs
- Engagement Signals: MediaPipe Face Landmarker

## Project Structure
- `frontend/`: app pages, API proxy routes, UI components
- `backend/`: lesson generation, transcription, whiteboard analysis, engagement endpoints

## Local Setup
### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000`  
Backend: `http://localhost:8000`

## Environment Variables
Backend (required for AI/speech paths):
- `VERTEX_PROJECT`
- `VERTEX_LOCATION`
- `ELEVEN_LABS_API_KEY`

Frontend:
- `BACKEND_URL` (default: `http://localhost:8000`)

## Demo Walkthrough
1. Click **Start Session**
2. Upload lecture material and record lecture audio
3. Click **Generate Lesson**
4. Review slides and proceed to whiteboard
5. Solve with tutor guidance and feedback
