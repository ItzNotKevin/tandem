from fastapi import FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import os, base64, json, asyncio, uuid, requests as req_lib
import websockets as ws_lib
from dotenv import load_dotenv
import vertexai
from vertexai.generative_models import GenerativeModel, Part
import fitz  # pymupdf

load_dotenv()

VERTEX_PROJECT = os.getenv("VERTEX_PROJECT")
VERTEX_LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

vertexai.init(project=VERTEX_PROJECT, location=VERTEX_LOCATION)
model = GenerativeModel("gemini-2.0-flash")

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
    "current_problem": "What are we working on today?",
    "file_summaries": [],
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
        image_part = Part.from_data(data=image_bytes, mime_type="image/png")

        problem = request.questionContext or session_context["current_problem"]
        file_summaries = session_context.get("file_summaries", [])
        summaries = "\n".join([f"- {f['filename']}: {f['summary']}" for f in file_summaries if isinstance(f, dict)])

        prompt = f"""
        Analysis Context:
        Target Question: "{problem}"
        Imported Materials: {summaries}

        Analyze the student's whiteboard. Are they solving the question correctly?
        Return JSON:
        {{
            "hasMistake": boolean,
            "feedback": "Concise, supportive feedback.",
            "mistakeDescription": "Technical detail.",
            "coordinates": {{ "x": 0, "y": 0 }}
        }}
        """

        response = model.generate_content([image_part, prompt])
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
        context = body.get("context", "Calculus")
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


@app.post("/extract")
async def extract_content(file: UploadFile = File(...)):
    allowed_types = {"application/pdf", "image/png", "image/jpeg"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")
    try:
        contents = await file.read()
        file_part = Part.from_data(data=contents, mime_type=file.content_type)
        prompt = "Extract all text from this document exactly as it appears. Do not summarize. Return only the raw extracted text."
        response = model.generate_content([file_part, prompt])
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
    files: List[UploadFile] = File(default=[]),
    transcript: str = Form(""),
):
    all_text_parts = []
    image_files = []

    for file in files:
        if not file.filename:
            continue
        contents = await file.read()

        # Extract text
        file_part = Part.from_data(data=contents, mime_type=file.content_type)
        text_response = model.generate_content([
            file_part,
            "Extract all text from this document exactly as it appears. Return only raw text."
        ])
        all_text_parts.append(text_response.text.strip())

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

    extracted_text = "\n\n".join(all_text_parts)

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
        async with ws_lib.connect(el_url, additional_headers={"xi-api-key": ELEVENLABS_API_KEY}) as el_ws:
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
            headers={"xi-api-key": ELEVENLABS_API_KEY},
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
