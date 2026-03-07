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
vertexai.init(project=VERTEX_PROJECT, location=VERTEX_LOCATION)
model = GenerativeModel("gemini-2.0-flash")

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

        prompt = f"""You are an AI tutor reviewing a student's handwritten whiteboard image.

CONTEXT:
- Target Problem: "{problem}"
- Study Materials Summary:
{summaries if summaries else '  (none uploaded)'}

TASK:
Look at the whiteboard carefully. Describe what the student has written and assess their work.
1. Write in natural spoken English only. NO LaTeX, NO markdown, NO symbols like $ or \\int.
   Use words: write "integral" not "\\int", "x squared" not "x^2", "from zero to four" not "[0,4]".
2. If the board looks blank or has very little, acknowledge that and encourage them to start.
3. NEVER say you cannot see the work.

Respond with ONLY this valid JSON (no extra text outside the JSON):
{{
    "hasMistake": false,
    "feedback": "One clear sentence describing what you see on the board in natural English.",
    "spokenResponse": "2-3 sentences Artie should say aloud. Acknowledge what the student wrote, then ask one guiding question to help them take the next step. Never give the answer. Natural spoken English only.",
    "mistakeDescription": "If hasMistake is true, plain English description of the error. Otherwise write 'none'.",
    "coordinates": null
}}"""
        
        response = model.generate_content([
            Part.from_data(data=image_bytes, mime_type="image/png"),
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

class SlideshowGenerateRequest(BaseModel):
    prompt: str
    num_slides: int = 8

@app.post("/slideshow/generate")
async def generate_slideshow(request: SlideshowGenerateRequest):
    try:
        prompt = f"""
        Generate a {request.num_slides}-slide educational slideshow about: "{request.prompt}"

        Return ONLY a JSON array of slide objects. Each slide must follow this exact schema:
        {{
            "title": "Short slide title",
            "subtitle": "One-line description",
            "keywords": ["Keyword 1", "Keyword 2", "Keyword 3"],
            "theorem": {{
                "label": "Theorem",
                "formula": "The key formula or rule for this concept (use plain Unicode math, e.g. f′(x) = lim)"
            }},
            "diagram_svg": "<svg viewBox='0 0 320 220'>...</svg>"
        }}

        For diagram_svg, generate a clean, minimal inline SVG illustration using ONLY these colors:
        - Background fill: #f5ede0
        - Axes / grid lines: #c9b99a, stroke-width 1.5
        - Curves / main shapes: #8b7355, stroke-width 2.5, fill none
        - Accent / highlight: #c17f3a
        - Text: fill #6b5a3e, font-family Georgia serif, italic where appropriate
        Use SVG text, path, rect, circle, line, polygon elements. Keep diagrams simple and educational.

        Return ONLY the raw JSON array, no markdown, no backticks.
        """

        response = model.generate_content(prompt)
        text_response = response.text.strip()
        if "```json" in text_response:
            text_response = text_response.split("```json")[1].split("```")[0].strip()
        elif "```" in text_response:
            text_response = text_response.split("```")[1].split("```")[0].strip()

        slides = json.loads(text_response)
        session_context["slideshow"] = slides
        return slides
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/slideshow/slides")
async def get_slideshow():
    return session_context.get("slideshow", [])


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
            Part.from_data(data=contents, mime_type=file.content_type),
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
            Part.from_data(data=contents, mime_type=file.content_type),
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
        text_response = model.generate_content([
            Part.from_data(data=contents, mime_type=file.content_type),
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

    lesson_prompt = f"""You are an educational content designer. Based on the provided learning materials below, generate a structured slideshow lesson.

{combined}

Create 5-8 slides that cover the main concepts from the material above.

Return ONLY a valid JSON array with no markdown, no backticks, and no extra text. Each slide must follow this exact schema:

[
  {{
    "title": "Short slide title",
    "subtitle": "One-line engaging description of this slide's concept",
    "keywords": [
      "A full descriptive sentence explaining the first key point in enough detail that a student understands it without prior context.",
      "A full descriptive sentence explaining the second key point with a specific example or implication.",
      "A full descriptive sentence explaining the third key point, connecting it to the broader concept."
    ],
    "theorem": {{
      "label": "Formula or Rule name",
      "formula": "LaTeX formula string only, e.g. \\\\frac{{d}}{{dx}}[x^n] = nx^{{n-1}}"
    }},
    "search_query": "Specific Wikimedia Commons search phrase for an educational diagram of this concept, e.g. 'definite integral area calculus' or 'chain rule function composition'"
  }}
]

Rules:
- Set "theorem" to null if no formula applies to this slide.
- For "theorem.formula": use valid LaTeX syntax only. Will be rendered with KaTeX.
- Keywords must be full descriptive sentences (1-2 sentences each), not short phrases.
- Slides should flow logically from introduction to core concepts to application."""

    response = model.generate_content(lesson_prompt)
    text = response.text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    slides = json.loads(text)

    extracted_image_urls = [f"/static/images/{f}" for f in image_files]

    def get_wikimedia_commons_image(query: str) -> Optional[str]:
        try:
            api_url = "https://commons.wikimedia.org/w/api.php"
            search_res = req_lib.get(api_url, params={
                "action": "query", "list": "search",
                "srsearch": query, "srnamespace": "6",
                "format": "json", "srlimit": 5
            }, timeout=5)
            results = search_res.json().get("query", {}).get("search", [])
            image_results = [r for r in results if any(
                r["title"].lower().endswith(ext) for ext in [".png", ".svg", ".jpg", ".jpeg"]
            )]
            if not image_results:
                return None
            title = image_results[0]["title"]
            info_res = req_lib.get(api_url, params={
                "action": "query", "titles": title,
                "prop": "imageinfo", "iiprop": "url",
                "iiurlwidth": 400, "format": "json"
            }, timeout=5)
            pages = info_res.json().get("query", {}).get("pages", {})
            for page in pages.values():
                imageinfo = page.get("imageinfo", [])
                if imageinfo:
                    return imageinfo[0].get("thumburl") or imageinfo[0].get("url")
        except Exception:
            pass
        return None

    for i, slide in enumerate(slides):
        search_query = slide.pop("search_query", "")
        if i < len(extracted_image_urls):
            slide["diagram_image_url"] = extracted_image_urls[i]
        else:
            commons_url = get_wikimedia_commons_image(search_query) if search_query else None
            slide["diagram_image_url"] = commons_url
        slide.pop("diagram_svg", None)

    session_context["slideshow"] = slides
    lesson = {"slides": slides, "images": extracted_image_urls}
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
