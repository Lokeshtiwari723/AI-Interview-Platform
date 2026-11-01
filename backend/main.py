from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from fastapi.middleware.cors import CORSMiddleware
import edge_tts
import uuid
import os
import requests
import json
import io
import re
import wave
import tempfile
import threading
import traceback

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICE = "en-IN-NeerjaNeural"

# ------------------------------------------------------------
# SPEECH-TO-TEXT (Whisper) SETTINGS - used by Video Interview
#
# "distil-large-v3" = most accurate choice for English (about 1.5 GB, downloaded
#                     once, a few seconds per answer on a MacBook Air)
# "small.en"        = faster but makes more mistakes (about 500 MB)
# If your Mac feels slow, change the line below to "small.en".
# ------------------------------------------------------------
WHISPER_MODEL_SIZE = "distil-large-v3"

# A SHORT hint only. A long prompt makes Whisper repeat its words by mistake.
BASE_PROMPT = (
    "Software engineering interview answer. "
    "Vocabulary: React, Node.js, MongoDB, SQL, REST API, JavaScript, Python, Java, C++"
)

QUESTION_STOP_WORDS = {
    "what", "which", "when", "where", "why", "how", "does", "did", "the", "and",
    "are", "was", "were", "can", "could", "would", "should", "will", "you",
    "your", "explain", "describe", "define", "difference", "between", "use",
    "used", "using", "work", "works", "working", "with", "for", "from", "about",
    "that", "this", "there", "their", "them", "tell", "give", "example",
    "examples", "mean", "means", "have", "has", "had", "any", "some", "into",
    "than", "then", "also", "each", "every", "over", "most", "more", "much",
}


def _question_terms(question):
    """Picks the technical words of the question (as a word list, not a sentence)."""

    terms = []

    for word in re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]{2,}", question or ""):
        word = word.rstrip(".-")
        lowered = word.lower()

        if len(word) < 3:
            continue

        if lowered in QUESTION_STOP_WORDS or lowered in (t.lower() for t in terms):
            continue

        terms.append(word)

    return terms[:8]


_whisper_model = None
_whisper_lock = threading.Lock()


def get_whisper():
    global _whisper_model

    with _whisper_lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel

            _whisper_model = WhisperModel(
                WHISPER_MODEL_SIZE,
                device="cpu",
                compute_type="int8"
            )

    return _whisper_model


@app.get("/")
def home():
    return {"message": "Interview AI backend is running"}
# Login, signup and history now live in Supabase (see frontend/src/supabaseClient.js).


@app.get("/speak")
async def speak(text: str):
    filename = f"{uuid.uuid4()}.mp3"
    filepath = os.path.join("audio", filename)

    os.makedirs("audio", exist_ok=True)

    try:
        communicate = edge_tts.Communicate(text, VOICE)
        await communicate.save(filepath)
    except Exception as error:
        # Microsoft's voice service refused the request (for example error 403).
        # The website then uses the browser voice instead.
        print(f"Voice service error ({type(error).__name__}): {str(error)[:150]}")
        print("Tip: run  pip install -U edge-tts  and restart the backend.")

        if os.path.exists(filepath):
            os.remove(filepath)

        return JSONResponse(
            {"success": False, "message": "Voice service is not available."},
            status_code=503
        )

    # the sound file is deleted after it has been sent, so the audio folder stays empty
    return FileResponse(
        filepath,
        media_type="audio/mpeg",
        background=BackgroundTask(os.remove, filepath)
    )


# ------------------------------------------------------------
# VIDEO INTERVIEW: SPEECH-TO-TEXT
# ------------------------------------------------------------

@app.get("/warmup")
async def warmup():
    """Loads the Whisper model so the first answer is not slow."""

    try:
        await run_in_threadpool(get_whisper)
        return {"success": True}
    except ImportError:
        return {
            "success": False,
            "message": "faster-whisper is not installed. Run: pip install faster-whisper"
        }
    except Exception as error:
        print("Warmup error:", error)
        return {
            "success": False,
            "message": "Could not load the speech model."
        }


def _wav_to_array(data):
    """Turns a 16-bit WAV (sent by the browser) into the audio array Whisper needs."""

    import numpy as np

    with wave.open(io.BytesIO(data), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    if width != 2:
        raise ValueError("Only 16-bit WAV audio is supported.")

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    # Whisper wants 16000 Hz (the browser already sends 16000 Hz)
    if rate != 16000 and len(audio) > 1:
        target = int(len(audio) * 16000 / rate)
        audio = np.interp(
            np.linspace(0, len(audio) - 1, target),
            np.arange(len(audio)),
            audio
        ).astype(np.float32)

    return audio


def _transcribe_audio(audio, question):
    """audio = a numpy array (16 kHz) or the path of an audio file."""

    model = get_whisper()

    prompt = BASE_PROMPT
    terms = _question_terms(question)

    if terms:
        prompt = f"{BASE_PROMPT}, {', '.join(terms)}."

    with _whisper_lock:
        # (no fixed temperature: Whisper then retries by itself when a
        #  first try looks like garbage or repeats itself)
        segments, _ = model.transcribe(
            audio,
            language="en",
            beam_size=5,
            vad_filter=True,
            vad_parameters={
                "threshold": 0.4,
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 400
            },
            initial_prompt=prompt[:400],
            condition_on_previous_text=False
        )

        parts = []

        for segment in segments:
            # skip segments that are probably silence / noise
            if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1.0:
                continue

            text = segment.text.strip()

            if text:
                parts.append(text)

    return " ".join(parts).strip()


def _transcribe_wav_bytes(audio_bytes, question):
    return _transcribe_audio(_wav_to_array(audio_bytes), question)


@app.post("/transcribe")
async def transcribe(request: Request, question: str = ""):
    """Receives a short audio clip (raw bytes) and returns the spoken text."""

    audio_bytes = await request.body()

    if len(audio_bytes) < 2000:
        return {"success": True, "text": ""}

    content_type = request.headers.get("content-type", "").lower()

    tmp_path = None

    try:
        if "wav" in content_type:
            # normal case: the browser sends a WAV
            text = await run_in_threadpool(
                _transcribe_wav_bytes,
                audio_bytes,
                question
            )
        else:
            # any other audio format: save it and let Whisper decode the file
            if "mp4" in content_type or "aac" in content_type:
                suffix = ".m4a"
            elif "ogg" in content_type:
                suffix = ".ogg"
            else:
                suffix = ".webm"

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            text = await run_in_threadpool(
                _transcribe_audio,
                tmp_path,
                question
            )

        return {"success": True, "text": text}

    except ImportError:
        traceback.print_exc()
        return {
            "success": False,
            "message": "A speech package is missing. Run: pip install faster-whisper"
        }

    except Exception as error:
        traceback.print_exc()
        return {
            "success": False,
            "message": f"Could not transcribe the audio ({type(error).__name__})."
        }

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/evaluate")
async def evaluate(data: dict):

    answers = data.get("answers", [])
    role = data.get("role", "Technical Developer")
    level = data.get("level", "Intermediate")

    results = []
    total_score = 0

    for item in answers:

        question = item.get("question", "")
        answer = item.get("answer", "").strip()

        if not answer:
            results.append({
                "question": question,
                "answer": "",
                "score": 0,
                "status": "Incorrect",
                "feedback": "No answer was provided.",
                "missing_points": ["An answer is required."]
            })
            continue

        prompt = f"""
You are an expert technical interview evaluator.

ROLE:
{role}

LEVEL:
{level}

QUESTION:
{question}

CANDIDATE ANSWER:
{answer}

Evaluate ONLY the candidate's answer to this question.

First determine the important concepts that a good {level} candidate should mention.

Then compare the candidate answer against those concepts.

IMPORTANT:
- Do NOT penalize the candidate simply because the answer is short.
- Do NOT require every possible detail.
- If the core technical concept is correct, give appropriate credit.
- Minor wording differences are acceptable.
- Do not invent missing concepts.
- Only list a missing point if it is genuinely important to answering the question.
- Do not use labels like "Missing concept 1", "Missing concept 2".
- Give higher scores when the answer is technically correct.
- Give partial scores when the core idea is correct but important details are missing.
- Give low scores only when the answer is substantially incorrect or irrelevant.

Scoring:

9-10 = Excellent and technically complete
7-8 = Correct with minor omissions
5-6 = Partially correct with important omissions
3-4 = Major misunderstanding
0-2 = Incorrect or irrelevant

Return ONLY valid JSON in exactly this structure:

{{
  "score": 0,
  "status": "Correct",
  "feedback": "Clear explanation of why the answer received this score.",
  "missing_points": []
}}

Allowed status values:

"Correct"
"Partially Correct"
"Incorrect"

Rules for missing_points:

- Use [] when nothing important is missing.
- Mention only real missing technical concepts.
- Maximum 3 items.
- Never write generic labels such as "Missing concept 1".
"""

        try:

            response = requests.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": "llama3.2:3b",
                    "prompt": prompt,
                    "stream": False,
                    "format": "json"
                },
                timeout=120
            )

            response.raise_for_status()

            ai_data = response.json()

            evaluation = json.loads(
                ai_data["response"]
            )

            score = float(
                evaluation.get("score", 0)
            )

            score = max(0, min(10, score))

            status = evaluation.get(
                "status",
                "Partially Correct"
            )

            feedback = evaluation.get(
                "feedback",
                ""
            )

            missing_points = evaluation.get(
                "missing_points",
                []
            )

            if not isinstance(missing_points, list):
                missing_points = []

            missing_points = [
                str(point)
                for point in missing_points
                if point
            ][:3]

            results.append({
                "question": question,
                "answer": answer,
                "score": score,
                "status": status,
                "feedback": feedback,
                "missing_points": missing_points
            })

            total_score += score

        except Exception as error:

            print("Evaluation error:", error)

            results.append({
                "question": question,
                "answer": answer,
                "score": 0,
                "status": "Evaluation Error",
                "feedback": "AI evaluation failed.",
                "missing_points": []
            })

    average_score = round(
        total_score / len(answers),
        1
    ) if answers else 0

    # -----------------------------
    # PERFORMANCE SUMMARY
    # -----------------------------

    correct_count = sum(
        1 for item in results
        if item["status"] == "Correct"
    )

    partial_count = sum(
        1 for item in results
        if item["status"] == "Partially Correct"
    )

    incorrect_count = sum(
        1 for item in results
        if item["status"] == "Incorrect"
    )

    strengths = []

    if correct_count > 0:
        strengths.append(
            f"{correct_count} answer(s) demonstrated "
            "strong technical understanding."
        )

    if average_score >= 8:
        strengths.append(
            "Strong understanding of the core concepts."
        )
    elif average_score >= 6:
        strengths.append(
            "Good understanding of the fundamentals."
        )

    weaknesses = []

    if partial_count > 0:
        weaknesses.append(
            f"{partial_count} answer(s) need more complete explanations."
        )

    if incorrect_count > 0:
        weaknesses.append(
            f"{incorrect_count} answer(s) need concept-level improvement."
        )

    improvement_areas = []

    for item in results:
        for point in item.get("missing_points", []):
            if (
                point
                and point not in improvement_areas
            ):
                improvement_areas.append(point)

    improvement_areas = improvement_areas[:6]

    if not strengths:
        strengths.append(
            "Continue practicing the core technical fundamentals."
        )

    if not weaknesses:
        weaknesses.append(
            "Focus on giving structured and complete explanations."
        )

    if not improvement_areas:
        improvement_areas.append(
            "Practice explaining technical concepts with examples."
        )

    if average_score >= 8:
        performance = "Strong"
    elif average_score >= 6:
        performance = "Good"
    elif average_score >= 4:
        performance = "Needs Improvement"
    else:
        performance = "Beginner"

    return {
        "overall_score": average_score,
        "performance": performance,
        "total_questions": len(answers),
        "correct_count": correct_count,
        "partial_count": partial_count,
        "incorrect_count": incorrect_count,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "improvement_areas": improvement_areas,
        "results": results
    }