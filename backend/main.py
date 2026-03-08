from fastapi import FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import os, base64, json, asyncio, uuid, requests as req_lib, re, time
import httpx
import websockets as ws_lib
from dotenv import load_dotenv
import vertexai
from vertexai.generative_models import GenerativeModel, Part
from vertexai.preview.vision_models import ImageGenerationModel
import fitz  # pymupdf

load_dotenv()

# Support Google credentials as a JSON string env var (for Railway/cloud deployments)
_creds_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
if _creds_json:
    import tempfile
    _tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    _tmp.write(_creds_json)
    _tmp.close()
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _tmp.name

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
    # ── DEMO DATA ── Replace with generated content after uploading a lesson ──
    "practice_problems": [
        "Find the derivative of $f(x) = 3x^{4} - 5x^{2} + 7x - 2$ using the power rule.",
        "Use the product rule to differentiate $g(x) = x^{3} \\cdot \\sin(x)$.",
        "Apply the chain rule to find $h'(x)$ where $h(x) = (2x^{2} + 1)^{5}$.",
    ],
    "current_problem_index": 0,
    "current_problem": "Find the derivative of $f(x) = 3x^{4} - 5x^{2} + 7x - 2$ using the power rule.",
    "file_summaries": [
        {
            "filename": "[DEMO] Calculus_Derivatives.pdf",
            "type": "application/pdf",
            "summary": (
                "CORE CONCEPTS: Derivatives, the power rule, product rule, and chain rule. "
                "KEY PRINCIPLES: Power rule: d/dx[x^n] = nx^(n-1). "
                "Product rule: d/dx[f·g] = f'g + fg'. "
                "Chain rule: d/dx[f(g(x))] = f'(g(x))·g'(x). "
                "SESSION GOAL: The student should be able to differentiate polynomial, product, and composite functions."
            ),
        }
    ],
    # ─────────────────────────────────────────────────────────────────────────
    "last_analysis": None,
    "student_model": {
        "mastered_concepts": [],
        "struggling_concepts": [],
        "mistake_patterns": {},
        "problems_solved": 0,
        # category_key -> {"title": str, "rating": int, "attempts": int, "correct": int, "minor_errors": int, "major_errors": int}
        "skill_ratings": {},
        # Prevent double-counting while whiteboard snapshots stream rapidly
        "last_scored_event": {"signature": None, "ts": 0},
        # Tracks whether a help request was made for the current problem (reset on problem change)
        "hint_used": False,
    },
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

LATEX_BLOCK_RE = re.compile(r"(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)")


def extract_json_text(raw: str) -> str:
    text = raw.strip()
    if "```json" in text:
        return text.split("```json", 1)[1].split("```", 1)[0].strip()
    if "```" in text:
        return text.split("```", 1)[1].split("```", 1)[0].strip()
    return text


def _wrap_integrand(expr: str) -> str:
    cleaned = expr.strip()
    cleaned = re.sub(r"^\s*(the\s+)?function\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*dx\s*$", "", cleaned, flags=re.IGNORECASE)
    if re.match(r"^\(.+\)$", cleaned):
        return cleaned
    return f"({cleaned})"


def _normalize_non_latex_segment(text: str) -> str:
    out = text
    # Normalize double-escaped latex commands from JSON strings (e.g. "\\frac" -> "\frac").
    out = re.sub(r"\\\\(?=[A-Za-z])", r"\\", out)

    out = re.sub(r"\[\s*integral symbol\s*\]", "∫", out, flags=re.IGNORECASE)
    out = re.sub(r"\bintegral symbol\b", "∫", out, flags=re.IGNORECASE)
    out = re.sub(r"\[\s*summation symbol\s*\]", "Σ", out, flags=re.IGNORECASE)

    # "∫ from 0 to 4 of ...", "definite integral of ... from 0 to 4", etc.
    out = re.sub(
        r"∫\s*from\s+(.+?)\s+to\s+(.+?)\s+of\s+(.+?)(?=[,.;!?]|$)",
        lambda m: f"$\\int_{{{m.group(1).strip()}}}^{{{m.group(2).strip()}}} {_wrap_integrand(m.group(3))}\\,dx$",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"(?:the\s+)?definite\s+integral\s+of\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+?)(?=[,.;!?]|$)",
        lambda m: f"$\\int_{{{m.group(2).strip()}}}^{{{m.group(3).strip()}}} {_wrap_integrand(m.group(1))}\\,dx$",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"(?:the\s+)?integral\s+of\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+?)(?=[,.;!?]|$)",
        lambda m: f"$\\int_{{{m.group(2).strip()}}}^{{{m.group(3).strip()}}} {_wrap_integrand(m.group(1))}\\,dx$",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"(?:the\s+)?integral\s+of\s+(.+?)(?=[,.;!?]|$)",
        lambda m: f"$\\int {_wrap_integrand(m.group(1))}\\,dx$",
        out,
        flags=re.IGNORECASE,
    )

    # "Σ from i=1 to n of i" -> "$\\sum_{i=1}^{n} i$"
    out = re.sub(
        r"Σ\s*from\s+(.+?)\s+to\s+(.+?)\s+of\s+(.+?)(?=[,.;!?]|$)",
        lambda m: f"$\\sum_{{{m.group(1).strip()}}}^{{{m.group(2).strip()}}} {m.group(3).strip()}$",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"(?:the\s+)?sum\s+from\s+(.+?)\s+to\s+(.+?)\s+of\s+(.+?)(?=[,.;!?]|$)",
        lambda m: f"$\\sum_{{{m.group(1).strip()}}}^{{{m.group(2).strip()}}} {m.group(3).strip()}$",
        out,
        flags=re.IGNORECASE,
    )

    # x^2, t^-1 -> $x^{2}$, $t^{-1}$  (must run BEFORE equation wrapping)
    out = re.sub(
        r"\b([A-Za-z])\s*\^\s*(-?\d+)\b",
        lambda m: f"${m.group(1)}^{{{m.group(2)}}}$",
        out,
    )

    # If model returns raw TeX equation without delimiters, wrap just the math part.
    # Use lazy quantifier + transition-word lookahead so "with respect to x" stays outside.
    # Include [.] so equations ending in a period (e.g. \frac{1}{x}. Rewrite…) still match.
    _TRANSITION = r"(?=\s+(?:with|and|or|where|when|as|for|using|in|from|show|let|is|are)\b|[,;.]|$)"
    out = re.sub(
        r"\b([A-Za-z][A-Za-z0-9_]*\s*\([^)]+\)|[A-Za-z][A-Za-z0-9_]*)\s*=\s*([^.;\n]+?)" + _TRANSITION,
        lambda m: (
            f"${m.group(1).strip()} = {m.group(2).replace('$', '').strip()}$"
            if ("\\" in m.group(2) or "^" in m.group(2) or "_" in m.group(2))
            else m.group(0)
        ),
        out,
    )
    return out


def normalize_problem_text(problem: str) -> str:
    if not isinstance(problem, str):
        return problem

    # Convert display math $$...$$ to inline $...$ — practice problem cards use inline.
    problem = re.sub(r"\$\$([^$\n]+?)\$\$", r"$\1$", problem)

    # If the model wraps whole instruction sentences in $...$, unwrap them first.
    problem = re.sub(
        r"\$([^$\n]{40,})\$",
        lambda m: (
            m.group(1)
            if re.search(
                r"\b(find|show|rewrite|simplify|use|remember|evaluate|differentiate|derivative|step)\b",
                m.group(1),
                flags=re.IGNORECASE,
            )
            else m.group(0)
        ),
        problem,
    )

    parts = LATEX_BLOCK_RE.split(problem)
    normalized_parts: list[str] = []
    for part in parts:
        if not part:
            continue
        if part.startswith("$"):
            normalized_parts.append(part)
        else:
            normalized_parts.append(_normalize_non_latex_segment(part))
    return "".join(normalized_parts)


def normalize_problem_list(problems: list[str]) -> list[str]:
    return [normalize_problem_text(p) for p in problems if isinstance(p, str)]


def _canonical_skill(concept: str) -> Optional[tuple[str, str]]:
    c = concept.strip().lower()
    mapping = [
        (["power rule"], ("power_rule", "Power Rule")),
        (["chain rule"], ("chain_rule", "Chain Rule")),
        (["product rule"], ("product_rule", "Product Rule")),
        (["quotient rule"], ("quotient_rule", "Quotient Rule")),
        (["implicit differentiation", "implicit derivative"], ("implicit_diff", "Implicit Differentiation")),
        (["derivative", "differentiation"], ("derivatives_general", "Derivatives")),
        (["definite integral"], ("definite_integrals", "Definite Integrals")),
        (["indefinite integral", "antiderivative"], ("indefinite_integrals", "Indefinite Integrals")),
        (["u-substitution", "substitution"], ("u_substitution", "U-Substitution")),
        (["riemann sum"], ("riemann_sums", "Riemann Sums")),
        (["limit"], ("limits", "Limits")),
        (["algebra", "simplification"], ("algebraic_manipulation", "Algebraic Manipulation")),
    ]
    for needles, result in mapping:
        if any(n in c for n in needles):
            return result
    return None


def _skill_from_problem(problem_text: str) -> Optional[tuple[str, str]]:
    p = (problem_text or "").lower()
    # One clear testable skill per problem: infer from prompt text first.
    ordered_rules = [
        (["product rule"], ("product_rule", "Product Rule")),
        (["quotient rule"], ("quotient_rule", "Quotient Rule")),
        (["chain rule"], ("chain_rule", "Chain Rule")),
        (["implicit differentiation", "implicit derivative"], ("implicit_diff", "Implicit Differentiation")),
        (["riemann sum"], ("riemann_sums", "Riemann Sums")),
        (["u-substitution", "substitution"], ("u_substitution", "U-Substitution")),
        (["definite integral"], ("definite_integrals", "Definite Integrals")),
        (["indefinite integral", "antiderivative"], ("indefinite_integrals", "Indefinite Integrals")),
        (["power rule"], ("power_rule", "Power Rule")),
        (["differentiate", "derivative"], ("derivatives_general", "Derivatives")),
        (["limit"], ("limits", "Limits")),
    ]
    for needles, skill in ordered_rules:
        if any(n in p for n in needles):
            return skill
    return None


def _ensure_skill_bucket(sm: dict, key: str, title: str) -> tuple[str, dict]:
    bucket = sm["skill_ratings"].setdefault(
        key,
        {"title": title, "rating": 50, "attempts": 0, "correct": 0, "minor_errors": 0, "major_errors": 0},
    )
    return key, bucket


def _clamp_rating(value: int) -> int:
    return max(0, min(100, value))


def _update_student_model(analysis: dict) -> None:
    """Update student model from a whiteboard analysis."""
    sm = session_context["student_model"]
    concept = (analysis.get("concept") or "").strip()
    if not concept or len(concept) > 60:
        return

    # Determine one relevant skill category for this problem.
    problem_skill = _skill_from_problem(session_context.get("current_problem", ""))
    concept_skill = _canonical_skill(concept)
    chosen_skill = problem_skill or concept_skill
    if not chosen_skill:
        # Ignore noisy/non-actionable concepts (e.g. "basic addition", handwriting artifacts, etc.)
        return
    skill_key_name, skill_title = chosen_skill

    # Keep only allowed skill buckets to avoid long-tail noisy categories.
    allowed_keys = {
        "power_rule", "chain_rule", "product_rule", "quotient_rule", "implicit_diff",
        "derivatives_general", "definite_integrals", "indefinite_integrals",
        "u_substitution", "riemann_sums", "limits", "algebraic_manipulation",
    }
    sm["skill_ratings"] = {k: v for k, v in sm.get("skill_ratings", {}).items() if k in allowed_keys}

    # New fields from VLM output (fallbacks preserve backward compatibility)
    work_state = str(analysis.get("workState") or "").strip().lower()
    if not work_state:
        work_state = "solved" if analysis.get("isSolved") else "in_progress"
    mistake_severity = str(analysis.get("mistakeSeverity") or "").strip().lower()
    if not mistake_severity:
        mistake_severity = "major" if analysis.get("hasMistake") else "none"
    raw_confidence = analysis.get("confidence", 0.7)
    try:
        confidence = float(raw_confidence)
    except Exception:
        confidence = 0.7

    # De-dupe repeated identical scoring events caused by frequent whiteboard snapshots.
    now_ts = int(time.time())
    signature = f"{skill_key_name}|{work_state}|{analysis.get('isSolved')}|{analysis.get('hasMistake')}|{mistake_severity}|{analysis.get('mistakeCategory','')}"
    last = sm.get("last_scored_event", {"signature": None, "ts": 0})
    if last.get("signature") == signature and now_ts - int(last.get("ts", 0)) < 12:
        return

    skill_key, skill_bucket = _ensure_skill_bucket(sm, skill_key_name, skill_title)
    scored = False
    tracked_label = skill_title

    if analysis.get("isSolved") or work_state == "solved":
        sm["problems_solved"] += 1
        skill_bucket["attempts"] += 1
        skill_bucket["correct"] += 1
        # If a hint was used, award reduced points and cap at 70 max
        if sm.get("hint_used"):
            gain = 3
            skill_bucket["rating"] = min(70, _clamp_rating(skill_bucket["rating"] + gain))
        else:
            skill_bucket["rating"] = _clamp_rating(skill_bucket["rating"] + 8)
        sm["hint_used"] = False  # reset for next problem
        # Only award mastered if rating is high enough after the solve
        if skill_bucket["rating"] >= 70:
            if tracked_label not in sm["mastered_concepts"]:
                sm["mastered_concepts"].append(tracked_label)
            if tracked_label in sm["struggling_concepts"]:
                sm["struggling_concepts"].remove(tracked_label)
        scored = True

    # Important: do NOT penalize while work is still in progress.
    should_penalize = analysis.get("hasMistake") and work_state in {"attempted_final", "solved"} and confidence >= 0.6
    if should_penalize:
        # Use Gemini's own mistake classification — dynamic, context-aware
        category = (analysis.get("mistakeCategory") or "other error").strip()
        if tracked_label not in sm["mastered_concepts"]:
            if tracked_label not in sm["struggling_concepts"]:
                sm["struggling_concepts"].append(tracked_label)
        sm["mistake_patterns"][category] = sm["mistake_patterns"].get(category, 0) + 1
        skill_bucket["attempts"] += 1
        if mistake_severity == "minor":
            skill_bucket["minor_errors"] += 1
            skill_bucket["rating"] = _clamp_rating(skill_bucket["rating"] - 2)
        else:
            skill_bucket["major_errors"] += 1
            skill_bucket["rating"] = _clamp_rating(skill_bucket["rating"] - 8)
        scored = True

    if scored:
        sm["last_scored_event"] = {"signature": signature, "ts": now_ts}



def validate_problem_format(question: str) -> tuple[bool, list[str]]:
    issues: list[str] = []
    if not isinstance(question, str) or not question.strip():
        return False, ["Question must be a non-empty string."]

    if "\n" in question:
        issues.append("Question must be a single line (no hard line breaks).")

    if question.count("$") % 2 != 0:
        issues.append("Unbalanced $ delimiters.")

    parts = LATEX_BLOCK_RE.split(question)
    latex_blocks = [p for p in parts if p.startswith("$")]
    non_latex = "".join(p for p in parts if not p.startswith("$"))

    # Raw TeX outside math delimiters is not allowed.
    if re.search(r"\\[A-Za-z]+", non_latex):
        issues.append("Raw LaTeX command appears outside $...$.")
    if re.search(r"[A-Za-z0-9)\]}]\s*\^\s*[-A-Za-z0-9({\\]", non_latex):
        issues.append("Caret exponent appears outside $...$.")
    if re.search(r"[{}]", non_latex):
        issues.append("Curly braces appear outside $...$.")

    verb_re = re.compile(
        r"\b(find|show|rewrite|simplify|use|remember|evaluate|differentiate|derivative|step|indicating|clearly)\b",
        flags=re.IGNORECASE,
    )
    for block in latex_blocks:
        inner = block[1:-1].strip() if block.startswith("$") and block.endswith("$") else block
        if re.search(r"\\\\[A-Za-z]", inner):
            issues.append("Double-escaped LaTeX command found inside math.")
        # Detect full sentence accidentally wrapped as math.
        if len(inner) > 40 and verb_re.search(inner):
            issues.append("Instruction text was wrapped in LaTeX.")
        # Soft style warning; not fatal to acceptance.
        if len(inner) > 70 and len(re.findall(r"[+\-=]", inner)) >= 2:
            issues.append("Style warning: inline equation may be too long for the card.")

    if not latex_blocks:
        issues.append("Question must include inline LaTeX for math expressions.")

    return len(issues) == 0, issues


def _fatal_issues_only(issues: list[str]) -> list[str]:
    return [i for i in issues if not i.startswith("Style warning:")]


def _build_generation_rules(user_context: str = "") -> str:
    extra = f"\nContext focus: {user_context}" if user_context else ""
    return f"""Formatting contract (must follow exactly):
- Write plain English for instructions, and use inline LaTeX ONLY for equations/expressions.
- Never wrap full instruction sentences in $...$.
- Never output raw TeX outside $...$ (no \\frac, \\sqrt, ^, _, {{, }} in plain text).
- In JSON output, LaTeX backslashes MUST be doubled: write $\\\\frac{{1}}{{x}}$ in the JSON so it renders as $\\frac{{1}}{{x}}$ after parsing. Never use single backslash inside a JSON string.
- Keep every inline equation short enough to fit the UI; split long expressions into multiple short inline math chunks separated by plain text operators.
- No hard line breaks in the question text.
- Avoid ambiguous visual formatting: do not place isolated exponents on separate lines.
- If you ask to simplify without negative exponents, ensure the final expression in the prompt is compatible with that instruction.
- Do not mutate signs/exponents accidentally while rewriting; preserve equivalence exactly.
- Edge cases to avoid:
  1) prose fully italicized because a full sentence was inside $...$
  2) raw /frac, \\frac, ^, or braces shown as literal text
  3) malformed powers like x then superscript on a separate visual line
  4) oversized single equation that forces horizontal scrolling{extra}
"""


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

        sm = session_context.get("student_model", {})
        mastered = ", ".join(sm.get("mastered_concepts", [])) or "none yet"
        struggling = ", ".join(sm.get("struggling_concepts", [])) or "none yet"
        patterns = ", ".join(
            f"{k} (×{v})" for k, v in sorted(sm.get("mistake_patterns", {}).items(), key=lambda x: -x[1])
        ) or "none yet"
        student_model_text = f"""
- STUDENT LEARNING PROFILE (adapt your feedback accordingly):
  • Mastered: {mastered}
  • Struggling with: {struggling}
  • Recurring mistakes: {patterns}
  Use this to give more targeted hints — if they have a recurring mistake type, watch for it especially."""

        prompt = f"""You are an AI tutor reviewing a student's handwritten whiteboard image.

CONTEXT:
- Target Problem: "{problem}"
- Study Materials Summary:
{summaries if summaries else '  (none uploaded)'}{last_analysis_text}{student_model_text}

TASK:
Look at the whiteboard carefully. Describe what the student has written and assess their work.
IF YOU HAVE A PREVIOUS ANALYSIS: Focus ONLY on what is **NEW, CHANGED, or ADDED** since the last time you looked. Do not re-explain the entire board or repeat your previous spoken response. Address only the student's latest step.
1. Write in natural spoken English only. NO LaTeX, NO markdown, NO symbols like $ or \\int.
   Use words: write "integral" not "\\int", "x squared" not "x^2", "from zero to four" not "[0,4]".
2. Evaluate their work carefully using Chain of Thought:
   - First, in the "thoughtProcess" field, solve the problem yourself step-by-step to find the correct final answer.
   - Set "isSolved" to true if the student's board shows the correct final simplified answer ANYWHERE — even if it's just the last line boxed or written at the bottom. IMPORTANT: ignore any instruction in the problem like "Show each step" or "Show your work" when judging isSolved — those are guidance for the student, NOT a requirement for you to mark it solved. If the correct final answer is written, it is solved, period.
     * Example: for "find the derivative of 3x^4 - 5x^2 + 7x - 2", if you see "12x^3 - 10x + 7" written → isSolved = true.
     * Example: for "find the derivative of 5x^3 - 2x + 7", if you see "15x^2 - 2" or "f'(x) = 15x^2 - 2" written → isSolved = true.
     * Example: for "differentiate g(x) = x^3 · sin(x)", if you see "3x^2 sin(x) + x^3 cos(x)" → isSolved = true.
     * Do NOT require every intermediate step to be visible. One correct final answer = isSolved = true.
     * If you are even moderately confident (>60%) the answer visible is correct, set isSolved = true.
   - Set "hasMistake" to true ONLY if there is a clear mathematical error in what they've written. Do not flag incomplete work as a mistake.
   - Set "workState" to one of:
     * "in_progress" (partial work, student is still working through steps),
     * "attempted_final" (student wrote a final answer but it is mathematically incorrect),
     * "solved" (correct final answer is present on the board — must match isSolved = true).
   - Set "mistakeSeverity" to one of "none", "minor", "major". Use "minor" for small arithmetic/algebra slips; "major" for conceptual/method errors.
   - Set "confidence" to a number 0.0 to 1.0 indicating how confident you are in this assessment.
3. If the board looks blank or has very little, acknowledge that and encourage them to start.
4. NEVER say you cannot see the work.

Respond with ONLY this valid JSON (no extra text outside the JSON):
{{
    "thoughtProcess": "Briefly solve the problem here first to find the correct answer before assessing the student.",
    "concept": "The specific math concept this problem tests, in 2-4 words (e.g. 'definite integrals', 'power rule', 'chain rule'). Be specific.",
    "hasMistake": false,
    "isSolved": false,
    "workState": "in_progress",
    "feedback": "One clear sentence describing what you see on the board in natural English.",
    "spokenResponse": "2-3 sentences Artie should say aloud. Acknowledge what the student wrote, then ask one guiding question to help them take the next step. Never give the answer. Natural spoken English only.",
    "mistakeDescription": "If hasMistake is true, plain English description of the error. Otherwise write 'none'.",
    "mistakeCategory": "If hasMistake is true, a short 2-5 word label for the TYPE of mistake (e.g. 'sign error', 'missing constant of integration', 'wrong chain rule application', 'arithmetic error', 'incorrect bounds'). Be specific to the actual mistake. Otherwise write 'none'.",
    "mistakeSeverity": "none",
    "confidence": 0.8,
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
        _update_student_model(analysis)
        return analysis
    except Exception as e:
        return {
            "hasMistake": False,
            "feedback": "Could not parse structured feedback.",
            "mistakeDescription": str(e)
        }


@app.get("/student-model")
async def get_student_model():
    return session_context.get("student_model", {})


@app.post("/student-model/help-request")
async def record_help_request():
    """Called when the student explicitly asks Artie for help on the current problem."""
    sm = session_context["student_model"]
    chosen = _skill_from_problem(session_context.get("current_problem", ""))
    if not chosen:
        return {"status": "no_skill_tracked"}
    skill_key, skill_title = chosen
    allowed_keys = {
        "power_rule", "chain_rule", "product_rule", "quotient_rule", "implicit_diff",
        "derivatives_general", "definite_integrals", "indefinite_integrals",
        "u_substitution", "riemann_sums", "limits", "algebraic_manipulation",
    }
    if skill_key not in allowed_keys:
        return {"status": "no_skill_tracked"}
    _, bucket = _ensure_skill_bucket(sm, skill_key, skill_title)
    # Asking for help is a weaker signal than a mistake — small rating nudge down
    bucket["rating"] = _clamp_rating(bucket["rating"] - 4)
    bucket["attempts"] = bucket.get("attempts", 0) + 1
    if skill_title not in sm["mastered_concepts"]:
        if skill_title not in sm["struggling_concepts"]:
            sm["struggling_concepts"].append(skill_title)
    pattern_key = f"needed help with {skill_title.lower()}"
    sm["mistake_patterns"][pattern_key] = sm["mistake_patterns"].get(pattern_key, 0) + 1
    sm["hint_used"] = True
    return {"status": "ok", "skill": skill_title, "new_rating": bucket["rating"]}


@app.post("/student-model/reset")
async def reset_student_model():
    session_context["student_model"] = {
        "mastered_concepts": [],
        "struggling_concepts": [],
        "mistake_patterns": {},
        "problems_solved": 0,
        "skill_ratings": {},
        "last_scored_event": {"signature": None, "ts": 0},
        "hint_used": False,
    }
    return {"status": "ok"}


@app.post("/problem/generate")
async def generate_problem(request: Request):
    try:
        body = await request.json()
        context = body.get("context", "General Subject")
        base_prompt = f"""Generate one challenging but solvable {context} problem for a student.

{_build_generation_rules(context)}

Return ONLY valid JSON with this exact schema:
{{"question": "...", "solution": "...", "context": "..."}}
"""
        result = None
        valid = False
        issues: list[str] = []
        for _ in range(4):
            prompt = base_prompt
            if issues:
                prompt += "\nPrevious output was rejected. Fix these issues exactly:\n- " + "\n- ".join(issues)
            response = model.generate_content(prompt)
            text = extract_json_text(response.text)
            result = json.loads(text)
            if "question" not in result:
                issues = ["Missing 'question' field."]
                continue
            result["question"] = normalize_problem_text(result["question"])
            if "solution" in result and isinstance(result["solution"], str):
                result["solution"] = normalize_problem_text(result["solution"])
            valid, issues = validate_problem_format(result["question"])
            fatal_issues = _fatal_issues_only(issues)
            if valid or not fatal_issues:
                break
            issues = fatal_issues
        if result is None:
            return {"error": "Problem generation failed."}
        # Best-effort fallback: return normalized question even if strict validation failed.
        if not valid and issues:
            print(f"[Problem Generate] Returning best-effort normalized output despite validation issues: {issues}")
        session_context["current_problem"] = result["question"]
        return result
    except Exception as e:
        return {"error": str(e)}

@app.post("/problem/next")
async def next_problem():
    problems = session_context.get("practice_problems", [])
    idx = session_context.get("current_problem_index", 0)
    if idx + 1 < len(problems):
        session_context["current_problem_index"] = idx + 1
        session_context["current_problem"] = problems[idx + 1]
    session_context["student_model"]["hint_used"] = False
    session_context["last_analysis"] = None
    return {"current_problem": session_context["current_problem"], "current_problem_index": session_context["current_problem_index"], "total": len(problems)}

@app.post("/problem/prev")
async def prev_problem():
    problems = session_context.get("practice_problems", [])
    idx = session_context.get("current_problem_index", 0)
    if idx - 1 >= 0:
        session_context["current_problem_index"] = idx - 1
        session_context["current_problem"] = problems[idx - 1]
    session_context["student_model"]["hint_used"] = False
    session_context["last_analysis"] = None
    return {"current_problem": session_context["current_problem"], "current_problem_index": session_context["current_problem_index"], "total": len(problems)}

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


@app.get("/slideshow/narrator-context")
async def get_narrator_context():
    return {"context": session_context.get("narrator_context", "")}


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
    custom_context: str = Form(""),
):
  try:
    # ── 1. PARALLEL FILE EXTRACTION ───────────────────────────────────────
    valid_files = [f for f in files if f.filename]

    async def extract_single_file(file: UploadFile):
        contents = await file.read()
        resp = await asyncio.to_thread(
            model.generate_content,
            [
                Part.from_data(data=contents, mime_type=file.content_type),
                "Extract all text from this document exactly as it appears. Return only raw text."
            ]
        )
        return contents, file, resp.text.strip()

    extraction_results = await asyncio.gather(*[extract_single_file(f) for f in valid_files]) if valid_files else []

    all_text_parts = []
    image_files = []
    uploaded_file_summaries = []

    for contents, file, extracted in extraction_results:
        all_text_parts.append(extracted)
        uploaded_file_summaries.append({
            "filename": file.filename,
            "type": file.content_type,
            "summary": extracted[:2000],
        })

        if file.content_type == "application/pdf":
            try:
                pdf_doc = fitz.open(stream=contents, filetype="pdf")
                for page_num in range(len(pdf_doc)):
                    for img in pdf_doc[page_num].get_images():
                        xref = img[0]
                        base_image = pdf_doc.extract_image(xref)
                        ext = base_image["ext"]
                        fname = f"{uuid.uuid4()}.{ext}"
                        with open(os.path.join(IMAGES_DIR, fname), "wb") as fh:
                            fh.write(base_image["image"])
                        image_files.append(fname)
            except Exception:
                pass
        elif file.content_type in ["image/png", "image/jpeg"]:
            ext = "png" if "png" in file.content_type else "jpg"
            fname = f"{uuid.uuid4()}.{ext}"
            with open(os.path.join(IMAGES_DIR, fname), "wb") as fh:
                fh.write(contents)
            image_files.append(fname)

    extracted_text = "\n\n".join(all_text_parts)
    session_content["extracted_text"] = extracted_text
    session_content["transcript"] = transcript
    session_content["images"] = image_files

    # ── 2. BUILD ENGAGEMENT + CUSTOM CONTEXT NOTES ────────────────────────
    engagement_events = session_content.get("engagement_events", [])
    disengaged = [e for e in engagement_events if not e["engaged"]]
    engagement_note = ""
    if disengaged:
        times = ", ".join([f"{e['timestamp_seconds']}s" for e in disengaged])
        engagement_note = f"""

STUDENT ENGAGEMENT ANALYSIS:
The student was detected as disengaged at the following points during the lecture recording: {times}.

This means the student likely missed or did not fully absorb the material being covered at those moments. You MUST:
1. Identify which concepts from the transcript were being discussed at or near those timestamps.
2. Dedicate at least one slide specifically to re-explaining or reinforcing each concept the student missed.
3. In those slides, use clearer language, a concrete example, and if applicable a visual or formula to make the concept stick.
4. In the script for those slides, explicitly re-introduce the concept as if the student is hearing it for the first time — do not assume prior understanding.
Treat missed content as the highest priority for thorough coverage."""

    custom_context_note = ""
    if custom_context and custom_context.strip():
        custom_context_note = f"\n\nINSTRUCTOR CONTEXT:\n{custom_context.strip()}\nApply the above context when deciding tone, focus, depth, and emphasis across all slides."

    combined = f"UPLOADED MATERIAL:\n{extracted_text}\n\nLECTURE TRANSCRIPT:\n{transcript}{engagement_note}{custom_context_note}"

    # ── 3. SLIDE GENERATION — single Gemini pass (self-review merged in) ──
    lesson_prompt = f"""You are an educational content designer. Based on the provided learning materials below, generate a focused slideshow lesson.

{combined}

Create 5-8 slides covering the most important concepts from the material. Be concise — students should be able to scan each slide in under 30 seconds.

Return ONLY a valid JSON array with no markdown, no backticks, and no extra text. Each slide must follow this exact schema:

[
  {{
    "title": "Short slide title (4 words max)",
    "subtitle": "One crisp line describing the concept",
    "keywords": [
      "Brief key point 1 — one short sentence only (under 15 words).",
      "Brief key point 2 — one short sentence only (under 15 words).",
      "Brief key point 3 — one short sentence only (under 15 words)."
    ],
    "theorem": {{
      "label": "Formula name",
      "formula": "LaTeX formula string only, e.g. \\\\frac{{d}}{{dx}}[x^n] = nx^{{n-1}}"
    }},
    "commons_queries": [
      "specific phrase — MUST contain 'calculus' or 'mathematics', e.g. 'riemann sum left endpoint calculus interval'",
      "broader phrase — MUST contain 'calculus' or 'mathematics', e.g. 'riemann sum rectangle approximation mathematics'",
      "fallback phrase — MUST contain 'calculus' or 'mathematics', e.g. 'definite integral calculus diagram'"
    ],
    "geogebra_query": "short math term for GeoGebra, e.g. 'riemann sum'",
    "script": "2-3 sentence spoken narration. Plain English only — no LaTeX, no dollar signs, no backslashes."
  }}
]

STRICT RULES — follow exactly or the app will break:
- "theorem": set to null if no formula applies to this slide.
- "theorem.formula": valid LaTeX only, rendered with KaTeX. ALWAYS use double backslashes (\\\\frac, \\\\int, \\\\sum, \\\\sqrt).
- "keywords": each item MUST be a single sentence under 15 words. No long explanations.
- "commons_queries": EVERY query string MUST include the word "calculus" or "mathematics". This is mandatory — generic queries return wrong images.
- "commons_queries": rank from most to least specific.
- "script": natural spoken English only. No symbols, no LaTeX, no dollar signs. Spell math in words.
- Slides must flow logically: introduction → core concept → application."""

    raw_slide_resp = await asyncio.to_thread(model.generate_content, lesson_prompt)
    slide_json = raw_slide_resp.text.strip()
    if "```json" in slide_json:
        slide_json = slide_json.split("```json")[1].split("```")[0].strip()
    elif "```" in slide_json:
        slide_json = slide_json.split("```")[1].split("```")[0].strip()

    # Fix unescaped LaTeX backslashes iteratively
    slides = None
    for _ in range(100):
        try:
            slides = json.loads(slide_json)
            break
        except json.JSONDecodeError as e:
            if 'escape' in str(e).lower():
                if e.pos < len(slide_json) and slide_json[e.pos] == '\\':
                    slide_json = slide_json[:e.pos] + '\\\\' + slide_json[e.pos + 1:]
                elif e.pos > 0 and slide_json[e.pos - 1] == '\\':
                    slide_json = slide_json[:e.pos - 1] + '\\\\' + slide_json[e.pos:]
                else:
                    raise
            else:
                raise
    if slides is None:
        raise HTTPException(status_code=500, detail="Slide generation failed: JSON parsing error")

    extracted_image_urls = [f"/static/images/{f}" for f in image_files]

    WIKI_HEADERS = {"User-Agent": "CursorForCalculus/1.0 (educational tool; contact@example.com)"}
    WIKI_API_URL = "https://commons.wikimedia.org/w/api.php"

    # ── 4. PARALLEL IMAGE FETCHING — all slides at once via async httpx ───
    async def fetch_svg_candidates_async(queries: list, client: httpx.AsyncClient) -> list:
        seen: set = set()
        candidates: list = []
        for query in queries:
            try:
                search_res = await client.get(WIKI_API_URL, headers=WIKI_HEADERS, params={
                    "action": "query", "list": "search",
                    "srsearch": f"{query} filetype:svg",
                    "srnamespace": 6, "format": "json", "srlimit": 5
                }, timeout=8)
                results = search_res.json().get("query", {}).get("search", [])
                titles = [r["title"] for r in results
                          if r["title"].lower().endswith(".svg") and r["title"] not in seen]
                if not titles:
                    continue
                info_res = await client.get(WIKI_API_URL, headers=WIKI_HEADERS, params={
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
            if len(candidates) >= 3:  # capped at 3 — enough for selection, much faster
                break
        return candidates

    async def select_best_image_async(
        candidates: list, slide_title: str, keywords: list, client: httpx.AsyncClient
    ) -> Optional[str]:
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0][1]
        try:
            async def download_candidate(title_url):
                title, url = title_url
                try:
                    r = await client.get(url, timeout=6)
                    if r.is_success:
                        return (title, url, r.content)
                except Exception:
                    pass
                return None

            dl_results = await asyncio.gather(*[download_candidate(c) for c in candidates])
            valid = [r for r in dl_results if r is not None]
            if not valid:
                return candidates[0][1]
            parts = [Part.from_data(data=content, mime_type="image/png") for _, _, content in valid]
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
            sel_resp = await asyncio.to_thread(model.generate_content, parts)
            answer = sel_resp.text.strip().lower()
            digits = ''.join(c for c in answer if c.isdigit())
            if digits:
                idx = int(digits[:2])
                if 0 <= idx < len(valid):
                    print(f"[Gemini Select] slide='{slide_title}' → index {idx}: '{valid[idx][0]}'")
                    return valid[idx][1]
        except Exception as e:
            print(f"[Gemini Select] Error: {e}")
        print(f"[Gemini Select] Falling back to first candidate for '{slide_title}'")
        return candidates[0][1]

    async def get_geogebra_image_async(query: str, client: httpx.AsyncClient) -> Optional[str]:
        try:
            res = await client.get(
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

    async def process_slide_image(i: int, slide: dict, client: httpx.AsyncClient) -> dict:
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
            candidates = await fetch_svg_candidates_async(commons_queries, client) if commons_queries else []
            url = await select_best_image_async(candidates, slide.get("title", ""), slide.get("keywords", []), client)
            if not url:
                url = await get_geogebra_image_async(geogebra_query, client) if geogebra_query else None
            slide["diagram_image_url"] = url
        return slide

    async with httpx.AsyncClient() as http_client:
        slides = list(await asyncio.gather(*[
            process_slide_image(i, slide, http_client)
            for i, slide in enumerate(slides)
        ]))

    session_context["slideshow"] = slides

    # ── 5. NARRATOR CONTEXT + PRACTICE PROBLEMS IN PARALLEL ──────────────
    slides_text = "\n\n".join([
        f"SLIDE {i+1} — {s.get('title', '')}\nSubtitle: {s.get('subtitle', '')}\nScript: {s.get('script', '')}"
        for i, s in enumerate(slides)
    ])
    uploaded_summaries_text = "\n".join([
        f"- {f.get('filename', 'uploaded file')}: {str(f.get('summary', ''))[:800]}"
        for f in uploaded_file_summaries if isinstance(f, dict)
    ]) or "(none)"
    extracted_for_narrator = (extracted_text or "").strip()[:6000] or "(none)"
    transcript_for_narrator = (transcript or "").strip()[:3000] or "(none)"

    narrator_prompt = f"""You are configuring an AI voice narrator for a live educational slideshow app. The narrator is a voice agent that receives real-time updates as the student moves through slides.

Write a narrator briefing (the first message it receives when a session starts) that:
1. Defines its role: it is ONLY a narrator. It does NOT greet, introduce itself, or say its name. Ever.
2. Instructs it to begin reading the Slide 1 script immediately upon receiving this briefing.
3. Lists ALL slide scripts verbatim so it knows the full material.
4. States: after each script, go completely silent and wait.
5. States: when told "narrate slide N", immediately read that slide's script with no preamble.
6. States: if the student asks a question, answer using ONLY these sources: slide scripts + uploaded material notes below.
7. States: if the student says they still do not understand, re-explain the same concept in a DIFFERENT way (plain-language restatement, then simple example or analogy, then step-by-step breakdown), each time concise.
8. States: if the answer is not in the provided sources, say that clearly and suggest what part of the lesson is most related.
9. States: every interruption answer should be short (1-4 sentences), directly useful, then go silent.
10. States: after finishing a slide and if the student has been silent for a bit, ask exactly: "Are you ready to move on?"
11. States: when the student confirms, wait for the app command "narrate slide N" and then narrate that slide immediately.

Here are all {len(slides)} slides:

{slides_text}

Uploaded material summaries:
{uploaded_summaries_text}

Uploaded raw material excerpt:
{extracted_for_narrator}

Lecture transcript excerpt:
{transcript_for_narrator}

Write the complete narrator briefing now. It will be injected directly into the live voice agent."""

    source_notes = extracted_text[:3000].strip() or slides_text[:3000]

    practice_prompt = f"""You are creating 3 practice problems for a student to solve step-by-step on a whiteboard.

Based ONLY on the concepts in these course notes, write 3 challenging but solvable problems that gradually increase in difficulty.

COURSE NOTES:
{source_notes}

Requirements:
- The problems must be directly grounded in concepts from the notes above.
- They should require showing clear step-by-step work.
- Use standard calculus notation in LaTeX where needed. In JSON output, backslashes must be doubled.
  Examples (as they should appear in the JSON string): $\\\\frac{{1}}{{x}}$, $x^2$, $\\\\int_a^b f(x)\\\\,dx$, $\\\\sqrt{{x}}$, $\\\\sin(x)$, $x^{{-3}}$.
- Never write prose-math like "integral from ... to ..." or "Sigma from ... to ...".
{_build_generation_rules("whiteboard problem card readability")}
- Return ONLY a valid JSON array of exactly 3 strings. No markdown, no labels, no preamble."""

    async def gen_narrator_ctx():
        try:
            resp = await asyncio.to_thread(model.generate_content, narrator_prompt)
            return resp.text.strip()
        except Exception as e:
            print(f"[Narrator Context] Error: {e}")
            return (
                "You are a slideshow narrator. Do not greet. Begin reading Slide 1 immediately. "
                + " | ".join([f"Slide {i+1}: {s.get('script', '')}" for i, s in enumerate(slides)])
                + " After each script, wait silently. If interrupted, answer from the slide scripts only. "
                + "If still confused, re-explain differently with a simple example. "
                + "After silence, ask exactly 'Are you ready to move on?'."
            )

    async def gen_practice_problems():
        try:
            issues: list[str] = []
            best_effort: list[str] | None = None
            for attempt in range(4):
                prompt = practice_prompt
                if issues:
                    prompt += "\nPrevious output was rejected. Fix these issues exactly:\n- " + "\n- ".join(issues)
                try:
                    resp = await asyncio.to_thread(model.generate_content, prompt)
                    print(f"Raw response (attempt {attempt + 1}):", resp.text)
                    raw = extract_json_text(resp.text)
                    # JSON treats \f as form-feed, \n as newline, etc., silently corrupting
                    # LaTeX commands like \frac → rac. Pre-escape all single backslashes
                    # before letters so they survive json.loads intact.
                    raw = re.sub(r'(?<!\\)\\([a-zA-Z])', r'\\\\\1', raw)
                    parsed = json.loads(raw)
                except Exception as parse_err:
                    print(f"[Whiteboard] Parse error on attempt {attempt + 1}: {parse_err}")
                    issues = ["Return a JSON array with exactly 3 problem strings. No extra text outside the JSON array."]
                    continue
                if not isinstance(parsed, list) or len(parsed) < 3:
                    issues = ["Return a JSON array with exactly 3 problem strings."]
                    continue
                normalized = normalize_problem_list(parsed)[:3]
                best_effort = normalized
                all_issues: list[str] = []
                for idx, q in enumerate(normalized):
                    valid, q_issues = validate_problem_format(q)
                    if not valid:
                        for issue in q_issues:
                            all_issues.append(f"Problem {idx + 1}: {issue}")
                fatal_issues = [i for i in all_issues if "Style warning:" not in i]
                if not fatal_issues:
                    return normalized
                issues = fatal_issues
            if best_effort:
                print(f"[Whiteboard] Using best-effort practice problems after validation issues: {issues}")
                return best_effort
            return None
        except Exception as e:
            print(f"[Whiteboard] Could not generate practice problems: {e}")
            return None

    narrator_text, practice_problems = await asyncio.gather(
        gen_narrator_ctx(),
        gen_practice_problems(),
    )

    session_context["narrator_context"] = narrator_text

    session_context["file_summaries"] = uploaded_file_summaries
    session_context["last_analysis"] = None
    if practice_problems and isinstance(practice_problems, list):
        session_context["practice_problems"] = practice_problems
        session_context["current_problem_index"] = 0
        if practice_problems:
            session_context["current_problem"] = practice_problems[0]
        print(f"[Whiteboard] Generated {len(practice_problems)} practice problems.")
    else:
        # Avoid showing stale/demo problems if generation didn't return usable items.
        session_context["practice_problems"] = []
        session_context["current_problem_index"] = 0
        session_context["current_problem"] = "Practice problems are not ready yet. Regenerate the lesson."

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
