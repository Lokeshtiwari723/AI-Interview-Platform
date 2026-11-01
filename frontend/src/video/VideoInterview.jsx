import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import questionBank from "../questions";
import interviewerImg from "../assets/interviewer.png";
import useVoiceInput, { warmUpSpeechModel } from "./useVoiceInput";
import {
  cancelBrowserVoice,
  speakWithBrowser,
  unlockBrowserVoice,
} from "../browserVoice";
import "./VideoInterview.css";

const API = "http://127.0.0.1:8000";

// tiny silent sound, played once on the Start click so the browser allows the AI voice later
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

// 10 questions: warm-up first, harder ones at the end
const PLAN = [
  ["Fresher", 3],
  ["Intermediate", 4],
  ["Advanced", 3],
];

function shuffle(list) {
  const copy = [...list];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function buildQuestions(role, language) {
  const pool =
    role === "Languages"
      ? questionBank["Languages"]?.[language]
      : questionBank[role];

  if (!pool) return [];

  const picked = [];

  PLAN.forEach(([levelName, count]) => {
    picked.push(...shuffle(pool[levelName] || []).slice(0, count));
  });

  return picked;
}

/* ---------- small inline icons ---------- */

const MicIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

const SpeakerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a10 10 0 0 1 0 14" />
  </svg>
);

const Brand = () => (
  <div className="vi-brand">
    <span className="vi-logo">AI</span>
    <span className="vi-brand-text">
      Interview<span>AI</span>
    </span>
  </div>
);

function CheckRow({ label, state, detail }) {
  return (
    <li className={`vi-check-row is-${state}`}>
      <span className="vi-dot" />
      <span className="vi-check-label">{label}</span>
      <span className="vi-check-detail">{detail}</span>
    </li>
  );
}

export default function VideoInterview({ role, language, onFinish, onQuit }) {
  const interviewQuestions = useMemo(
    () => buildQuestions(role, language),
    [role, language]
  );
  const total = interviewQuestions.length;

  const [stage, setStage] = useState("check"); // "check" -> "live"
  const [stream, setStream] = useState(null);
  const [mediaError, setMediaError] = useState("");
  const [speech, setSpeech] = useState({ state: "loading", message: "" });

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const unmountedRef = useRef(false);

  const audioElRef = useRef(null);
  const audioCache = useRef(new Map());
  const speakIdRef = useRef(0);
  const resolveSpeechRef = useRef(null);

  const answerRef = useRef("");
  const answersRef = useRef([]);

  const currentQuestion = interviewQuestions[index];

  /* ---------- camera + microphone ---------- */

  const requestMedia = useCallback(async () => {
    setMediaError("");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMediaError("This browser cannot open the camera. Please use Chrome or Safari.");
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          // echo cancelling stays ON (so the AI voice is not heard again);
          // the browser's own noise filter and volume control are OFF because
          // they cut the start and end of words
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      if (unmountedRef.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      streamRef.current = media;
      setStream(media);
    } catch (error) {
      console.error("Camera error:", error);

      if (error && error.name === "NotAllowedError") {
        setMediaError(
          "Camera / microphone permission is blocked. Allow it from the address bar of your browser, then press Try again."
        );
      } else if (error && error.name === "NotFoundError") {
        setMediaError("No camera or microphone was found on this device.");
      } else {
        setMediaError("Could not open the camera and microphone.");
      }
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    requestMedia();

    return () => {
      unmountedRef.current = true;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [requestMedia]);

  // show the camera in the <video> box
  useEffect(() => {
    const video = videoRef.current;

    if (video && stream) {
      video.srcObject = stream;
      const playing = video.play();
      if (playing && playing.catch) playing.catch(() => {});
    }
  }, [stream, stage]);

  /* ---------- load the speech-to-text model on the backend ---------- */

  useEffect(() => {
    let alive = true;

    warmUpSpeechModel().then((result) => {
      if (!alive) return;

      if (result.success) {
        setSpeech({ state: "ready", message: "" });
      } else {
        setSpeech({
          state: "error",
          message: result.message || "Speech engine is not available.",
        });
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  /* ---------- AI voice ---------- */

  const loadSpeech = useCallback((text) => {
    if (!audioCache.current.has(text)) {
      const request = fetch(`${API}/speak?text=${encodeURIComponent(text)}`)
        .then((response) => {
          if (!response.ok) throw new Error("Speech generation failed");
          return response.blob();
        })
        .then((blob) => URL.createObjectURL(blob));

      request.catch(() => audioCache.current.delete(text));
      audioCache.current.set(text, request);
    }

    return audioCache.current.get(text);
  }, []);

  const stopSpeaking = useCallback(() => {
    cancelBrowserVoice();

    const element = audioElRef.current;

    if (element) {
      element.onended = null;
      element.onerror = null;
      element.pause();
    }

    if (resolveSpeechRef.current) {
      resolveSpeechRef.current();
      resolveSpeechRef.current = null;
    }
  }, []);

  const speak = useCallback(
    async (text) => {
      if (!text) return;

      stopSpeaking();

      speakIdRef.current += 1;
      const myId = speakIdRef.current;

      setSpeaking(true);

      try {
        const url = await loadSpeech(text);

        if (myId !== speakIdRef.current) return;

        if (!audioElRef.current) audioElRef.current = new Audio();
        const element = audioElRef.current;

        await new Promise((resolve, reject) => {
          resolveSpeechRef.current = resolve;
          element.onended = resolve;
          element.onerror = () => reject(new Error("The voice file could not be played."));
          element.src = url;

          const playing = element.play();
          if (playing && playing.catch) playing.catch(reject);
        });
      } catch (error) {
        // the server voice did not work -> read the question with the browser voice
        console.error("Server voice failed, using the browser voice:", error);

        if (myId === speakIdRef.current) {
          await speakWithBrowser(text);
        }
      } finally {
        if (myId === speakIdRef.current) setSpeaking(false);
      }
    },
    [loadSpeech, stopSpeaking]
  );

  // ask every new question out loud (and prepare the next one)
  useEffect(() => {
    if (stage !== "live" || !currentQuestion) return undefined;

    const timer = setTimeout(() => speak(currentQuestion), 350);

    const upcoming = interviewQuestions[index + 1];
    if (upcoming) loadSpeech(upcoming).catch(() => {});

    return () => clearTimeout(timer);
  }, [stage, index, currentQuestion, interviewQuestions, speak, loadSpeech]);

  // free the sound files when the page is closed
  useEffect(() => {
    const cache = audioCache.current;

    return () => {
      speakIdRef.current += 1;

      if (audioElRef.current) audioElRef.current.pause();

      cache.forEach((request) => {
        request.then((url) => URL.revokeObjectURL(url)).catch(() => {});
      });
    };
  }, []);

  /* ---------- voice answers ---------- */

  const handleText = useCallback((text) => {
    answerRef.current = answerRef.current
      ? `${answerRef.current} ${text}`
      : text;

    setAnswer(answerRef.current);
  }, []);

  const voice = useVoiceInput({
    stream,
    onText: handleText,
    question: currentQuestion || "",
    paused: speaking || busy || stage !== "live",
  });

  const handleTyping = (event) => {
    answerRef.current = event.target.value;
    setAnswer(event.target.value);
  };

  const toggleMic = () => {
    if (voice.listening) {
      voice.stop();
    } else {
      voice.start();
    }
  };

  /* ---------- buttons ---------- */

  const begin = async () => {
    unlockBrowserVoice();

    // unlock sound playback (needs a click)
    if (!audioElRef.current) audioElRef.current = new Audio();
    audioElRef.current.src = SILENT_WAV;
    const unlocking = audioElRef.current.play();
    if (unlocking && unlocking.catch) unlocking.catch(() => {});

    if (speech.state !== "error") {
      voice.start();
    }

    setStage("live");
  };

  const goNext = async (skip = false) => {
    if (busy || !currentQuestion) return;

    setBusy(true);
    stopSpeaking();

    // wait until the last spoken words have been converted to text
    await voice.flush();

    const finalAnswer = skip ? "" : answerRef.current.trim();

    const updated = [...answersRef.current];
    updated[index] = { question: currentQuestion, answer: finalAnswer };
    answersRef.current = updated;

    if (index + 1 >= total) {
      await voice.stop();
      onFinish(updated.filter(Boolean));
      return;
    }

    answerRef.current = "";
    setAnswer("");
    setIndex(index + 1);
    setBusy(false);
  };

  const quit = () => {
    stopSpeaking();
    voice.stop();
    onQuit();
  };

  /* ---------- screens ---------- */

  if (total === 0) {
    return (
      <div className="vi">
        <header className="vi-top">
          <Brand />
          <button className="vi-quit" onClick={onQuit}>Back</button>
        </header>

        <main className="vi-empty">
          <h2>No questions found</h2>
          <p>Questions for this role are not available yet.</p>
          <button className="vi-start" onClick={onQuit}>Go back</button>
        </main>
      </div>
    );
  }

  const live = stage === "live";

  const cameraState = stream ? "ok" : mediaError ? "bad" : "wait";
  const speechState =
    speech.state === "ready" ? "ok" : speech.state === "error" ? "bad" : "wait";

  const isLast = index + 1 >= total;
  const canNext =
    !busy &&
    (answer.trim().length > 0 || voice.transcribing || voice.liveText.length > 0);

  // words you are saying right now are shown at once; after a pause they are
  // replaced by the exact text
  const shownAnswer = voice.liveText
    ? `${answer}${answer && !/\s$/.test(answer) ? " " : ""}${voice.liveText}`
    : answer;

  let micHint = "Mic is off. Tap the mic button to speak.";
  if (speaking) micHint = "AI is asking the question...";
  else if (speech.state === "loading") micHint = "Speech engine is still loading... voice will start working soon. You can type meanwhile.";
  else if (voice.transcribing) micHint = "Converting your speech to text...";
  else if (voice.listening) micHint = "Listening... speak, and pause when you are done.";
  else if (speech.state === "error") micHint = "Voice typing is unavailable. Please type your answer.";

  const bars = [0.5, 0.8, 1, 0.8, 0.5];

  // The two video boxes below are the SAME on the check screen and the live screen,
  // so the camera never restarts when the interview begins.
  return (
    <div className={`vi ${live ? "vi-is-live" : "vi-is-check"}`}>
      <header className="vi-top">
        <Brand />

        {live && (
          <div className="vi-progress">
            <span>
              Question {index + 1} of {total}
            </span>
            <div className="vi-bar">
              <i style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>
          </div>
        )}

        <button className="vi-quit" onClick={live ? quit : onQuit}>
          {live ? "Quit" : "Back"}
        </button>
      </header>

      <main className="vi-main">
        {/* ---- video boxes ---- */}
        <section className="vi-stage">
          <div className={`vi-tile vi-ai ${speaking ? "is-speaking" : ""}`}>
            {/* blurred copy of the photo fills the box, the sharp photo sits in the middle */}
            <div
              className="vi-ai-bg"
              style={{ backgroundImage: `url(${interviewerImg})` }}
            />
            <img
              className="vi-ai-photo"
              src={interviewerImg}
              alt="AI interviewer"
              draggable="false"
            />
            <span className="vi-tag">AI Interviewer</span>
            <span className="vi-status">
              {!live ? "Ready" : speaking ? "Speaking..." : busy ? "Please wait..." : "Listening"}
            </span>
          </div>

          <div className="vi-tile vi-me">
            <video ref={videoRef} autoPlay muted playsInline />

            {!stream && (
              <div className="vi-placeholder">
                {mediaError ? "Camera is off" : "Opening camera..."}
              </div>
            )}

            <span className="vi-tag">You</span>

            {live && voice.listening && !speaking && (
              <span className="vi-status vi-live">
                <i /> Mic on
              </span>
            )}
          </div>
        </section>

        {!live ? (
          /* ===== 1. CHECK SCREEN ===== */
          <section className="vi-check-card">
            <span className="vi-kicker">VIDEO INTERVIEW</span>

            <h1>
              {role}
              {role === "Languages" && language ? ` · ${language}` : ""}
            </h1>

            <p className="vi-lead">
              {total} questions, from easy to hard. The AI asks out loud, you
              answer by speaking. Typing is optional.
            </p>

            <ul className="vi-checklist">
              <CheckRow
                label="Camera"
                state={cameraState}
                detail={cameraState === "ok" ? "Ready" : cameraState === "bad" ? "Blocked" : "Waiting..."}
              />
              <CheckRow
                label="Microphone"
                state={cameraState}
                detail={cameraState === "ok" ? "Ready" : cameraState === "bad" ? "Blocked" : "Waiting..."}
              />
              <CheckRow
                label="Speech to text"
                state={speechState}
                detail={
                  speech.state === "ready"
                    ? "Ready"
                    : speech.state === "error"
                    ? "Unavailable"
                    : "Loading in background (you can start now)"
                }
              />
            </ul>

            {mediaError && (
              <div className="vi-alert">
                {mediaError}
                <button onClick={requestMedia}>Try again</button>
              </div>
            )}

            {speech.state === "error" && (
              <div className="vi-alert">
                Voice typing is not available: {speech.message} You can still
                type your answers.
              </div>
            )}

            <p className="vi-tip">
              Tip: sit in a quiet place and use headphones for the best result.
            </p>

            <button className="vi-start" disabled={!stream} onClick={begin}>
              Start Video Interview
            </button>
          </section>
        ) : (
          /* ===== 2. LIVE INTERVIEW ===== */
          <section className="vi-panel">
            <div className="vi-question">
              <div>
                <small>QUESTION {index + 1}</small>
                <p>{currentQuestion}</p>
              </div>

              <button
                className="vi-repeat"
                onClick={() => speak(currentQuestion)}
                disabled={speaking || busy}
                title="Repeat question"
              >
                <SpeakerIcon /> Repeat
              </button>
            </div>

            <div className="vi-answer">
              <div className="vi-mic-row">
                <button
                  className={`vi-mic ${voice.listening ? "is-on" : ""}`}
                  onClick={toggleMic}
                  disabled={speech.state === "error" || !voice.supported}
                  title={voice.listening ? "Turn the mic off" : "Turn the mic on"}
                >
                  <MicIcon />
                  <span>{voice.listening ? "Mic on" : "Mic off"}</span>
                </button>

                <div className="vi-meter" aria-hidden="true">
                  {bars.map((weight, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${
                          voice.listening && !speaking
                            ? 6 + Math.round(voice.level * 30 * weight)
                            : 6
                        }px`,
                      }}
                    />
                  ))}
                </div>

                <span className="vi-hint">{micHint}</span>
              </div>

              {voice.error && <p className="vi-error">{voice.error}</p>}

              <textarea
                value={shownAnswer}
                onChange={handleTyping}
                readOnly={voice.liveText.length > 0}
                disabled={busy}
                placeholder="Your answer appears here as you speak. You can also type or edit it."
              />

              <div className="vi-actions">
                <button
                  className="vi-skip"
                  onClick={() => goNext(true)}
                  disabled={busy}
                >
                  Skip question
                </button>

                <button
                  className="vi-next"
                  onClick={() => goNext(false)}
                  disabled={!canNext}
                >
                  {isLast ? "Finish Interview" : "Next Question"} →
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}