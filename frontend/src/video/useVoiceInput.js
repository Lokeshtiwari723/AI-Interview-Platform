import { useCallback, useEffect, useRef, useState } from "react";

/*
  useVoiceInput
  -------------
  Listens to the microphone, finds where you pause, sends each spoken part to
  the backend (/transcribe, Whisper) as a WAV file and gives the text back
  through onText.

    const voice = useVoiceInput({ stream, onText, question, paused });
    voice.liveText;           // words shown WHILE you are speaking (replaced by the exact text after a pause)
    voice.start();            // start listening (call it from a button click)
    await voice.flush();      // keep listening, but wait until the text of what was just said has arrived
    await voice.stop();       // stop listening and wait until all text has arrived
*/

const API = "http://127.0.0.1:8000";

const FRAME_MS = 50; // how often the mic volume is checked
const PAUSE_MS = 900; // silence after speech that closes one spoken part
const MAX_SEGMENT_MS = 25000; // a very long part is cut after this time
const IDLE_RESET_MS = 8000; // nothing said for this long -> start a fresh recording
const CALIBRATION_FRAMES = 12; // first 0.6 sec is used to learn the room noise
const TARGET_RATE = 16000; // Whisper listens at 16 kHz

// Loads the Whisper model on the backend so the first answer is not slow.
// The first time the model is downloaded (a few minutes). Browsers (Safari
// especially) give up on a long request, so we simply ask again until it is ready.
export async function warmUpSpeechModel() {
    const MAX_WAIT_MS = 20 * 60 * 1000;
    const allStarted = Date.now();

    while (Date.now() - allStarted < MAX_WAIT_MS) {
        const started = Date.now();

        try {
            const response = await fetch(`${API}/warmup`);

            if (!response.ok) {
                return {
                    success: false,
                    message: "Please restart the backend so the new speech feature loads.",
                };
            }

            const data = await response.json();

            if (data.success) return data;

            return {
                success: false,
                message: data.message || "Speech engine is not available.",
            };
        } catch {
            // failed at once = backend is off; failed after a long wait = the browser
            // gave up while the model was still downloading, so ask again
            if (Date.now() - started < 5000) {
                return { success: false, message: "Backend is not running." };
            }
        }
    }

    return { success: false, message: "The speech model took too long to load." };
}

/* ---------- raw audio -> 16 kHz WAV file ---------- */

function downsample(input, inputRate, outputRate) {
    if (inputRate === outputRate) return input;

    const ratio = inputRate / outputRate;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);

    for (let i = 0; i < length; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(input.length, Math.floor((i + 1) * ratio));

        let sum = 0;
        for (let j = start; j < end; j++) sum += input[j];

        output[i] = sum / Math.max(1, end - start);
    }

    return output;
}

function encodeWav(chunks, inputRate) {
    let total = 0;
    chunks.forEach((chunk) => {
        total += chunk.length;
    });

    const joined = new Float32Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
        joined.set(chunk, offset);
        offset += chunk.length;
    });

    const samples = downsample(joined, inputRate, TARGET_RATE);

    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeText = (position, text) => {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(position + i, text.charCodeAt(i));
        }
    };

    writeText(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true); // size of this block
    view.setUint16(20, 1, true); // plain PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, TARGET_RATE, true);
    view.setUint32(28, TARGET_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); // 16 bit
    writeText(36, "data");
    view.setUint32(40, samples.length * 2, true);

    // make quiet speech louder (Whisper understands clear, loud audio better)
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
    }
    const gain = peak > 0.01 ? Math.min(8, 0.9 / peak) : 1;

    for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i] * gain));
        view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }

    return new Blob([buffer], { type: "audio/wav" });
}

// the part of the live transcript that is not yet part of an earlier spoken part
function draftAfter(base, full) {
    const max = Math.min(base.length, full.length);
    let i = 0;

    while (i < max && base[i].toLowerCase() === full[i].toLowerCase()) i++;

    return full.slice(i).trim();
}

export default function useVoiceInput({
    stream,
    onText,
    question = "",
    paused = false,
}) {
    const [listening, setListening] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [level, setLevel] = useState(0);
    const [error, setError] = useState("");
    const [liveText, setLiveText] = useState("");

    const onTextRef = useRef(onText);
    const questionRef = useRef(question);
    const pausedRef = useRef(paused);

    const runningRef = useRef(false);
    const timerRef = useRef(null);
    const audioCtxRef = useRef(null);
    const analyserRef = useRef(null);
    const processorRef = useRef(null);
    const sampleRateRef = useRef(48000);
    const dataRef = useRef(null);
    const segRef = useRef(null);
    const vadRef = useRef(null);
    const queueRef = useRef(Promise.resolve());
    const pendingRef = useRef(0);

    // live words (browser speech recognition) shown while you speak
    const recRef = useRef(null);
    const liveOffRef = useRef(false);
    const fullRef = useRef("");
    const baseRef = useRef("");
    const currentDraftRef = useRef("");
    const pendingDraftsRef = useRef([]);

    // keep the latest values available inside the timer
    useEffect(() => {
        onTextRef.current = onText;
        questionRef.current = question;
        pausedRef.current = paused;
    });

    const supported = !!(window.AudioContext || window.webkitAudioContext);

    // ---------- live words ----------

    const publishLive = useCallback(() => {
        setLiveText(
            [...pendingDraftsRef.current, currentDraftRef.current]
            .filter(Boolean)
            .join(" ")
        );
    }, []);

    const clearCurrentDraft = useCallback(() => {
        currentDraftRef.current = "";
        baseRef.current = fullRef.current;
        publishLive();
    }, [publishLive]);

    // ---------- send one spoken part to the backend (in order) ----------

    const sendBlob = useCallback(
        (blob) => {
            pendingRef.current += 1;
            setTranscribing(true);

            // the live words of this part stay visible until its exact text arrives
            pendingDraftsRef.current.push(currentDraftRef.current);
            currentDraftRef.current = "";
            baseRef.current = fullRef.current;
            publishLive();

            queueRef.current = queueRef.current.then(async() => {
                let text = "";
                let failure = "";

                try {
                    const response = await fetch(
                        `${API}/transcribe?question=${encodeURIComponent(
              questionRef.current || ""
            )}`, {
                            method: "POST",
                            headers: { "Content-Type": "audio/wav" },
                            body: blob,
                        }
                    );

                    const data = await response.json();

                    if (data.success) {
                        text = data.text || "";
                    } else {
                        failure = data.message || "Could not understand the audio.";
                    }
                } catch {
                    failure = "Backend is not running.";
                }

                // swap the live words for the exact text
                pendingDraftsRef.current.shift();
                publishLive();

                if (failure) {
                    setError(failure);
                } else {
                    setError("");
                    if (text) onTextRef.current(text);
                }

                pendingRef.current -= 1;
                if (pendingRef.current === 0) setTranscribing(false);
            });
        }, [publishLive]
    );

    // ---------- one recording = one spoken part ----------

    const startSegment = useCallback(() => {
        segRef.current = {
            chunks: [],
            hadSpeech: false,
            startedAt: Date.now(),
        };
    }, []);

    const finishSegment = useCallback(
        (segment, discard) => {
            if (!discard && segment.hadSpeech && segment.chunks.length > 0) {
                sendBlob(encodeWav(segment.chunks, sampleRateRef.current));
            }
        }, [sendBlob]
    );

    const endSegment = useCallback(
        (discard = false) => {
            const segment = segRef.current;
            segRef.current = null;

            if (segment) finishSegment(segment, discard);

            if (discard) clearCurrentDraft();
        }, [clearCurrentDraft, finishSegment]
    );

    // ---------- runs every 50 ms: measures volume, finds pauses ----------

    const tick = useCallback(() => {
        const analyser = analyserRef.current;
        const data = dataRef.current;
        const vad = vadRef.current;

        if (!analyser || !data || !vad) return;

        analyser.getByteTimeDomainData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const value = (data[i] - 128) / 128;
            sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);

        // moving volume bar (updated ~10 times per second)
        vad.levelTick += FRAME_MS;
        if (vad.levelTick >= 100) {
            vad.levelTick = 0;
            setLevel(Math.min(1, rms * 6));
        }

        // learn how noisy the room is
        if (vad.calibFrames < CALIBRATION_FRAMES) {
            vad.calibSum += rms;
            vad.calibFrames += 1;

            if (vad.calibFrames === CALIBRATION_FRAMES) {
                vad.noise = Math.min(
                    0.08,
                    Math.max(0.003, vad.calibSum / CALIBRATION_FRAMES)
                );
            }
            return;
        }

        // while the AI is speaking, ignore the mic (so it never hears the AI)
        if (pausedRef.current) {
            if (segRef.current) endSegment(true);
            vad.voiced = 0;
            vad.silenceMs = 0;
            return;
        }

        if (!segRef.current) {
            startSegment();
            vad.voiced = 0;
            vad.silenceMs = 0;
        }

        const segment = segRef.current;
        if (!segment) return;

        const threshold = Math.max(0.012, vad.noise * 2.5);

        if (rms > threshold) {
            vad.voiced += 1;
            vad.silenceMs = 0;

            // needs ~100 ms of real sound, so a click or cough does not count
            if (vad.voiced >= 2) segment.hadSpeech = true;
        } else {
            vad.voiced = 0;

            if (rms < vad.noise * 2) {
                vad.noise = Math.min(0.08, Math.max(0.003, vad.noise * 0.97 + rms * 0.03));
            }

            if (segment.hadSpeech) vad.silenceMs += FRAME_MS;
        }

        const segmentMs = Date.now() - segment.startedAt;

        if (
            segment.hadSpeech &&
            (vad.silenceMs >= PAUSE_MS || segmentMs >= MAX_SEGMENT_MS)
        ) {
            endSegment(false); // sends it for transcription
        } else if (!segment.hadSpeech && segmentMs >= IDLE_RESET_MS) {
            endSegment(true); // nothing was said, start fresh
        }
    }, [endSegment, startSegment]);

    // ---------- live words from the browser's own speech recognition ----------
    // (only a preview: the exact text always comes from Whisper after a pause)

    const stopRecognition = useCallback(() => {
        const recognition = recRef.current;
        recRef.current = null;

        if (recognition) {
            recognition.onend = null;
            recognition.onresult = null;
            recognition.onerror = null;

            try {
                recognition.abort();
            } catch {
                // already stopped
            }
        }

        fullRef.current = "";
        baseRef.current = "";
    }, []);

    const startRecognition = useCallback(() => {
        const Recognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!Recognition || liveOffRef.current || recRef.current) return;

        try {
            const recognition = new Recognition();
            recognition.lang = "en-IN";
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (event) => {
                let full = "";

                for (let i = 0; i < event.results.length; i++) {
                    full += `${event.results[i][0].transcript} `;
                }

                full = full.replace(/\s+/g, " ").trim();
                fullRef.current = full;

                // the AI is talking: do not write what the microphone hears
                if (pausedRef.current) {
                    baseRef.current = full;
                    return;
                }

                currentDraftRef.current = draftAfter(baseRef.current, full);
                publishLive();
            };

            recognition.onerror = (event) => {
                // no permission for speech recognition -> simply no live preview
                if (
                    event.error === "not-allowed" ||
                    event.error === "service-not-allowed"
                ) {
                    liveOffRef.current = true;
                }
            };

            recognition.onend = () => {
                recRef.current = null;
                fullRef.current = "";
                baseRef.current = "";

                // the browser stops it now and then, so start it again
                if (runningRef.current && !liveOffRef.current) {
                    setTimeout(() => {
                        if (runningRef.current) startRecognition();
                    }, 200);
                }
            };

            recRef.current = recognition;
            recognition.start();
        } catch {
            recRef.current = null;
        }
    }, [publishLive]);

    // ---------- start / stop ----------

    const teardownAudio = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        if (processorRef.current) {
            processorRef.current.onaudioprocess = null;

            try {
                processorRef.current.disconnect();
            } catch {
                // already disconnected
            }

            processorRef.current = null;
        }

        analyserRef.current = null;

        const ctx = audioCtxRef.current;
        audioCtxRef.current = null;

        if (ctx && ctx.state !== "closed") {
            ctx.close().catch(() => {});
        }
    }, []);

    const start = useCallback(async() => {
        if (runningRef.current) return;

        if (!supported) {
            setError("This browser cannot record audio. Please use Chrome or Safari.");
            return;
        }

        if (!stream || stream.getAudioTracks().length === 0) {
            setError("Microphone is not available.");
            return;
        }

        setError("");

        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContextClass();
            await ctx.resume();

            const audioStream = new MediaStream(stream.getAudioTracks());
            const source = ctx.createMediaStreamSource(audioStream);

            // volume meter (finds speech and pauses)
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);

            // raw audio recorder (what is sent to Whisper)
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (event) => {
                const segment = segRef.current;
                if (!segment) return;

                segment.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
            };

            // the recorder only runs when it is connected to an output, so connect it
            // through a muted node (nothing is played, so there is no echo)
            const muted = ctx.createGain();
            muted.gain.value = 0;
            source.connect(processor);
            processor.connect(muted);
            muted.connect(ctx.destination);

            audioCtxRef.current = ctx;
            analyserRef.current = analyser;
            processorRef.current = processor;
            sampleRateRef.current = ctx.sampleRate;
            dataRef.current = new Uint8Array(analyser.fftSize);

            vadRef.current = {
                noise: 0.01,
                calibFrames: 0,
                calibSum: 0,
                voiced: 0,
                silenceMs: 0,
                levelTick: 0,
            };

            runningRef.current = true;
            setListening(true);
            timerRef.current = setInterval(tick, FRAME_MS);

            liveOffRef.current = false;
            startRecognition();
        } catch (err) {
            console.error("Voice input start error:", err);
            teardownAudio();
            setError("Could not start the microphone.");
        }
    }, [stream, supported, startRecognition, teardownAudio, tick]);

    // stops listening and resolves after every spoken part has been converted to text
    const stop = useCallback(() => {
        if (runningRef.current) {
            runningRef.current = false;
            setListening(false);
            setLevel(0);

            const segment = segRef.current;
            segRef.current = null;

            if (segment) finishSegment(segment, false);

            stopRecognition();
            clearCurrentDraft();
            teardownAudio();
        }

        return queueRef.current.then(() => {});
    }, [clearCurrentDraft, finishSegment, stopRecognition, teardownAudio]);

    // keeps listening, but sends what was just said and waits until its text has arrived
    const flush = useCallback(() => {
        const segment = segRef.current;

        if (segment && segment.hadSpeech) {
            segRef.current = null; // the timer starts a fresh recording by itself
            finishSegment(segment, false);
        }

        return queueRef.current.then(() => {});
    }, [finishSegment]);

    // clean up when the page is closed
    useEffect(() => {
        return () => {
            runningRef.current = false;
            segRef.current = null;

            if (timerRef.current) clearInterval(timerRef.current);

            if (processorRef.current) {
                processorRef.current.onaudioprocess = null;
            }

            const recognition = recRef.current;
            recRef.current = null;
            if (recognition) {
                recognition.onend = null;
                try {
                    recognition.abort();
                } catch {
                    // already stopped
                }
            }

            const ctx = audioCtxRef.current;
            if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
        };
    }, []);

    return {
        supported,
        listening,
        transcribing,
        level,
        error,
        liveText,
        start,
        stop,
        flush,
    };
}