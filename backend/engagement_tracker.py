"""
MediaPipe Tasks API engagement tracker (compatible with mediapipe 0.10+).
Run alongside the backend: python3 engagement_tracker.py
"""

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import requests
import time
import math
import numpy as np
import os

BACKEND = "http://localhost:8000"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "face_landmarker.task")

# ---------------------------------------------------------------------------
# Two-layer engagement system:
#   Layer 1 (this file) — MediaPipe real-time head pose + eye closure tracking
#   Layer 2 (presage_layer.py) — Presage SmartSpectra physiological attention
#                                 analysis via Physiology API (post-session)
#                                 DISABLED: limited API credits — see presage_layer.py
# ---------------------------------------------------------------------------

DISENGAGEMENT_THRESHOLD = 6   # seconds before logging disengaged
CHECK_INTERVAL = 0.4

# Engagement thresholds
MAX_YAW             = 45    # sideways is restricted
LOOK_DOWN_PITCH     = -20   # soft: looking down starts here (OK briefly)
MIN_PITCH           = -55   # hard: extreme down always disengaged
MAX_PITCH           = 55    # looking up/above camera is fine
MAX_LOOK_DOWN_DURATION = 15 # seconds of sustained looking-down before disengaged

# Eye closure
EAR_THRESHOLD = 0.18        # eye aspect ratio below this = closed

# Build face landmarker
base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
options = mp_vision.FaceLandmarkerOptions(
    base_options=base_options,
    running_mode=mp_vision.RunningMode.IMAGE,
    num_faces=1,
    min_face_detection_confidence=0.2,
    min_face_presence_confidence=0.2,
    min_tracking_confidence=0.2,
)
landmarker = mp_vision.FaceLandmarker.create_from_options(options)

cap = cv2.VideoCapture(0, cv2.CAP_AVFOUNDATION)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

# Warm up — macOS needs a moment after permission grant
print("Warming up camera...")
for _ in range(30):
    cap.read()
    time.sleep(0.05)
print("Camera ready.")

recording_start = time.time()
disengaged_since = None
currently_engaged = True
looking_down_since = None   # tracks start of sustained looking-down period


def elapsed():
    return int(time.time() - recording_start)


def eye_aspect_ratio(landmarks, outer_idx, inner_idx, top_idx, bottom_idx, w, h):
    """EAR = vertical eye opening / horizontal eye width."""
    outer  = np.array([landmarks[outer_idx].x * w, landmarks[outer_idx].y * h])
    inner  = np.array([landmarks[inner_idx].x * w, landmarks[inner_idx].y * h])
    top    = np.array([landmarks[top_idx].x * w,   landmarks[top_idx].y * h])
    bottom = np.array([landmarks[bottom_idx].x * w, landmarks[bottom_idx].y * h])
    horizontal = np.linalg.norm(outer - inner)
    if horizontal < 1:
        return 1.0
    return np.linalg.norm(top - bottom) / horizontal


def get_head_pose(landmarks, w, h):
    """PnP-based head pose estimation. Returns (yaw_deg, pitch_deg) or (None, None)."""
    model_points = np.array([
        (0.0,    0.0,    0.0),
        (0.0,  -330.0,  -65.0),
        (-225.0, 170.0, -135.0),
        (225.0,  170.0, -135.0),
        (-150.0,-150.0, -125.0),
        (150.0, -150.0, -125.0),
    ], dtype=np.float64)

    lm_ids = [1, 152, 33, 263, 61, 291]
    image_points = np.array(
        [(landmarks[i].x * w, landmarks[i].y * h) for i in lm_ids],
        dtype=np.float64
    )

    focal = w
    cam = np.array([[focal, 0, w/2], [0, focal, h/2], [0, 0, 1]], dtype=np.float64)
    dist = np.zeros((4, 1))

    success, rvec, _ = cv2.solvePnP(model_points, image_points, cam, dist,
                                     flags=cv2.SOLVEPNP_ITERATIVE)
    if not success:
        return None, None

    rmat, _ = cv2.Rodrigues(rvec)
    sy = math.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
    pitch = math.degrees(math.atan2(-rmat[2, 0], sy))
    yaw   = math.degrees(math.atan2(rmat[1, 0], rmat[0, 0]))
    return yaw, pitch


def classify_engagement(result, w, h):
    """Returns (engaged, reason, yaw, pitch, is_looking_down)."""
    if not result.face_landmarks:
        return False, "no face detected", None, None, False

    landmarks = result.face_landmarks[0]
    yaw, pitch = get_head_pose(landmarks, w, h)

    if yaw is None:
        return False, "pose estimation failed", None, None, False

    # Eye closure check
    left_ear  = eye_aspect_ratio(landmarks, 33, 133, 159, 145, w, h)
    right_ear = eye_aspect_ratio(landmarks, 362, 263, 386, 374, w, h)
    avg_ear   = (left_ear + right_ear) / 2
    if avg_ear < EAR_THRESHOLD:
        return False, f"eyes closed (EAR={avg_ear:.2f})", yaw, pitch, False

    # Hard angle limits
    if abs(yaw) > MAX_YAW:
        return False, f"looking sideways (yaw={yaw:.0f}°)", yaw, pitch, False
    if pitch < MIN_PITCH:
        return False, f"head too far down (pitch={pitch:.0f}°)", yaw, pitch, True
    if pitch > MAX_PITCH:
        return False, f"head too far up (pitch={pitch:.0f}°)", yaw, pitch, False

    # Soft looking-down (duration handled in main loop)
    is_looking_down = pitch < LOOK_DOWN_PITCH
    return True, f"yaw={yaw:.0f}° pitch={pitch:.0f}°", yaw, pitch, is_looking_down


def post_event(engaged: bool):
    try:
        requests.post(f"{BACKEND}/engagement/event", json={
            "timestamp_seconds": elapsed(),
            "engaged": engaged,
        }, timeout=2)
        label = "ENGAGED ✓" if engaged else "DISENGAGED ✗"
        print(f"\n  → [{elapsed()}s] Logged: {label}")
    except Exception as e:
        print(f"\n  → Failed to post: {e}")


print("=" * 55)
print("  Engagement Tracker (MediaPipe 0.10 Tasks API)")
print(f"  Backend: {BACKEND}")
print(f"  Thresholds: yaw<{MAX_YAW}° | pitch {MIN_PITCH}°..{MAX_PITCH}°"
      f" | down>{MAX_LOOK_DOWN_DURATION}s | EAR<{EAR_THRESHOLD}")
print(f"  Disengagement logged after {DISENGAGEMENT_THRESHOLD}s sustained")
print("  Press Ctrl+C to stop")
print("=" * 55)

try:
    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(CHECK_INTERVAL)
            continue

        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(mp_image)

        engaged, reason, yaw, pitch, is_looking_down = classify_engagement(result, w, h)

        # Apply sustained looking-down rule
        if is_looking_down and engaged:
            if looking_down_since is None:
                looking_down_since = time.time()
            elif time.time() - looking_down_since > MAX_LOOK_DOWN_DURATION:
                engaged = False
                reason = f"looking down too long ({int(time.time()-looking_down_since)}s)"
        else:
            if not is_looking_down:
                looking_down_since = None  # reset when they look up

        print(f"[{elapsed():>4}s] {'✓' if engaged else '✗'} {reason}    ", end="\r")

        # Show live camera preview — press Q to hide
        label = f"{'ENGAGED' if engaged else 'DISENGAGED'} | {reason}"
        color = (0, 200, 0) if engaged else (0, 0, 220)
        cv2.putText(frame, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        cv2.imshow("Engagement Tracker (Q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

        if not engaged:
            if disengaged_since is None:
                disengaged_since = time.time()
                print(f"\n  [!] Disengagement started: {reason}")
            elif time.time() - disengaged_since >= DISENGAGEMENT_THRESHOLD:
                if currently_engaged:
                    post_event(engaged=False)
                    currently_engaged = False
                disengaged_since = None
        else:
            if not currently_engaged:
                post_event(engaged=True)
                currently_engaged = True
            disengaged_since = None

        time.sleep(CHECK_INTERVAL)

except KeyboardInterrupt:
    print("\nStopped.")
finally:
    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()
