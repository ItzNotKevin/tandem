from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import base64
import json
import io
from typing import List, Optional
from dotenv import load_dotenv
import google.generativeai as genai
from PIL import Image
import PyPDF2

load_dotenv()

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.0-flash')  # Using flash for low latency

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store (Hackathon-style simplicity)
session_context = {
    "current_problem": "Find the derivative of 3x² + 5x + 2",
    "file_summaries": [],
    "last_analysis": None
}

class WhiteboardAnalysisRequest(BaseModel):
    imageBase64: str
    questionContext: Optional[str] = None
    timestamp: int

@app.get("/")
async def root():
    return {"message": "Artie AI Backend is running"}

@app.get("/session/context")
async def get_session_context():
    return session_context

@app.post("/session/upload")
async def upload_material(file: UploadFile = File(...)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API Key not configured")
    
    content_type = file.content_type
    filename = file.filename
    
    try:
        content = await file.read()
        summary = ""

        if content_type == "application/pdf":
            # Extract text from PDF
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(content))
            text = ""
            # Examine up to 50 pages for better coverage
            for page in pdf_reader.pages[:50]:
                text += page.extract_text() + "\n"
            
            # Refined prompt for deeper context
            analysis_prompt = """
            Extract the following from this academic material to help an AI Tutor guide a student:
            1. CORE CONCEPTS: The main topics covered.
            2. KEY FORMULAS/THEOREMS: Any specific math/science rules mentioned.
            3. POTENTIAL PRACTICE PROBLEMS: Specific examples or questions found in the text that the tutor can use.
            4. SESSION GOAL: What should the student master after reading this?
            
            Material:
            """
            response = model.generate_content(f"{analysis_prompt}\n{text[:10000]}") # Increase context window
            summary = response.text
            
        elif content_type in ["image/png", "image/jpeg", "image/webp"]:
            # Process image with Gemini
            image = Image.open(io.BytesIO(content))
            analysis_prompt = """
            Examine this study material and extract:
            1. CORE CONCEPTS & FORMULAS visible.
            2. POTENTIAL PRACTICE PROBLEMS: List any specific questions or examples shown.
            3. CONTEXT: What is the student likely trying to learn here?
            """
            response = model.generate_content([analysis_prompt, image])
            summary = response.text
        
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type")

        file_info = {
            "filename": filename,
            "type": content_type,
            "summary": summary
        }
        
        session_context["file_summaries"].append(file_info)
        return file_info

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/whiteboard/analyze")
async def analyze_whiteboard(request: WhiteboardAnalysisRequest):
    if not GEMINI_API_KEY:
        return {
            "hasMistake": False,
            "feedback": "Gemini API key not configured.",
            "mistakeDescription": "No API key"
        }

    try:
        img_data = request.imageBase64
        if "," in img_data:
            img_data = img_data.split(",")[1]
        
        image_bytes = base64.b64decode(img_data)
        
        # Build context from session
        problem = request.questionContext or session_context["current_problem"]
        summaries = "\n".join([f"- {f['filename']}: {f['summary']}" for f in session_context["file_summaries"]])
        
        prompt = f"""
        Analysis Context:
        Target Question: "{problem}"
        
        Imported Materials Summary:
        {summaries}
        
        Task:
        Analyze the student's whiteboard work. 
        Are they solving the Target Question correctly? 
        Use the 'Imported Materials' if they explain the concept involved.
        
        Return JSON:
        {{
            "hasMistake": boolean,
            "feedback": "Concise, supportive feedback for the student.",
            "mistakeDescription": "Technical detail for our logs.",
            "coordinates": {{ "x": number, "y": number }} // Optional: where the mistake is
        }}
        """
        
        response = model.generate_content([
            prompt,
            {"mime_type": "image/png", "data": image_bytes}
        ])
        
        text_response = response.text.strip()
        if "```json" in text_response:
            text_response = text_response.split("```json")[1].split("```")[0].strip()
        elif "```" in text_response:
            text_response = text_response.split("```")[1].split("```")[0].strip()
        
        result = json.loads(text_response)
        session_context["last_analysis"] = result
        return result
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/problem/generate")
async def generate_problem(request: Request):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        body = await request.json()
        context = body.get("context", "Calculus")
        
        prompt = f"Generate a challenging {context} problem. Return ONLY JSON: {{'question': '...', 'solution': '...', 'context': '...'}}"
        
        response = model.generate_content(prompt)
        text_response = response.text.strip()
        if "```json" in text_response:
            text_response = text_response.split("```json")[1].split("```")[0].strip()
        
        result = json.loads(text_response)
        session_context["current_problem"] = result["question"]
        return result
    except Exception as e:
        return {"error": str(e)}

class SlideshowGenerateRequest(BaseModel):
    prompt: str
    num_slides: int = 8

@app.post("/slideshow/generate")
async def generate_slideshow(request: SlideshowGenerateRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API Key not configured")

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
