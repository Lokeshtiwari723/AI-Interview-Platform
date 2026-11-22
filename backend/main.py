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


# ------------------------------------------------------------
# ANSWER EVALUATION (strict) - used by /evaluate
#
# The AI only decides WHICH key points the answer really covers.
# The score is then calculated HERE in Python:
#     score = (covered key points / all key points) x 10
# so a wrong or irrelevant answer can never get "random partial marks".
# ------------------------------------------------------------

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2:3b"

WRONG_PENALTY = 1.0   # marks (out of 10) removed for every wrong statement
CORRECT_LIMIT = 0.8   # 80% or more of the key points covered = "Correct"

NO_ANSWER_PATTERNS = [
    r"^\s*(i\s*)?(do\s*not|don'?t)\s*know\s*\.?\s*$",
    r"^\s*(no\s*idea|not\s*sure|idk|skip|pass|nothing|n/?a)\s*\.?\s*$",
    r"^\s*(pata\s*nahi|pata\s*nhi|nahi\s*pata|nhi\s*pata|malum\s*nahi)\s*\.?\s*$",
]


# very common words: a real answer almost always contains at least one of them
COMMON_WORDS = {
    "the", "an", "is", "are", "was", "were", "be", "been", "to", "of", "in", "on",
    "at", "for", "with", "by", "from", "and", "or", "but", "not", "it", "its",
    "this", "that", "these", "those", "as", "can", "will", "used", "use", "uses",
    "using", "you", "we", "they", "he", "she", "my", "your", "our", "their",
    "which", "what", "when", "where", "why", "how", "who", "if", "then", "than",
    "so", "also", "do", "does", "did", "has", "have", "had", "into", "about",
    "more", "one", "all", "any", "some", "each", "like", "between", "there",
    "here", "them", "very", "just", "only", "other", "such", "may", "should",
    "would", "could", "means", "mean", "called", "known", "way", "type",
    # Hinglish
    "hai", "hain", "ka", "ke", "ki", "ko", "se", "me", "mein", "par", "aur",
    "ye", "yeh", "wo", "woh", "jab", "tha", "hota", "hoti", "hote", "kar",
    "karta", "karte", "liye", "nahi", "nhi", "bhi",
}


def _plain_words(text):
    words = re.findall(r"[A-Za-z][A-Za-z0-9+#.]*", text or "")
    return [w.lower().rstrip(".") for w in words]


def _is_junk_answer(answer, question=""):
    """True for answers that need no AI check:
    symbols, random letters, 'I don't know', or an answer that only repeats the question."""

    text = (answer or "").strip()

    if len(re.findall(r"[A-Za-z]", text)) < 3:
        return True

    for pattern in NO_ANSWER_PATTERNS:
        if re.match(pattern, text, flags=re.IGNORECASE):
            return True

    words = _plain_words(text)

    if not words:
        return True

    question_words = set(_plain_words(question))

    # random letters like "edhwgewg wehgdhb": no common word and nothing from the question
    has_common_word = any(w in COMMON_WORDS for w in words)
    uses_question_word = any(
        w in question_words and w not in COMMON_WORDS for w in words
    )

    if not has_common_word and not uses_question_word:
        return True

    # the answer only repeats words of the question
    content_words = [w for w in words if w not in COMMON_WORDS and len(w) >= 3]

    if content_words and all(w in question_words for w in content_words):
        return True

    tokens = [w.lower() for w in text.split()]

    if len(tokens) >= 4 and len(set(tokens)) == 1:
        return True

    return False


def _is_real_attempt(question, answer):
    """Short yes/no check by the AI: is this a real, on-topic attempt?
    If the AI cannot be reached, nothing is blocked here."""

    prompt = f"""You check interview answers.

QUESTION:
{question}

CANDIDATE ANSWER:
{answer}

Is the candidate answer a real attempt that talks about the topic of the question in meaningful words?

Set "relevant" to false if the answer is random letters, gibberish, about a different topic, a joke, or only repeats the question.
Set "relevant" to true only if it is a genuine attempt at answering this question (even if it is wrong or incomplete).

Return ONLY this JSON: {{"relevant": true}} or {{"relevant": false}}
"""

    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0, "num_predict": 30}
            },
            timeout=60
        )

        response.raise_for_status()

        return json.loads(response.json()["response"]).get("relevant") is not False

    except Exception as error:
        print("Relevance check error:", error)
        return True


def _word_set(text):
    return set(re.findall(r"[a-z0-9+#]{3,}", (text or "").lower()))


def _evidence_ok(evidence, answer):
    """The AI must copy the part of the answer that proves a key point.
    If those words are not really in the answer, the point does not count."""

    evidence_words = _word_set(str(evidence or ""))

    if not evidence_words:
        return False

    found = len(evidence_words & _word_set(answer))

    return found / len(evidence_words) >= 0.6


def _build_eval_prompt(role, level, question, answer):
    return f"""You are a STRICT technical interview evaluator.

ROLE: {role}
LEVEL: {level}

QUESTION:
{question}

CANDIDATE ANSWER:
{answer}

Do these steps:

1. Write 3 to 5 KEY POINTS that a correct answer to this question must contain.
   Each key point must be a short, specific technical fact.

2. For each key point decide if the candidate answer states it correctly.
   - covered = true ONLY if the answer clearly and correctly says it.
     Copy the exact words from the candidate answer that prove it into "evidence".
   - covered = false if the answer is vague, off-topic, wrong, or only repeats
     words from the question. Then "evidence" must be "".
   - Different wording is fine, but the idea must be correct.
   - A short answer can still cover every key point.

3. In "wrong_statements" list every statement in the answer that is technically WRONG.

4. In "feedback" write 1 or 2 simple sentences: what is right and what is wrong or missing.
   If nothing is correct, say clearly that the answer is incorrect.

Return ONLY valid JSON in exactly this format:

{{
  "key_points": [
    {{"point": "short key point", "covered": true, "evidence": "words copied from the answer"}},
    {{"point": "short key point", "covered": false, "evidence": ""}}
  ],
  "wrong_statements": [],
  "feedback": ""
}}
"""


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

        # symbols / random letters / "I don't know" / repeating the question -> 0, no AI needed
        # then a quick AI yes/no check that the answer is really about the question
        if _is_junk_answer(answer, question) or not _is_real_attempt(question, answer):
            results.append({
                "question": question,
                "answer": answer,
                "score": 0,
                "status": "Incorrect",
                "feedback": "This is not a valid or relevant answer to the question.",
                "missing_points": ["A relevant technical answer is required."]
            })
            continue

        prompt = _build_eval_prompt(role, level, question, answer)

        try:

            response = requests.post(
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0}
                },
                timeout=120
            )

            response.raise_for_status()

            evaluation = json.loads(response.json()["response"])

            points = evaluation.get("key_points") or []

            if not isinstance(points, list):
                points = []

            covered = []
            missing = []

            for point in points:
                if not isinstance(point, dict):
                    continue

                text = str(point.get("point", "")).strip()

                if not text:
                    continue

                if point.get("covered") is True and _evidence_ok(point.get("evidence"), answer):
                    covered.append(text)
                else:
                    missing.append(text)

            wrong = evaluation.get("wrong_statements") or []

            if not isinstance(wrong, list):
                wrong = []

            wrong = [str(w).strip() for w in wrong if str(w).strip()]

            total_points = len(covered) + len(missing)

            # ---- the score is calculated here, not by the AI ----
            if total_points == 0 or not covered:
                score = 0.0
            else:
                score = 10 * len(covered) / total_points
                score -= WRONG_PENALTY * len(wrong)
                score = max(0.0, min(10.0, round(score, 1)))

            if score <= 0:
                status = "Incorrect"
            elif len(covered) / total_points >= CORRECT_LIMIT and not wrong:
                status = "Correct"
            else:
                status = "Partially Correct"

            feedback = str(evaluation.get("feedback") or "").strip()

            if score <= 0:
                feedback = "Incorrect answer. It does not correctly answer what the question asks."

                if wrong:
                    feedback += f" Wrong: {wrong[0]}"
            elif not feedback:
                feedback = "Some key points are correct, but important points are missing."

            results.append({
                "question": question,
                "answer": answer,
                "score": score,
                "status": status,
                "feedback": feedback,
                "missing_points": missing[:3]
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