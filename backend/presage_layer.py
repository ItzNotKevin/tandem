"""
Presage SmartSpectra — Second-Layer Engagement Analysis
--------------------------------------------------------
Uses the Presage Technologies Physiology API to extract physiological
attention and engagement scores from a recorded video clip.

STATUS: DISABLED — limited API credits (100 total).
        Set ENABLED = True and provide a video file path to activate.

Install dependencies:
    pip install Presage-Technologies Presage-Physiology-Preprocessing

API key: set the environment variable PRESAGE_API_KEY or hardcode below.

Architecture:
    Layer 1 (real-time)  — MediaPipe head pose + eye closure (engagement_tracker.py)
    Layer 2 (post-session) — Presage Physiology API physiological attention score (this file)

The Presage layer sends a short video clip to the cloud API after a recording
session ends and returns:
  - attention_score  : 0.0–1.0 (how focused the student was)
  - heart_rate       : beats per minute (stress/arousal proxy)
  - breathing_rate   : breaths per minute

These supplement the MediaPipe engagement events in the lesson generation prompt.
"""

import os
import time
from typing import Optional

# ---------------------------------------------------------------------------
# MASTER SWITCH — flip to True only when a video file is available and you
# want to spend API credits.
# ---------------------------------------------------------------------------
ENABLED = False

PRESAGE_API_KEY = os.environ.get("PRESAGE_API_KEY", "YOUR_API_KEY_HERE")
POLL_INTERVAL   = 3    # seconds between result polling attempts
MAX_WAIT        = 120  # seconds before giving up


def analyze_video_attention(video_path: str) -> Optional[dict]:
    """
    Send a video file to the Presage Physiology API and return attention metrics.

    Args:
        video_path: Absolute path to an MP4/MOV/AVI file (face must be visible,
                    at least ~100px across, well-lit).

    Returns:
        dict with keys: attention_score, heart_rate, breathing_rate
        or None if ENABLED is False or the request fails.
    """
    if not ENABLED:
        print("[Presage] Layer disabled — skipping (limited API credits).")
        return None

    if not os.path.exists(video_path):
        print(f"[Presage] Video file not found: {video_path}")
        return None

    try:
        # Presage-Technologies Python client
        # https://pypi.org/project/Presage-Technologies/
        from presage_technologies import PhysiologyClient  # type: ignore

        # Presage-Physiology-Preprocessing — normalises the video before upload
        # https://pypi.org/project/Presage-Physiology-Preprocessing/
        from presage_physiology_preprocessing import preprocess_video  # type: ignore

        print("[Presage] Preprocessing video...")
        processed_path = preprocess_video(video_path)

        client = PhysiologyClient(api_key=PRESAGE_API_KEY)

        print("[Presage] Uploading video to Physiology API...")
        job_id = client.queue_processing_hr_rr(processed_path)
        print(f"[Presage] Job queued: {job_id} — polling for results...")

        # Poll until results are ready
        elapsed = 0
        while elapsed < MAX_WAIT:
            result = client.retrieve_result(job_id)
            if result and result.get("status") == "complete":
                break
            time.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL
        else:
            print("[Presage] Timed out waiting for results.")
            return None

        # Extract the metrics we care about for engagement
        # Presage returns per-second time-series; we summarise to scalar scores.
        hr  = result.get("heart_rate", {}).get("mean")
        rr  = result.get("breathing_rate", {}).get("mean")
        att = result.get("attention", {}).get("mean")  # 0.0–1.0

        metrics = {
            "attention_score": round(att, 3) if att is not None else None,
            "heart_rate":      round(hr,  1) if hr  is not None else None,
            "breathing_rate":  round(rr,  1) if rr  is not None else None,
        }

        print(f"[Presage] Results: {metrics}")
        return metrics

    except ImportError:
        print(
            "[Presage] Packages not installed. Run:\n"
            "  pip install Presage-Technologies Presage-Physiology-Preprocessing"
        )
        return None
    except Exception as e:
        print(f"[Presage] API error: {e}")
        return None


def build_presage_prompt_note(metrics: Optional[dict]) -> str:
    """
    Convert Presage metrics into a natural-language note for the lesson
    generation prompt (appended alongside the MediaPipe engagement note).
    """
    if not metrics:
        return ""

    parts = []
    att = metrics.get("attention_score")
    hr  = metrics.get("heart_rate")
    rr  = metrics.get("breathing_rate")

    if att is not None:
        level = "high" if att >= 0.7 else ("moderate" if att >= 0.4 else "low")
        parts.append(f"physiological attention score {att:.2f} ({level})")
    if hr is not None:
        parts.append(f"avg heart rate {hr} bpm")
    if rr is not None:
        parts.append(f"avg breathing rate {rr} brpm")

    if not parts:
        return ""

    return (
        "\n\nPRESAGE BIOMETRIC NOTE: Post-session physiological analysis reported "
        + ", ".join(parts)
        + ". Use this to calibrate the difficulty and pacing of the generated slides."
    )
