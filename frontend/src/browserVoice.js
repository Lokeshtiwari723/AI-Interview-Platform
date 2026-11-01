/*
  browserVoice.js
  ---------------
  Backup voice. If the server voice (/speak) does not work, the question is read
  out by the voice that is built into the browser (a female English voice).
*/

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

// female English voices, best first (Mac, Chrome, Windows)
const PREFERRED = [
    "Veena",
    "Neerja",
    "Samantha",
    "Karen",
    "Moira",
    "Tessa",
    "Serena",
    "Fiona",
    "Google UK English Female",
    "Google US English",
    "Zira",
    "Aria",
    "Jenny",
];

function loadVoices() {
    return new Promise((resolve) => {
        if (!synth) {
            resolve([]);
            return;
        }

        const now = synth.getVoices();

        if (now.length > 0) {
            resolve(now);
            return;
        }

        // some browsers fill the voice list a little later
        const done = () => {
            synth.removeEventListener("voiceschanged", done);
            resolve(synth.getVoices());
        };

        synth.addEventListener("voiceschanged", done);
        setTimeout(done, 800);
    });
}

function pickVoice(voices) {
    const english = voices.filter((voice) => /^en[-_]/i.test(voice.lang));

    for (const name of PREFERRED) {
        const found = english.find((voice) => voice.name.includes(name));
        if (found) return found;
    }

    return english.find((voice) => /female/i.test(voice.name)) || english[0] || null;
}

// call this inside a button click, so the browser allows speaking later
export function unlockBrowserVoice() {
    if (!synth) return;

    try {
        const silent = new SpeechSynthesisUtterance(" ");
        silent.volume = 0;
        synth.speak(silent);
    } catch {
        // nothing to do
    }
}

export function cancelBrowserVoice() {
    if (!synth) return;

    try {
        synth.cancel();
    } catch {
        // nothing to do
    }
}

// reads the text out loud, resolves when it is finished
export async function speakWithBrowser(text) {
    if (!synth || !text) return;

    const voices = await loadVoices();

    await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = pickVoice(voices);

        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else {
            utterance.lang = "en-IN";
        }

        utterance.rate = 0.95;
        utterance.pitch = 1.05;
        utterance.onend = resolve;
        utterance.onerror = resolve;

        synth.cancel();
        synth.speak(utterance);
    });
}