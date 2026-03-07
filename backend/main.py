from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import base64
import json
from dotenv import load_dotenv
import google.generativeai as genai

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

class WhiteboardAnalysisRequest(BaseModel):
    imageBase64: str  # Expecting full data URL or raw base64
    questionContext: str
    timestamp: int

@app.get("/")
async def root():
    return {"message": "Cursor for Calculus Backend is running"}

@app.post("/whiteboard/analyze")
async def analyze_whiteboard(request: WhiteboardAnalysisRequest):
    if not GEMINI_API_KEY:
        return {
            "hasMistake": False,
            "feedback": "Gemini API key not configured. Using dummy feedback.",
            "mistakeDescription": "No API key"
        }

    try:
        # Strip data URL prefix if present
        img_data = request.imageBase64
        if "," in img_data:
            img_data = img_data.split(",")[1]
        
        image_bytes = base64.b64decode(img_data)
        
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
        
        response = model.generate_content([
            prompt,
            {"mime_type": "image/png", "data": image_bytes}
        ])
        
        # Extract JSON from response
        try:
            text_response = response.text.strip()
            if "```json" in text_response:
                text_response = text_response.split("```json")[1].split("```")[0].strip()
            elif "```" in text_response:
                text_response = text_response.split("```")[1].split("```")[0].strip()
            
            result = json.loads(text_response)
            return result
        except Exception as e:
            return {
                "hasMistake": False,
                "feedback": "Analyzed successfully, but couldn't parse structured feedback.",
                "mistakeDescription": str(e)
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/problem/generate")
async def generate_problem(request: Request):
    if not GEMINI_API_KEY:
        return {
            "question": "Find the derivative of f(x) = 3x^2 + 5x + 2",
            "solution": "6x + 5",
            "context": "Basic power rule exercise"
        }

    try:
        body = await request.json()
        context = body.get("context", "Calculus")
        
        prompt = f"Generate a challenging but solvable {context} problem for a student. Return JSON: {{'question': '...', 'solution': '...', 'context': '...'}}"
        
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

    if not GEMINI_API_KEY:
        return {
            "concepts": {
                "topics": ["Derivatives", "Power Rule"],
                "formulas": ["d/dx[x^n] = nx^(n-1)"],
                "concepts": ["Rate of change", "Slope of tangent line"],
                "summary": "Dummy response — Gemini API key not configured."
            }
        }

    try:
        contents = await file.read()
        encoded = base64.b64encode(contents).decode("utf-8")

        extract_model = genai.GenerativeModel("gemini-2.5-pro-preview-03-25")
        response = extract_model.generate_content([
            {
                "inline_data": {
                    "mime_type": file.content_type,
                    "data": encoded
                }
            },
            """Extract all key concepts, formulas, definitions, and topics from this document.
            Return ONLY valid JSON with these keys:
            - topics: list of main topics covered
            - formulas: list of any equations or formulas
            - concepts: list of key definitions or ideas
            - summary: 2-3 sentence overview of the content"""
        ])

        text = response.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        return {"concepts": json.loads(text)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini extraction failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
