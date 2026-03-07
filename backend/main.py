from fastapi import FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import base64
import json
import asyncio
import websockets as ws_lib
from dotenv import load_dotenv
import vertexai
from vertexai.generative_models import GenerativeModel, Part

load_dotenv()

VERTEX_PROJECT = os.getenv("VERTEX_PROJECT")
VERTEX_LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

vertexai.init(project=VERTEX_PROJECT, location=VERTEX_LOCATION)
model = GenerativeModel("gemini-2.0-flash")

# In-memory storage for extracted content
session_content: dict = {}

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class WhiteboardAnalysisRequest(BaseModel):
    imageBase64: str
    questionContext: str
    timestamp: int

@app.get("/")
async def root():
    return {"message": "Cursor for Calculus Backend is running"}

@app.post("/whiteboard/analyze")
async def analyze_whiteboard(request: WhiteboardAnalysisRequest):
    try:
        img_data = request.imageBase64
        if "," in img_data:
            img_data = img_data.split(",")[1]

        image_bytes = base64.b64decode(img_data)
        image_part = Part.from_data(data=image_bytes, mime_type="image/png")

        prompt = f"""
        Analyze this student's whiteboard work for the following question: "{request.questionContext}".

        Compare the student's work to the correct solution.
        If they made a mistake, describe it concisely.

        Return the result in JSON format:
        {{
            "hasMistake": boolean,
            "feedback": "A concise, encouraging correction if a mistake is found, otherwise keep it short.",
            "mistakeDescription": "A technical description of the error."
        }}
        """

        response = model.generate_content([image_part, prompt])

        text_response = response.text.strip()
        if "```json" in text_response:
            text_response = text_response.split("```json")[1].split("```")[0].strip()
        elif "```" in text_response:
            text_response = text_response.split("```")[1].split("```")[0].strip()

        return json.loads(text_response)
    except Exception as e:
        return {
            "hasMistake": False,
            "feedback": "Analyzed successfully, but couldn't parse structured feedback.",
            "mistakeDescription": str(e)
        }

@app.post("/problem/generate")
async def generate_problem(request: Request):
    try:
        body = await request.json()
        context = body.get("context", "Calculus")

        prompt = f"Generate a challenging but solvable {context} problem for a student. Return JSON: {{\"question\": \"...\", \"solution\": \"...\", \"context\": \"...\"}}"

        response = model.generate_content(prompt)
        text_response = response.text.strip()
        if "```json" in text_response:
            text_response = text_response.split("```json")[1].split("```")[0].strip()
        elif "```" in text_response:
            text_response = text_response.split("```")[1].split("```")[0].strip()

        return json.loads(text_response)
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

        prompt = "Extract all text from this document exactly as it appears. Do not summarize, paraphrase, or omit anything. Return only the raw extracted text."

        response = model.generate_content([file_part, prompt])
        extracted_text = response.text.strip()

        session_content["extracted_text"] = extracted_text

        return {"text": extracted_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vertex AI extraction failed: {str(e)}")

@app.get("/content")
async def get_content():
    return {"text": session_content.get("extracted_text", "")}

@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket):
    await websocket.accept()
    el_url = "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime"

    try:
        print(f"Connecting to ElevenLabs: {el_url}")
        async with ws_lib.connect(el_url, additional_headers={"xi-api-key": ELEVENLABS_API_KEY}) as el_ws:
            print("Connected to ElevenLabs")
            async def recv_from_client():
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        await el_ws.send(data)
                except (WebSocketDisconnect, Exception) as e:
                    print(f"recv_from_client error: {e}")
                    await el_ws.close()

            async def recv_from_el():
                try:
                    async for message in el_ws:
                        print(f"ElevenLabs message: {message[:200]}")
                        await websocket.send_text(message)
                except Exception as e:
                    print(f"recv_from_el error: {e}")

            await asyncio.gather(recv_from_client(), recv_from_el())
    except Exception as e:
        print(f"ElevenLabs WebSocket error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass

class TranscriptRequest(BaseModel):
    transcript: str

@app.post("/transcript")
async def store_transcript(request: TranscriptRequest):
    session_content["transcript"] = request.transcript
    return {"status": "ok"}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        res = __import__("requests").post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            files={"file": (file.filename, contents, file.content_type)},
            data={"model_id": "scribe_v1"},
        )
        if not res.ok:
            raise HTTPException(status_code=res.status_code, detail=res.text)
        data = res.json()
        text = data.get("text", "")
        session_content["transcript"] = text
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
