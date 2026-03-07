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
model = genai.GenerativeModel('gemini-flash-lite-latest') # Using the ID from the available models list

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
    "current_problem": "What are we working on today?",
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
            2. KEY PRINCIPLES/RULES: Any specific rules, definitions, or frameworks mentioned.
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
        
        if not isinstance(session_context.get("file_summaries"), list):
            session_context["file_summaries"] = []
            
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
        
        file_summaries = session_context.get("file_summaries", [])
        if not isinstance(file_summaries, list):
            file_summaries = []
            
        summaries = "\n".join([f"- {f['filename']}: {f['summary']}" for f in file_summaries if isinstance(f, dict)])
        
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
        
        try:
            response = model.generate_content([
                prompt,
                {"mime_type": "image/png", "data": image_bytes}
            ])
        except Exception as gen_err:
            print(f"Gemini Generation Error: {gen_err}")
            raise HTTPException(status_code=500, detail=f"Gemini Error: {str(gen_err)}")
        
        text_response = response.text.strip()
        try:
            # Simple JSON extraction in case model returns markdown
            clean_text = response.text
            if "```json" in clean_text:
                clean_text = clean_text.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_text:
                clean_text = clean_text.split("```")[1].split("```")[0].strip()
            
            analysis = json.loads(clean_text)
        except Exception as json_err:
            print(f"JSON Parsing Error: {json_err}. Raw text: {response.text}")
            analysis = {
                "hasMistake": False,
                "feedback": response.text[:200], # Fallback to raw text
                "mistakeDescription": "Could not parse structured feedback",
                "coordinates": None
            }
        
        session_context["last_analysis"] = analysis
        return analysis
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/problem/generate")
async def generate_problem(request: Request):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        body = await request.json()
        context = body.get("context", "General Subject")
        
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
