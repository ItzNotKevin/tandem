from fastapi import FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import os, base64, json, asyncio, uuid, requests as req_lib, re
import websockets as ws_lib
from dotenv import load_dotenv
import vertexai
from vertexai.generative_models import GenerativeModel, Part
from vertexai.preview.vision_models import ImageGenerationModel
import fitz  # pymupdf

load_dotenv()

VERTEX_PROJECT = os.getenv("VERTEX_PROJECT")
VERTEX_LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
vertexai.init(project=VERTEX_PROJECT, location=VERTEX_LOCATION)
model = GenerativeModel("gemini-2.0-flash")
imagen_model = ImageGenerationModel.from_pretrained("imagen-3.0-generate-002")

ELEVEN_LABS_API_KEY = os.getenv("ELEVEN_LABS_API_KEY")

IMAGES_DIR = "static/images"
os.makedirs(IMAGES_DIR, exist_ok=True)

# Unified in-memory session
session_content: dict = {
    "extracted_text": "",
    "transcript": "",
    "lesson": None,
    "images": [],
    "engagement_events": [],
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
        
        last_analysis = session_context.get("last_analysis")
        last_analysis_text = ""
        if last_analysis:
            last_analysis_text = f"\n- PREVIOUS ANALYSIS OF THIS BOARD:\n  What you saw: {last_analysis.get('feedback', 'None')}\n  What you said: {last_analysis.get('spokenResponse', 'None')}"

        prompt = f"""You are an AI tutor reviewing a student's handwritten whiteboard image.

CONTEXT:
- Target Problem: "{problem}"
- Study Materials Summary:
{summaries if summaries else '  (none uploaded)'}{last_analysis_text}

TASK:
Look at the whiteboard carefully. Describe what the student has written and assess their work.
IF YOU HAVE A PREVIOUS ANALYSIS: Focus ONLY on what is **NEW, CHANGED, or ADDED** since the last time you looked. Do not re-explain the entire board or repeat your previous spoken response. Address only the student's latest step.
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
  try:
    all_text_parts = []
    image_files = []
    uploaded_file_summaries = []

    for file in files:
        if not file.filename:
            continue
        contents = await file.read()

        # Extract text
        text_response = model.generate_content([
            Part.from_data(data=contents, mime_type=file.content_type),
            "Extract all text from this document exactly as it appears. Return only raw text."
        ])
        extracted = text_response.text.strip()
        all_text_parts.append(extracted)
        uploaded_file_summaries.append({
            "filename": file.filename,
            "type": file.content_type,
            "summary": extracted[:2000],  # keep summary concise for whiteboard context
        })

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

    engagement_events = session_content.get("engagement_events", [])
    disengaged = [e for e in engagement_events if not e["engaged"]]
    engagement_note = ""
    if disengaged:
        times = ", ".join([f"{e['timestamp_seconds']}s" for e in disengaged])
        engagement_note = f"\n\nSTUDENT ENGAGEMENT NOTE: The student was detected as disengaged at these points during the recording: {times}. Pay extra attention to the concepts covered around those timestamps — consider dedicating a slide to re-explaining or reinforcing that material clearly."

    combined = f"UPLOADED MATERIAL:\n{extracted_text}\n\nLECTURE TRANSCRIPT:\n{transcript}{engagement_note}"

    lesson_prompt = f"""You are an educational content designer. Based on the provided learning materials below, generate a focused slideshow lesson.

{combined}

Create 5-8 slides covering the most important concepts from the material. Be concise — students should be able to scan each slide in under 30 seconds.

Return ONLY a valid JSON array with no markdown, no backticks, and no extra text. Each slide must follow this exact schema:

[
  {{
    "title": "Short slide title (4 words max)",
    "subtitle": "One crisp line describing the concept",
    "keywords": [
      "Brief key point 1 — one short sentence only.",
      "Brief key point 2 — one short sentence only.",
      "Brief key point 3 — one short sentence only."
    ],
    "theorem": {{
      "label": "Formula name",
      "formula": "LaTeX formula string only, e.g. \\\\frac{{d}}{{dx}}[x^n] = nx^{{n-1}}"
    }},
    "commons_queries": [
      "specific calculus/mathematics SVG phrase, e.g. 'riemann sum left endpoint calculus interval'",
      "broader calculus phrase, e.g. 'riemann sum rectangle approximation mathematics'",
      "general calculus fallback, e.g. 'definite integral calculus diagram'"
    ],
    "geogebra_query": "short math term for GeoGebra, e.g. 'riemann sum', 'chain rule', 'definite integral'"
  }}
]

Rules:
- Set "theorem" to null if no formula applies to this slide.
- For "theorem.formula": valid LaTeX only, rendered with KaTeX.
- Keywords: ONE short sentence each (under 15 words). No padding. Extract only the most important fact.
- For "commons_queries": ALWAYS include the word "calculus" or "mathematics" in every phrase to avoid domain confusion. Rank from most to least specific.
- For "geogebra_query": concise math term only.
- Slides should flow logically from introduction to core concept to application."""

    response = model.generate_content(lesson_prompt)
    text = response.text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    # Iteratively fix unescaped LaTeX backslashes (e.g. \frac → \\frac).
    # json.JSONDecodeError.pos is just after the bad backslash — double it and retry.
    slides = None
    for _ in range(100):
        try:
            slides = json.loads(text)
            break
        except json.JSONDecodeError as e:
            if 'escape' in str(e).lower():
                # C JSON ext: e.pos AT the backslash; Python impl: e.pos AFTER it
                if e.pos < len(text) and text[e.pos] == '\\':
                    text = text[:e.pos] + '\\\\' + text[e.pos + 1:]
                elif e.pos > 0 and text[e.pos - 1] == '\\':
                    text = text[:e.pos - 1] + '\\\\' + text[e.pos:]
                else:
                    raise
            else:
                raise
    if slides is None:
        raise HTTPException(status_code=500, detail="Slide generation failed: JSON parsing error")

    # Self-correction pass: Gemini reviews its own output and fixes issues before image search.
    review_prompt = f"""You generated the following slide definitions for a calculus/mathematics course. Review and fix any problems.

{json.dumps(slides, indent=2)}

Check each slide for these issues and fix them:
1. commons_queries: Every phrase MUST be specific to mathematics/calculus. If any query could return non-math results (e.g. computer science, networking, biology), rewrite it to include explicit mathematical context like "calculus", "mathematics", "number line", "graph function", etc.
2. keywords: Each must be a single short sentence (under 15 words). Condense any that are too long.
3. theorem.formula: Must be valid LaTeX. Fix any broken formulas.
4. title: Must be 4 words or fewer.

Return ONLY the corrected JSON array. No markdown, no explanation, no extra text. If a field is already correct, leave it unchanged."""

    try:
        review_resp = model.generate_content(review_prompt)
        review_text = review_resp.text.strip()
        if "```json" in review_text:
            review_text = review_text.split("```json")[1].split("```")[0].strip()
        elif "```" in review_text:
            review_text = review_text.split("```")[1].split("```")[0].strip()
        reviewed = None
        for _ in range(100):
            try:
                reviewed = json.loads(review_text)
                break
            except json.JSONDecodeError as e:
                if 'escape' in str(e).lower():
                    if e.pos < len(review_text) and review_text[e.pos] == '\\':
                        review_text = review_text[:e.pos] + '\\\\' + review_text[e.pos + 1:]
                    elif e.pos > 0 and review_text[e.pos - 1] == '\\':
                        review_text = review_text[:e.pos - 1] + '\\\\' + review_text[e.pos:]
                    else:
                        break
                else:
                    break
        if reviewed and isinstance(reviewed, list) and len(reviewed) == len(slides):
            slides = reviewed
            print(f"[Self-Review] Applied corrections to {len(slides)} slides")
        else:
            print("[Self-Review] Review parse failed or length mismatch — using original slides")
    except Exception as e:
        print(f"[Self-Review] Error: {e} — using original slides")

    extracted_image_urls = [f"/static/images/{f}" for f in image_files]

    WIKI_HEADERS = {"User-Agent": "CursorForCalculus/1.0 (educational tool; contact@example.com)"}
    WIKI_API = "https://commons.wikimedia.org/w/api.php"

    def fetch_svg_candidates(queries: list) -> list:
        """Try ranked queries, collect up to 6 unique (title, thumb_url) candidates."""
        seen = set()
        candidates = []
        for query in queries:
            try:
                search_res = req_lib.get(WIKI_API, headers=WIKI_HEADERS, params={
                    "action": "query", "list": "search",
                    "srsearch": f"{query} filetype:svg",
                    "srnamespace": 6, "format": "json", "srlimit": 5
                }, timeout=8)
                results = search_res.json().get("query", {}).get("search", [])
                titles = [r["title"] for r in results if r["title"].lower().endswith(".svg") and r["title"] not in seen]
                if not titles:
                    continue
                info_res = req_lib.get(WIKI_API, headers=WIKI_HEADERS, params={
                    "action": "query", "titles": "|".join(titles[:3]),
                    "prop": "imageinfo", "iiprop": "url",
                    "iiurlwidth": 400, "format": "json"
                }, timeout=8)
                for page in info_res.json().get("query", {}).get("pages", {}).values():
                    title = page.get("title", "")
                    imageinfo = page.get("imageinfo", [])
                    if imageinfo and title not in seen:
                        thumb = imageinfo[0].get("thumburl") or imageinfo[0].get("url")
                        if thumb:
                            seen.add(title)
                            candidates.append((title, thumb))
            except Exception as e:
                print(f"[Commons] query='{query}' error: {e}")
            if len(candidates) >= 6:
                break
        return candidates

    def select_best_image(candidates: list, slide_title: str, keywords: list) -> Optional[str]:
        """Use Gemini vision to pick the clearest math/calculus image. Always falls back to first candidate."""
        if not candidates:
            return None
        if len(candidates) == 1:
            print(f"[Gemini Select] Single candidate for '{slide_title}': using it directly")
            return candidates[0][1]
        try:
            parts = []
            valid = []
            for title, url in candidates:
                try:
                    r = req_lib.get(url, timeout=6)
                    if r.ok:
                        parts.append(Part.from_data(data=r.content, mime_type="image/png"))
                        valid.append((title, url))
                except Exception:
                    continue
            if not valid:
                return candidates[0][1]
            keyword_text = " ".join(keywords[:2]) if keywords else ""
            selection_prompt = (
                f'This slide is about "{slide_title}" from a calculus/mathematics course.\n'
                f'Key concepts: {keyword_text}\n\n'
                f'There are {len(valid)} images (labeled 0 to {len(valid)-1}).\n'
                f'Pick the clearest image for a student seeing this concept for the first time.\n'
                f'Criteria: simple, clean, directly illustrates the calculus concept, not cluttered.\n'
                f'Respond with ONLY a single integer (0 to {len(valid)-1}).'
            )
            parts.append(selection_prompt)
            response = model.generate_content(parts)
            answer = response.text.strip().lower()
            digits = ''.join(c for c in answer if c.isdigit())
            if digits:
                idx = int(digits[:2])
                if 0 <= idx < len(valid):
                    print(f"[Gemini Select] slide='{slide_title}' → index {idx}: '{valid[idx][0]}'")
                    return valid[idx][1]
        except Exception as e:
            print(f"[Gemini Select] Error: {e}")
        # Always fall back to first candidate rather than returning None
        print(f"[Gemini Select] Falling back to first candidate for '{slide_title}'")
        return candidates[0][1]

    def get_geogebra_image(query: str) -> Optional[str]:
        try:
            res = req_lib.get(
                "https://api.geogebra.org/v1.0/materials",
                params={"q": query, "type": "ws", "limit": 5},
                timeout=5,
            )
            for material in res.json().get("materials", []):
                thumb = material.get("thumb")
                if thumb:
                    print(f"[GeoGebra] '{query}' → {thumb}")
                    return thumb
        except Exception as e:
            print(f"[GeoGebra] Error: {e}")
        return None

    for i, slide in enumerate(slides):
        commons_queries = slide.pop("commons_queries", [])
        if isinstance(commons_queries, str):
            commons_queries = [commons_queries]
        geogebra_query = slide.pop("geogebra_query", "")
        slide.pop("commons_query", None)
        slide.pop("diagram_svg", None)
        slide.pop("imagen_prompt", None)

        if i < len(extracted_image_urls):
            slide["diagram_image_url"] = extracted_image_urls[i]
        else:
            candidates = fetch_svg_candidates(commons_queries) if commons_queries else []
            url = select_best_image(candidates, slide.get("title", ""), slide.get("keywords", []))
            if not url:
                url = get_geogebra_image(geogebra_query) if geogebra_query else None
            slide["diagram_image_url"] = url

    session_context["slideshow"] = slides

    # Update whiteboard tutor context from uploaded material
    if uploaded_file_summaries:
        session_context["file_summaries"] = uploaded_file_summaries
        session_context["last_analysis"] = None  # reset for new material

        practice_prompt = f"""You are creating one practice problem for a student to solve step-by-step on a whiteboard.

Based ONLY on the concepts in these course notes, write ONE challenging but solvable problem.

COURSE NOTES:
{extracted_text[:3000]}

Requirements:
- The problem must be directly grounded in a concept from the notes above.
- It should require showing clear step-by-step work.
- Write in plain spoken English. No LaTeX, no dollar signs, no backslashes.
  Use words: "the integral of", "x squared", "from 0 to 4", etc.
- Return ONLY the problem statement as a single plain-text sentence or two. No labels, no preamble."""

        try:
            practice_resp = model.generate_content(practice_prompt)
            practice_problem = practice_resp.text.strip()
            session_context["current_problem"] = practice_problem
            print(f"[Whiteboard] Practice problem: {practice_problem[:100]}...")
        except Exception as e:
            print(f"[Whiteboard] Could not generate practice problem: {e}")

    lesson = {"slides": slides, "images": extracted_image_urls}
    session_content["lesson"] = lesson
    return lesson
  except Exception as e:
    import traceback
    tb = traceback.format_exc()
    print(f"[generate-lesson ERROR]\n{tb}")
    raise HTTPException(status_code=500, detail=str(e))


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
        data = res.json()
        text = data.get("text", "")
        words = data.get("words", [])
        session_content["transcript"] = text
        return {"text": text, "words": words}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EngagementEvent(BaseModel):
    timestamp_seconds: int
    engaged: bool

@app.post("/engagement/event")
async def log_engagement_event(event: EngagementEvent):
    session_content["engagement_events"].append({
        "timestamp_seconds": event.timestamp_seconds,
        "engaged": event.engaged,
    })
    return {"status": "ok", "total": len(session_content["engagement_events"])}

@app.get("/engagement/events")
async def get_engagement_events():
    return session_content.get("engagement_events", [])

@app.post("/engagement/reset")
async def reset_engagement_events():
    session_content["engagement_events"] = []
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
