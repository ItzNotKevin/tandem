# Tandem
Tandem is a fully interactive AI study companion that transitions students from passive note-taking to active, hands-on problem solving. 

Unlike traditional study apps or static videos, Tandem acts as a **true real-time tutor** right entirely in your browser. It doesn't just read your notes—it watches you work, understands your math, and dynamically talks to you as you solve complex problems.

## The AI Tutor Experience
Tandem is built around a powerful, multi-modal conversational AI designed to truly "see" and "speak".

-  **Natural Conversational Flow:** Have realistic back-and-forth verbal conversations with your tutor while you work. If the AI is explaining a concept and you suddenly realize the answer, you can **interrupt it mid-sentence**, and it will actively listen, gracefully halt, and pivot to address your new thought.
-  **Live Whiteboard Vision:** The AI has a real-time view into your digital whiteboard. As you draw out math problems, equations, or diagrams, it watches your strokes and understands the context of what you are doing.
-  **Step-by-Step Understanding:** Tandem tracks intermediate steps, not just final answers. If you make a mistake halfway through a long calculation, the AI will spot it and gently guide you back on track without just giving away the answer.
-  **Correctness Validation:** The AI actively mathematically proves and validates your handwritten work. It knows exactly when you have successfully solved a problem, triggering rewarding congratulations and moving you seamlessly to the next challenge.

## Core Workflow
### 1) Session Setup (`/record`)
- Upload supporting files (PDF, PNG, JPG) like syllabuses or practice tests.
- Record live lecture audio clips.
- Tandem transcribes the audio and merges it with the uploaded materials into one cohesive context base.

### 2) Lesson Generation (`/api/generate-lesson`)
- The backend extracts texts and concepts.
- Gemini instantly parses the raw material into a structured, easily digestible slide deck featuring titles, keywords, formulas, and relevant diagram images.

### 3) Slideshow Review (`/slideshow`)
- Review your AI-generated concept slides to refresh on the core formulas and topics before diving into practice.

### 4) Active Whiteboard Tutoring (`/whiteboard`)
- The core of Tandem. Put the notes away and start solving problems on the whiteboard.
- Speak directly with the interactive tutor.
- The tutor watches every stroke, evaluates your steps, provides Socratic guidance, and dynamically adapts its conversational tone based on your progress.

## Tech Stack
- **Frontend:** Next.js, React, TailwindCSS, TLDraw
- **Backend:** FastAPI (Python)
- **AI Models:** Vertex AI Gemini 1.5 Pro (Multimodal Vision + Reasoning) & Imagen
- **Conversational AI:** ElevenLabs (Real-time Speech, VAD, and Interruption Logic)
- **Engagement Signals:** MediaPipe Face Landmarker

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

## Required Environment Variables
For the Backend (required for AI vision/generation and conversational routing):
- `VERTEX_PROJECT`
- `VERTEX_LOCATION`
- `ELEVEN_LABS_API_KEY`

For the Frontend:
- `NEXT_PUBLIC_BACKEND_URL` (default: `http://localhost:8000`)
- `NEXT_PUBLIC_ELEVEN_LABS_AGENT_ID`
