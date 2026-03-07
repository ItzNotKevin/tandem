from fastapi import FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import os, base64, json, asyncio, uuid, requests as req_lib
import websockets as ws_lib
from dotenv import load_dotenv
import google.generativeai as genai
from PIL import Image
import fitz  # pymupdf

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-flash-lite-latest')

ELEVEN_LABS_API_KEY = os.getenv("ELEVEN_LABS_API_KEY")

IMAGES_DIR = "static/images"
os.makedirs(IMAGES_DIR, exist_ok=True)

# Unified in-memory session
session_content: dict = {
    "extracted_text": "",
    "transcript": "",
    "lesson": None,
    "images": [],
}

session_context: dict = {
    # ── TEST DATA ── Remove before production ──────────────────────────────
    "current_problem": "Evaluate the integral ∫(2x + 3) dx from 0 to 4, and verify your answer.",
    "file_summaries": [
        {
            "filename": "[DEMO] Calculus_Chapter5_Integrals.pdf",
            "type": "application/pdf",
            "summary": (
                "CORE CONCEPTS: Definite integrals, the Fundamental Theorem of Calculus, "
                "anti-differentiation rules (power rule, constant rule). "
                "KEY PRINCIPLES: The integral of x^n is x^(n+1)/(n+1). "
                "The definite integral from a to b measures the net area under the curve. "
                "POTENTIAL PRACTICE PROBLEMS: "
                "1) Evaluate ∫(2x + 3)dx from 0 to 4. "
                "2) Find the area under f(x) = x² from x=1 to x=3. "
                "SESSION GOAL: The student should master applying the power rule to evaluate definite integrals."
            )
        }
    ],
    # ──────────────────────────────────────────────────────────────────────
    "last_analysis": None,
}

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WhiteboardAnalysisRequest(BaseModel):
    imageBase64: str
    questionContext: Optional[str] = None
    timestamp: int


class TranscriptRequest(BaseModel):
    transcript: str


@app.get("/")
async def root():
    return {"message": "Cursor for Calculus Backend is running"}


@app.get("/session/context")
async def get_session_context():
    return session_context


@app.post("/whiteboard/analyze")
async def analyze_whiteboard(request: WhiteboardAnalysisRequest):
    try:
        img_data = request.imageBase64
        if "," in img_data:
            img_data = img_data.split(",")[1]
        image_bytes = base64.b64decode(img_data)

        # Build context from session
        problem = request.questionContext or session_context["current_problem"]
        file_summaries = session_context.get("file_summaries", [])
        summaries = "\n".join([f"- {f['filename']}: {f['summary']}" for f in file_summaries if isinstance(f, dict)])

        prompt = f"""You are an AI tutor reviewing a student's whiteboard image.

CONTEXT:
- Target Problem: "{problem}"
- Study Materials Summary:
{summaries if summaries else "  (none uploaded)"}

TASK:
Look at the whiteboard image carefully. The student may be at an early stage.
1. Describe what you see (numbers, symbols, shapes, equations, or a blank board).
2. Compare what is written to the target problem. Are they working towards the correct answer?
3. If the board appears blank or minimal, still respond — note it's early and encourage them to begin.
4. NEVER say you "can't see the work" — always give a helpful, encouraging observation.

Respond with ONLY this valid JSON (no extra text):
{{
    "hasMistake": false,
    "feedback": "A specific, encouraging sentence about what you see and what to try next.",
    "mistakeDescription": "If hasMistake is true, describe the error technically. Otherwise write 'none'.",
    "coordinates": null
}}"""
        
        response = model.generate_content([
            {"mime_type": "image/png", "data": image_bytes},
            prompt
        ])
        text = response.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        analysis = json.loads(text)
        session_context["last_analysis"] = analysis
        return analysis
    except Exception as e:
        return {
            "hasMistake": False,
            "feedback": "Could not parse structured feedback.",
            "mistakeDescription": str(e)
        }


@app.post("/problem/generate")
async def generate_problem(request: Request):
    try:
        body = await request.json()
        context = body.get("context", "General Subject")
        prompt = f"Generate a challenging but solvable {context} problem for a student. Return ONLY JSON: {{\"question\": \"...\", \"solution\": \"...\", \"context\": \"...\"}}"
        response = model.generate_content(prompt)
        text = response.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        result = json.loads(text)
        session_context["current_problem"] = result["question"]
        return result
    except Exception as e:
        return {"error": str(e)}


@app.post("/session/upload")
async def upload_material(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        
        # Summarize for the voice agent's context
        prompt = """
        Extract the following to help an AI Tutor guide a student:
        1. CORE CONCEPTS: The main topics covered.
        2. KEY PRINCIPLES: Any specific rules or frameworks.
        3. POTENTIAL PRACTICE PROBLEMS: Specific examples found.
        Return a concise summary.
        """
        response = model.generate_content([
            {"mime_type": file.content_type, "data": contents},
            prompt
        ])
        summary = response.text.strip()
        
        file_info = {
            "filename": file.filename,
            "type": file.content_type,
            "summary": summary
        }
        
        if not isinstance(session_context.get("file_summaries"), list):
            session_context["file_summaries"] = []
            
        session_context["file_summaries"].append(file_info)
        return file_info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract")
async def extract_content(file: UploadFile = File(...)):
    allowed_types = {"application/pdf", "image/png", "image/jpeg"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")
    try:
        contents = await file.read()
        prompt = "Summarize this document for an AI tutor's context."
        response = model.generate_content([
            {"mime_type": file.content_type, "data": contents},
            prompt
        ])
        extracted_text = response.text.strip()
        session_content["extracted_text"] = extracted_text
        return {"text": extracted_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


@app.get("/content")
async def get_content():
    return {"text": session_content.get("extracted_text", "")}


@app.post("/generate-lesson")
async def generate_lesson(
    file: UploadFile = File(None),
    transcript: str = Form(""),
):
    extracted_text = ""
    image_files = []

    if file and file.filename:
        contents = await file.read()

        # Extract text
        text_response = model.generate_content([
            {"mime_type": file.content_type, "data": contents},
            "Extract all text from this document exactly as it appears. Return only raw text."
        ])
        extracted_text = text_response.text.strip()

        # Extract images
        if file.content_type == "application/pdf":
            try:
                pdf_doc = fitz.open(stream=contents, filetype="pdf")
                for page_num in range(len(pdf_doc)):
                    for img in pdf_doc[page_num].get_images():
                        xref = img[0]
                        base_image = pdf_doc.extract_image(xref)
                        ext = base_image["ext"]
                        filename = f"{uuid.uuid4()}.{ext}"
                        with open(os.path.join(IMAGES_DIR, filename), "wb") as f:
                            f.write(base_image["image"])
                        image_files.append(filename)
            except Exception:
                pass
        elif file.content_type in ["image/png", "image/jpeg"]:
            ext = "png" if "png" in file.content_type else "jpg"
            filename = f"{uuid.uuid4()}.{ext}"
            with open(os.path.join(IMAGES_DIR, filename), "wb") as f:
                f.write(contents)
            image_files.append(filename)

    session_content["extracted_text"] = extracted_text
    session_content["transcript"] = transcript
    session_content["images"] = image_files

    combined = f"UPLOADED MATERIAL:\n{extracted_text}\n\nLECTURE TRANSCRIPT:\n{transcript}"

    lesson_prompt = f"""Based on this educational material, create a structured lesson.

{combined}

Return ONLY valid JSON in this exact format:
{{
  "audio_script": "A natural, conversational spoken script for an AI tutor to read aloud. Engaging tone, 2-3 minutes when spoken at normal pace.",
  "slides": [
    {{
      "title": "Topic title",
      "subtitle": "One-line engaging description",
      "keywords": ["key point 1", "key point 2", "key point 3"],
      "theorem": {{ "label": "Formula or Rule name", "formula": "the formula or rule" }}
    }}
  ]
}}

Generate 5-8 slides covering the main concepts. Set theorem to null if no formula applies. Keep keywords concise (3-4 per slide)."""

    response = model.generate_content(lesson_prompt)
    text = response.text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    lesson = json.loads(text)
    lesson["images"] = [f"/static/images/{f}" for f in image_files]
    session_content["lesson"] = lesson
    return lesson


@app.get("/lesson")
async def get_lesson():
    if not session_content["lesson"]:
        raise HTTPException(status_code=404, detail="No lesson generated yet")
    return session_content["lesson"]


@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket):
    await websocket.accept()
    el_url = "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime"
    try:
        async with ws_lib.connect(el_url, additional_headers={"xi-api-key": ELEVEN_LABS_API_KEY}) as el_ws:
            async def recv_from_client():
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        await el_ws.send(data)
                except (WebSocketDisconnect, Exception):
                    await el_ws.close()

            async def recv_from_el():
                try:
                    async for message in el_ws:
                        await websocket.send_text(message)
                except Exception:
                    pass

            await asyncio.gather(recv_from_client(), recv_from_el())
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


@app.post("/transcript")
async def store_transcript(request: TranscriptRequest):
    session_content["transcript"] = request.transcript
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        res = req_lib.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": ELEVEN_LABS_API_KEY},
            files={"file": (file.filename, contents, file.content_type)},
            data={"model_id": "scribe_v1"},
        )
        if not res.ok:
            raise HTTPException(status_code=res.status_code, detail=res.text)
        text = res.json().get("text", "")
        session_content["transcript"] = text
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
