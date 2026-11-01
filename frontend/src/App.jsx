import { useEffect, useRef, useState } from "react";
import questions from "./questions";
import "./App.css";
import LandingPage from "./LandingPage";
import interviewerImg from "./assets/interviewer.png";
import VideoInterview from "./video/VideoInterview";
import { speakWithBrowser, unlockBrowserVoice } from "./browserVoice";
import { supabase, supabaseReady } from "./supabaseClient";
import ProfilePage, { ProfileMenu } from "./Profile";

const roles = [

  {
    title: "Frontend Developer",
    short: "FE",
    desc: "React, JavaScript, HTML, CSS & web fundamentals",
  },

  {
    title: "Backend Developer",
    short: "BE",
    desc: "APIs, databases, servers & backend concepts",
  },

  {
    title: "Full Stack Developer",
    short: "FS",
    desc: "Frontend, backend, APIs & databases",
  },

  {
    title: "Data Analyst",
    short: "DA",
    desc: "SQL, Python, statistics & data analysis",
  },

  {
    title: "Product Engineer",
    short: "PE",
    desc: "Product development, software engineering, APIs & system design",
  },

   {
    title: "Languages",
    short: "LANG",
    desc: "C, C++, C#, Java, JavaScript, HTML, CSS & Python",
  },

];

const levels = ["Fresher", "Intermediate", "Advanced"];
const languages = [
  "C",
  "C++",
  "C#",
  "Java",
  "JavaScript",
  "HTML",
  "CSS",
  "Python",
];

const authInputStyle = {
  width: "100%",
  padding: "16px 18px",
  marginTop: "14px",
  borderRadius: "14px",
  border: "1px solid #292733",
  background: "#0c0b14",
  color: "white",
  outline: "none",
  fontSize: "15px",
  boxSizing: "border-box",
};

// turns the Supabase user into the small object the app uses
function toAppUser(authUser) {
  if (!authUser) return null;

  const email = authUser.email || "";

  return {
    id: authUser.id,
    email,
    name: authUser.user_metadata?.full_name || email.split("@")[0] || "User",
    createdAt: authUser.created_at,
  };
}

function App() {
  const [authMode, setAuthMode] = useState("login");
const [authName, setAuthName] = useState("");
const [authEmail, setAuthEmail] = useState("");
const [authPassword, setAuthPassword] = useState("");
const [forgotPassword, setForgotPassword] = useState(false);
const [newPassword, setNewPassword] = useState("");
const [authError, setAuthError] = useState("");
const [user, setUser] = useState(null);
const [recovering, setRecovering] = useState(false);
const [saveStatus, setSaveStatus] = useState("idle");
const [interviewMode, setInterviewMode] = useState("guest");
const [showContinue, setShowContinue] = useState(false);
const isLoggedIn = !!user;
  const [page, setPage] = useState("home");

  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("");

  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState([]);

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef(null);

  const [evaluation, setEvaluation] = useState(null);
  const [evaluating, setEvaluating] = useState(false);

  const audioCache = useRef(new Map());
  const speakingRef = useRef(false);

  const currentQuestions =
  role === "Languages"
    ? questions["Languages"]?.[selectedLanguage]?.[level] || []
    : questions[role]?.[level] || [];

const currentQuestion = currentQuestions[questionIndex];
console.log("ROLE:", role);
console.log("LANGUAGE:", selectedLanguage);
console.log("LEVEL:", level);
console.log("QUESTIONS:", currentQuestions);
  // -----------------------------
  // PRELOAD QUESTION AUDIO
  // -----------------------------

  const preloadSpeech = async (text) => {
    if (!text) return;

    if (audioCache.current.has(text)) {
      return;
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/speak?text=${encodeURIComponent(text)}`
      );

      if (!response.ok) {
        throw new Error("Speech generation failed");
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      audioCache.current.set(text, audioUrl);
    } catch (error) {
      console.error("Speech preload error:", error);
    }
  };

  // Preload current question
  useEffect(() => {
    if (currentQuestion) {
      preloadSpeech(currentQuestion);
    }
  }, [currentQuestion]);

  // -----------------------------
  // SUPABASE LOGIN SESSION
  // -----------------------------

  useEffect(() => {
    // data of the old backend login is not used any more
    localStorage.removeItem("interviewToken");
    localStorage.removeItem("interviewUser");

    supabase.auth
      .getSession()
      .then(({ data }) => setUser(toAppUser(data.session?.user)))
      .catch(() => {});

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(toAppUser(session?.user));

        // the user opened the "reset password" link from the email
        if (event === "PASSWORD_RECOVERY") {
          setRecovering(true);
          setForgotPassword(true);
          setAuthError("");
          setPage("auth");
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // -----------------------------
  // SPEAK QUESTION
  // -----------------------------

  const speakQuestion = async (questionText = currentQuestion) => {
    if (!questionText) return;

    if (speakingRef.current) {
      return;
    }

    speakingRef.current = true;
    setSpeaking(true);

    try {
      await preloadSpeech(questionText);

      const audioUrl = audioCache.current.get(questionText);

      if (!audioUrl) {
        throw new Error("Audio not available");
      }

      const audio = new Audio(audioUrl);

      audio.onended = () => {
        speakingRef.current = false;
        setSpeaking(false);
      };

      audio.onerror = () => {
        speakingRef.current = false;
        setSpeaking(false);
      };

      await audio.play();
    } catch (error) {
      console.error("Speech error (using the browser voice instead):", error);

      try {
        await speakWithBrowser(questionText);
      } catch {
        // nothing more to try
      }

      speakingRef.current = false;
      setSpeaking(false);
    }
  };
// ==========================
// SUPABASE: LOGIN / SIGNUP / LOGOUT / HISTORY
// ==========================
const authColor = (text) => (text.startsWith("✓") ? "#6ff0c4" : "#ff6b6b");

const handleAuth = async () => {
  setAuthError("");

  if (!supabaseReady) {
    setAuthError(
      "Supabase is not connected. Add the keys in frontend/.env and restart npm run dev."
    );
    return;
  }

  const email = authEmail.trim();

  if (!email || !authPassword) {
    setAuthError("Email and password are required.");
    return;
  }

  try {
    if (authMode === "signup") {
      if (!authName.trim()) {
        setAuthError("Please enter your full name.");
        return;
      }

      if (authPassword.length < 6) {
        setAuthError("Password must be at least 6 characters.");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password: authPassword,
        options: { data: { full_name: authName.trim() } },
      });

      if (error) {
        setAuthError(error.message);
        return;
      }

      // this email already has an account
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setAuthError("This email is already registered. Please login.");
        return;
      }

      // "Confirm email" is ON in Supabase, so there is no session yet
      if (!data.session) {
        setAuthMode("login");
        setAuthPassword("");
        setAuthError(
          "✓ Account created. Please confirm your email (check your inbox), then login."
        );
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: authPassword,
      });

      if (error) {
        setAuthError(error.message);
        return;
      }
    }

    setAuthName("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthError("");

    setInterviewMode("loggedIn");
    setPage("setup");
  } catch (error) {
    console.error("Auth error:", error);
    setAuthError(
      "Could not connect to Supabase. Check your internet and the keys in frontend/.env."
    );
  }
};

const sendResetLink = async () => {
  setAuthError("");

  if (!authEmail.trim()) {
    setAuthError("Please enter your email.");
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(
    authEmail.trim(),
    { redirectTo: window.location.origin }
  );

  setAuthError(
    error ? error.message : "✓ Reset link sent. Please check your email."
  );
};

const updatePassword = async () => {
  setAuthError("");

  if (newPassword.length < 6) {
    setAuthError("Password must be at least 6 characters.");
    return;
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    setAuthError(error.message);
    return;
  }

  setRecovering(false);
  setForgotPassword(false);
  setNewPassword("");
  setAuthError("");
  setInterviewMode("loggedIn");
  setPage("home");
};

const handleLogout = async () => {
  await supabase.auth.signOut();

  setUser(null);
  setInterviewMode("guest");
  setPage("home");
};

// saves a finished interview in the user's history (Supabase table "interviews")
const saveInterview = async (data, cleanedAnswers) => {
  if (!user) return;

  setSaveStatus("saving");

  const { error } = await supabase.from("interviews").insert({
    user_id: user.id,
    role,
    level,
    language: role === "Languages" ? selectedLanguage : null,
    mode: level === "Mixed" ? "video" : "standard",
    overall_score: data.overall_score ?? 0,
    performance: data.performance ?? null,
    total_questions: data.total_questions ?? cleanedAnswers.length,
    results: data,
  });

  if (error) console.error("Could not save the interview:", error);

  setSaveStatus(error ? "error" : "saved");
};

// opens an old report from the history in the normal result page
const openReport = (row, report) => {
  setRole(row.role);
  setLevel(row.level);
  setSelectedLanguage(row.language || "");
  setAnswers(
    (report.results || []).map((item) => ({
      question: item.question,
      answer: item.answer || "",
    }))
  );
  setEvaluation(report);
  setEvaluating(false);
  setSaveStatus("idle");
  setPage("result");
};

// the round profile icon (shown in the top right corner when logged in)
const profileMenu = user ? (
  <ProfileMenu
    user={user}
    onProfile={() => setPage("profile")}
    onLogout={handleLogout}
  />
) : null;

  // -----------------------------
  // START INTERVIEW
  // -----------------------------

  const startInterview = () => {
  if (!role || !level) return;

  if (role === "Languages" && !selectedLanguage) return;

  unlockBrowserVoice();

  setQuestionIndex(0);
  setAnswers([]);
  setAnswer("");
  setEvaluation(null);
  setEvaluating(false);
  setShowContinue(false);
  setInterviewMode(isLoggedIn ? "loggedIn" : "guest");
  setPage("interview");

  setTimeout(() => {
    if (role === "Languages") {
      speakQuestion(
        questions["Languages"][selectedLanguage][level][0]
      );
    } else {
      speakQuestion(
        questions[role][level][0]
      );
    }
  }, 300);
};
  // -----------------------------
  // START VIDEO INTERVIEW
  // -----------------------------

  const startVideoInterview = () => {
    if (!role) return;

    if (role === "Languages" && !selectedLanguage) return;

    setLevel("Mixed");
    setAnswers([]);
    setAnswer("");
    setEvaluation(null);
    setEvaluating(false);
    setShowContinue(false);
    setPage("video");
  };

  // -----------------------------
  // VOICE INPUT
  // -----------------------------

  const startVoiceInput = () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert("Voice input is not supported in this browser.");
    return;
  }

  // If already listening → STOP / MUTE
  if (listening) {
    recognitionRef.current?.stop();
    setListening(false);
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = true;

  recognitionRef.current = recognition;

  recognition.onstart = () => {
    setListening(true);
  };

  recognition.onresult = (event) => {
    let text = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }

    setAnswer((prev) => {
      if (!prev.trim()) {
        return text;
      }

      return `${prev} ${text}`;
    });
  };

  recognition.onerror = (event) => {
    console.error("Voice recognition error:", event.error);
    setListening(false);
  };

  recognition.onend = () => {
    setListening(false);
    recognitionRef.current = null;
  };

  try {
    recognition.start();
  } catch (error) {
    console.error("Recognition start error:", error);
    setListening(false);
  }
};
  // -----------------------------
// NEXT QUESTION / EVALUATION
// -----------------------------

const finishInterview = async (finalAnswers = answers) => {
  // Keep one answer slot per question index so previous answers can never
  // shift onto a later question. Preserve unanswered questions as blank.
  const sourceAnswers = Array.isArray(finalAnswers) ? finalAnswers : [];
  const cleanedAnswers = sourceAnswers
    .filter((item) => item && typeof item.question === "string")
    .reduce((unique, item) => {
      const question = item.question.trim();
      if (!question) return unique;
      const existingIndex = unique.findIndex((entry) => entry.question === question);
      const normalized = { question, answer: (item.answer || "").trim() };
      if (existingIndex >= 0) unique[existingIndex] = normalized;
      else unique.push(normalized);
      return unique;
    }, []);

  setAnswers(cleanedAnswers);
  setEvaluation(null);
  setEvaluating(true);
  setSaveStatus("idle");
  setPage("result");

  try {
    const response = await fetch("http://127.0.0.1:8000/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, level, answers: cleanedAnswers }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.message || "Evaluation request failed.");
    }
    setEvaluation(data);
    saveInterview(data, cleanedAnswers);
  } catch (error) {
    console.error("Interview evaluation error:", error);
    setEvaluation(null);
  } finally {
    setEvaluating(false);
  }
};

const previousQuestion = () => {
  if (questionIndex === 0) return;

  const previousIndex = questionIndex - 1;

  setQuestionIndex(previousIndex);

  const previousAnswer = answers[previousIndex]?.answer || "";
  setAnswer(previousAnswer);

  setShowContinue(false);

  setTimeout(() => {
    speakQuestion(currentQuestions[previousIndex]);
  }, 300);
};

const nextQuestion = async () => {
  // Store the answer at its question index (upsert), not by appending.
  // This prevents duplicates when revisiting or continuing after question 10.
  const updatedAnswers = [...answers];
  updatedAnswers[questionIndex] = {
    question: currentQuestion,
    answer: answer.trim(),
  };

  setAnswers(updatedAnswers);
  setAnswer("");

  const currentNumber = questionIndex + 1;
  const totalQuestions = currentQuestions.length;

  // Guest: maximum 10 questions
  if (!isLoggedIn && currentNumber === 10) {
    setShowContinue(true);
    return;
  }

  // Logged-in: checkpoint after every 10 questions
  if (
    isLoggedIn &&
    currentNumber % 10 === 0 &&
    currentNumber < totalQuestions
  ) {
    setShowContinue(true);
    return;
  }

  // Last question
  if (currentNumber === totalQuestions) {
    finishInterview(updatedAnswers);
    return;
  }

  // Next question
  const nextIndex = questionIndex + 1;

  setQuestionIndex(nextIndex);

  setTimeout(() => {
    speakQuestion(currentQuestions[nextIndex]);
  }, 300);
};

  // -----------------------------
  // PROFILE PAGE
  // -----------------------------

  if (page === "profile" && user) {
    return (
      <ProfilePage
        user={user}
        onBack={() => setPage("home")}
        onStart={() => {
          setInterviewMode("loggedIn");
          setPage("setup");
        }}
        onLogout={handleLogout}
        onOpenReport={openReport}
      />
    );
  }

  // -----------------------------
  // VIDEO INTERVIEW PAGE
  // -----------------------------

  if (page === "video") {
    return (
      <VideoInterview
        role={role}
        language={selectedLanguage}
        onQuit={() => setPage("home")}
        onFinish={(videoAnswers) => finishInterview(videoAnswers)}
      />
    );
  }

  // -----------------------------
  // INTERVIEW PAGE
  // -----------------------------

  if (page === "interview") {
    return (
      <div className="interview-page">
        <header className="topbar">
          <div className="brand">
            <div className="logo">AI</div>

            <span>
              Interview<span>AI</span>
            </span>
          </div>

          <div className="top-actions">
            <button
              className="quit"
              onClick={() => {
                setPage("home");
                setListening(false);
              }}
            >
              Quit Interview
            </button>

            {profileMenu}
          </div>
        </header>

        <main className="interview-layout">
          {/* SIDEBAR */}

          <aside className="sidebar">
            <div className="side-menu">
              <div className="side-item active">
                🎯 Interview
              </div>

              <div className="side-item">
                📊 Progress
              </div>

              <div className="side-item">
                🕘 History
              </div>
            </div>

            <div className="progress-card">
              <small>INTERVIEW PROGRESS</small>

              <div className="progress-line">
                <div
                  style={{
                    width: `${((questionIndex + 1) / 10) * 100}%`,
                    height: "100%",
                    background:
                      "linear-gradient(90deg,#7c3cff,#5478ff)",
                    borderRadius: "20px",
                  }}
                />
              </div>

              <strong>
             {questionIndex + 1}/{currentQuestions.length}
              </strong>

              <p>
                Answer each question naturally. Your responses
                will be evaluated after the interview.
              </p>
            </div>
          </aside>

          {/* AI PANEL */}

          <section className="ai-panel">
            <div className="panel-top">
              <div className="status">
                <i />
                AI Interviewer Online
              </div>

              <div className="voice-mode">
                🔊 Voice Mode
              </div>
            </div>

            <div className="avatar-area">
              <div className="avatar-ring">
                <div className="avatar">
                  <img
                    src={interviewerImg}
                    alt="AI interviewer"
                    draggable="false"
                  />
                </div>
              </div>

              <div className="wave">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>

              <div className="welcome-box">
                <div className="sound-icon">
                  🔊
                </div>

                <div>
                  <h3>
                    Question {questionIndex + 1}
                  </h3>

                  <p>
                    {currentQuestion}
                  </p>
                </div>
              </div>

              {/* CONTROLS */}

              <div className="mic-controls">
                <button
                  onClick={() => speakQuestion()}
                  disabled={speaking}
                  title="Repeat question"
                >
                  {speaking ? "🔊" : "🔊"}
                </button>

                <button
               className="mic"
               onClick={startVoiceInput}
               title={listening ? "Stop voice input" : "Speak your answer"}
>
               {listening ? "⏹" : "🎙"}
               </button>

                <button
  className="mic"
  onClick={previousQuestion}
  disabled={questionIndex === 0}
  title="Previous Question"
  style={{
    opacity: questionIndex === 0 ? 0.35 : 1,
    cursor: questionIndex === 0 ? "not-allowed" : "pointer",
  }}
>
  ⟲
</button>
              </div>

              {/* ANSWER BOX */}

              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={
                  listening
                    ? "Listening..."
                    : "Type your answer or use the microphone..."
                }
                style={{
                  width: "100%",
                  maxWidth: "650px",
                  minHeight: "120px",
                  marginTop: "25px",
                  padding: "18px",
                  borderRadius: "18px",
                  border: "1px solid #29263a",
                  background: "#0c0b14",
                  color: "white",
                  resize: "vertical",
                  outline: "none",
                }}
              />

              {/* NEXT */}
<button
  className="primary"
  onClick={nextQuestion}
  disabled={!answer.trim()}
>
  Next Question →
</button>
              {isLoggedIn && !showContinue && (
  <button
    className="secondary"
    style={{ marginTop: "12px" }}
    onClick={() => {
      // Keep the current question in the report even when unanswered;
      // its blank answer will be shown as Not Attended in the results.
      const updatedAnswers = [...answers];
      updatedAnswers[questionIndex] = {
        question: currentQuestion,
        answer: answer.trim(),
      };

      const answersThroughCurrentQuestion = updatedAnswers.slice(0, questionIndex + 1);
      setAnswers(answersThroughCurrentQuestion);
      setAnswer("");
      finishInterview(answersThroughCurrentQuestion);
    }}
  >
    Finish Interview
  </button>
)}
              {showContinue && (
                <div style={{ marginTop: "20px", textAlign: "center" }}>
                  <p style={{ color: "#aaa" }}>
                    You completed {questionIndex + 1} questions.
                  </p>
                  {isLoggedIn ? (
                    <>
                      <button
                        className="secondary"
                        onClick={() => {
                          setShowContinue(false);
                          const nextIndex = questionIndex + 1;
                          setQuestionIndex(nextIndex);
                          setAnswer("");
                          setTimeout(() => speakQuestion(currentQuestions[nextIndex]), 300);
                        }}
                      >
                        Continue Interview →
                      </button>
                      <button
                        className="primary"
                        style={{ display: "block", margin: "8px auto 0" }}
                        onClick={() => finishInterview(answers)}
                      >
                        Finish & See Results
                      </button>
                    </>
                  ) : (
                    <>
                      <p style={{ color: "#aaa" }}>
                        Sign up or login to continue the interview.
                      </p>
                      <button className="primary" onClick={() => setPage("auth")}>
                        Sign Up / Login
                      </button>
                      <button
                        className="secondary"
                        style={{ display: "block", margin: "8px auto 0" }}
                        onClick={() => finishInterview(answers)}
                      >
                        Finish & See Results
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* SETUP PANEL */}

          <aside className="setup-panel">
            <div className="setup-label">
              INTERVIEW SETUP
            </div>

            <h1>{role}</h1>

            <div className="level-badge">
              {level}
            </div>

            <div className="stats">
              <div>
              Questions <b>{currentQuestions.length}</b>
              </div>

              <div>
                Level <b>{level}</b>
              </div>
            </div>

            <div className="feature">
              <div>🎙</div>

              <section>
                <b>Voice Answers</b>

                <p>
                  Speak naturally and let AI convert your
                  response to text.
                </p>
              </section>
            </div>

            <div className="feature">
              <div>🧠</div>

              <section>
                <b>AI Evaluation</b>

                <p>
                  Your answers will be reviewed for accuracy
                  and relevance.
                </p>
              </section>
            </div>

            <div className="feature">
              <div>📈</div>

              <section>
                <b>Performance Report</b>

                <p>
                  Get your strengths, weaknesses and
                  improvement areas.
                </p>
              </section>
            </div>

            <div className="luck-card">
              <strong>💡 Interview Tip</strong>

              <p>
                Think clearly before answering. Explain your
                reasoning instead of giving only a short
                response.
              </p>
            </div>
          </aside>
        </main>
      </div>
    );
  }
if (page === "auth") {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">AI</div>

          <span>
            Interview<span>AI</span>
          </span>
        </div>

        <button
          className="login"
          onClick={() => {
            setPage("home");
            setForgotPassword(false);
            setAuthError("");
            setNewPassword("");
          }}
        >
          ← Back
        </button>
      </header>

      <section
        className="hero"
        style={{
          minHeight: "80vh",
        }}
      >
        <div className="pill">
          {forgotPassword
            ? "RESET PASSWORD"
            : authMode === "login"
            ? "WELCOME BACK"
            : "CREATE ACCOUNT"}
        </div>

        <h1>
          {forgotPassword ? (
            <>
              Reset your
              <br />
              <span>password.</span>
            </>
          ) : authMode === "login" ? (
            <>
              Welcome
              <br />
              <span>back.</span>
            </>
          ) : (
            <>
              Start your
              <br />
              <span>journey.</span>
            </>
          )}
        </h1>

        <p>
          {forgotPassword
            ? recovering
              ? "Choose a new password for your account."
              : "Enter your email and we will send you a reset link."
            : authMode === "login"
            ? "Login to continue your interview preparation."
            : "Create an account to save your interview progress."}
        </p>

        <div
          style={{
            width: "100%",
            maxWidth: "450px",
            marginTop: "40px",
          }}
        >

          {/* ========================= */}
          {/* FORGOT PASSWORD FORM */}
          {/* ========================= */}

          {forgotPassword ? (
            <>
              {recovering ? (
                <input
                  type="password"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={authInputStyle}
                />
              ) : (
                <input
                  type="email"
                  placeholder="Email address"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  style={authInputStyle}
                />
              )}

              {authError && (
                <p
                  style={{
                    color: authColor(authError),
                    marginTop: "15px",
                  }}
                >
                  {authError}
                </p>
              )}

              <button
                className="primary"
                style={{
                  marginTop: "25px",
                  width: "100%",
                }}
                onClick={recovering ? updatePassword : sendResetLink}
              >
                {recovering ? "Update Password" : "Send Reset Link"} <b>→</b>
              </button>

              {!recovering && (
                <button
                  className="secondary"
                  style={{
                    marginTop: "12px",
                    width: "100%",
                  }}
                  onClick={() => {
                    setForgotPassword(false);
                    setAuthError("");
                    setNewPassword("");
                  }}
                >
                  ← Back to Login
                </button>
              )}
            </>
          ) : (
            <>
              {/* ========================= */}
              {/* EXISTING LOGIN / SIGNUP */}
              {/* ========================= */}

              {authMode === "signup" && (
                <input
                  value={authName}
                  onChange={(e) =>
                    setAuthName(e.target.value)
                  }
                  placeholder="Full name"
                  style={authInputStyle}
                />
              )}

              <input
                value={authEmail}
                onChange={(e) =>
                  setAuthEmail(e.target.value)
                }
                placeholder="Email address"
                type="email"
                style={authInputStyle}
              />

              <input
                value={authPassword}
                onChange={(e) =>
                  setAuthPassword(e.target.value)
                }
                placeholder="Password"
                type="password"
                style={authInputStyle}
              />

              {/* FORGOT PASSWORD LINK */}

              {authMode === "login" && (
                <div
                  style={{
                    textAlign: "right",
                    marginTop: "10px",
                  }}
                >
                  <button
                    onClick={() => {
                      setForgotPassword(true);
                      setAuthError("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#9b7cff",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              {authError && (
                <p
                  style={{
                    color: authColor(authError),
                    marginTop: "15px",
                  }}
                >
                  {authError}
                </p>
              )}

              <button
                className="primary"
                style={{
                  marginTop: "25px",
                  width: "100%",
                }}
                onClick={handleAuth}
              >
                {authMode === "login"
                  ? "Login"
                  : "Create Account"}{" "}
                <b>→</b>
              </button>

              <p
                style={{
                  marginTop: "25px",
                  color: "#888",
                }}
              >
                {authMode === "login"
                  ? "Don't have an account?"
                  : "Already have an account?"}

                <button
                  onClick={() => {
                    setAuthMode(
                      authMode === "login"
                        ? "signup"
                        : "login"
                    );

                    setAuthError("");
                    setForgotPassword(false);
                    setNewPassword("");
                  }}
                  style={{
                    marginLeft: "8px",
                    background: "none",
                    border: "none",
                    color: "#9b7cff",
                    cursor: "pointer",
                    fontWeight: "600",
                  }}
                >
                  {authMode === "login"
                    ? "Sign up"
                    : "Login"}
                </button>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
// -----------------------------
// SETUP PAGE
// -----------------------------

  if (page === "setup") {
    const isVideo = interviewMode === "video";

    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <div className="logo">AI</div>

            <span>
              Interview<span>AI</span>
            </span>
          </div>

          <div className="top-actions">
            {profileMenu}

            <button
              className="login"
              onClick={() => setPage("home")}
            >
              ← Back
            </button>
          </div>
        </header>

        <section className="hero">
          <div className="pill">
            {isVideo ? "VIDEO INTERVIEW" : "PERSONALIZED INTERVIEW"}
          </div>

          <h1>
            Choose your
            <br />
            <span>{isVideo ? "interview role." : "interview setup."}</span>
          </h1>

          <p>
            {isVideo
              ? "Select your role. Your camera and microphone will turn on next."
              : "Select your role and experience level to begin."}
          </p>

          <div
            style={{
              width: "100%",
              maxWidth: "1000px",
              marginTop: "50px",
            }}
          >
            <h2 style={{ marginBottom: "25px" }}>
              Select Role
            </h2>

            <div className="role-grid">
              {roles.map((item) => (
                <button
                  key={item.title}
                  className={`role-card ${
                    role === item.title
                      ? "selected-role"
                      : ""
                  }`}
                  onClick={() => setRole(item.title)}
                  style={{
                    border:
                      role === item.title
                        ? "1px solid #8c5cff"
                        : "1px solid #292733",
                  }}
                >
                  <div className="role-icon">
                    {item.short}
                  </div>

                  <h3>{item.title}</h3>

                  <p>{item.desc}</p>
                </button>
              ))}
            </div>
{role === "Languages" && (
  <>
    <h2
      style={{
        marginTop: "50px",
        marginBottom: "25px",
      }}
    >
      Select Language
    </h2>

    <div className="role-grid">
      {languages.map((item) => (
        <button
          key={item}
          className={`role-card ${
            selectedLanguage === item
              ? "selected-role"
              : ""
          }`}
          onClick={() => setSelectedLanguage(item)}
          style={{
            border:
              selectedLanguage === item
                ? "1px solid #8c5cff"
                : "1px solid #292733",
          }}
        >
          <div className="role-icon">
            {item}
          </div>

          <h3>{item}</h3>

          <p>
            {item} interview questions
          </p>
        </button>
      ))}
    </div>
  </>
)}
            {!isVideo && (role !== "Languages" || selectedLanguage) ? (
  <>
    <h2
      style={{
        marginTop: "70px",
        marginBottom: "25px",
      }}
    >
      Select Level
    </h2>

    <div
      className="hero-buttons"
      style={{
        justifyContent: "center",
      }}
    >
      {levels.map((item) => (
        <button
          key={item}
          className={
            level === item
              ? "primary"
              : "secondary"
          }
          onClick={() => setLevel(item)}
        >
          {item}
        </button>
      ))}
    </div>
  </>
) : null}

            <button
              className="primary"
              style={{
                marginTop: "50px",
                opacity: isVideo
                  ? (role && (role !== "Languages" || selectedLanguage) ? 1 : 0.5)
                  : (role && level ? 1 : 0.5),
              }}
              disabled={
                isVideo
                  ? !role || (role === "Languages" && !selectedLanguage)
                  : !role || !level
              }
              onClick={isVideo ? startVideoInterview : startInterview}
            >
              {isVideo ? "Start Video Interview" : "Start Interview"} <b>→</b>
            </button>
          </div>
        </section>
      </div>
    );
  }

  // -----------------------------
  // RESULT PAGE
  // -----------------------------

  if (page === "result") {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">AI</div>

          <span>
            Interview<span>AI</span>
          </span>
        </div>

        <div className="top-actions">
          {profileMenu}

          <button
            className="get-started"
            onClick={() => setPage("home")}
          >
            Home
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="pill">
          INTERVIEW COMPLETE
        </div>

        <h1>
          Your interview
          <br />
          <span>is complete.</span>
        </h1>

        <p>
          {answers.length} questions evaluated for your{" "}
          {role} {level.toLowerCase()} interview.
        </p>

        {isLoggedIn && saveStatus !== "idle" && (
          <p
            style={{
              marginTop: "14px",
              fontSize: "14px",
              color: saveStatus === "error" ? "#ff9a9a" : "#6ff0c4",
            }}
          >
            {saveStatus === "saving" && "Saving to your history..."}
            {saveStatus === "saved" && "✓ Saved to your history"}
            {saveStatus === "error" &&
              "Could not save to your history (check Supabase setup)."}
          </p>
        )}

        <div
          className="preview"
          style={{
            width: "90%",
            maxWidth: "1000px",
            textAlign: "left",
          }}
        >
          <div className="preview-top">
            <small>PERFORMANCE REPORT</small>

            <b>
              {answers.length}/10
            </b>
          </div>

          {/* LOADING */}

          {evaluating ? (
            <div
              style={{
                textAlign: "center",
                padding: "60px 20px",
              }}
            >
              <h2>
                AI is evaluating your answers...
              </h2>

              <p
                style={{
                  marginTop: "15px",
                  color: "#888",
                }}
              >
                Checking correctness, relevance,
                completeness and missing concepts.
              </p>

              <div
                style={{
                  margin: "35px auto 0",
                  width: "45px",
                  height: "45px",
                  borderRadius: "50%",
                  border: "4px solid #29263a",
                  borderTop: "4px solid #8c5cff",
                  animation:
                    "spin 1s linear infinite",
                }}
              />
            </div>
          ) : evaluation ? (
            <div style={{ marginTop: "30px" }}>

              {/* SCORE */}

              <div
                style={{
                  padding: "35px",
                  borderRadius: "22px",
                  background:
                    "linear-gradient(145deg,#11101a,#0b0a12)",
                  border: "1px solid #292733",
                  textAlign: "center",
                }}
              >
                <small>
                  OVERALL SCORE
                </small>

                <h2
                  style={{
                    fontSize: "56px",
                    margin: "12px 0",
                  }}
                >
                  {evaluation.overall_score}/10
                </h2>

                <div
                  style={{
                    display: "inline-block",
                    padding: "8px 18px",
                    borderRadius: "30px",
                    background:
                      "rgba(124,60,255,0.15)",
                    color: "#a78bfa",
                    fontWeight: "600",
                  }}
                >
                  {evaluation.performance}
                </div>
              </div>

              {/* SUMMARY GRID */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(3, 1fr)",
                  gap: "18px",
                  marginTop: "25px",
                }}
              >

                {/* STRENGTHS */}

                <div
                  style={{
                    padding: "25px",
                    borderRadius: "18px",
                    background: "#0c0b14",
                    border: "1px solid #292733",
                  }}
                >
                  <h3>💪 Strengths</h3>

                  <ul
                    style={{
                      marginTop: "15px",
                      paddingLeft: "20px",
                      color: "#aaa",
                      lineHeight: "1.7",
                    }}
                  >
                    {evaluation.strengths?.map(
                      (item, index) => (
                        <li key={index}>
                          {item}
                        </li>
                      )
                    )}
                  </ul>
                </div>

                {/* WEAKNESSES */}

                <div
                  style={{
                    padding: "25px",
                    borderRadius: "18px",
                    background: "#0c0b14",
                    border: "1px solid #292733",
                  }}
                >
                  <h3>⚠️ Weaknesses</h3>

                  <ul
                    style={{
                      marginTop: "15px",
                      paddingLeft: "20px",
                      color: "#aaa",
                      lineHeight: "1.7",
                    }}
                  >
                    {evaluation.weaknesses?.map(
                      (item, index) => (
                        <li key={index}>
                          {item}
                        </li>
                      )
                    )}
                  </ul>
                </div>

                {/* IMPROVEMENT */}

                <div
                  style={{
                    padding: "25px",
                    borderRadius: "18px",
                    background: "#0c0b14",
                    border: "1px solid #292733",
                  }}
                >
                  <h3>🚀 Improve Next</h3>

                  <ul
                    style={{
                      marginTop: "15px",
                      paddingLeft: "20px",
                      color: "#aaa",
                      lineHeight: "1.7",
                    }}
                  >
                    {evaluation.improvement_areas?.map(
                      (item, index) => (
                        <li key={index}>
                          {item}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              </div>

              {/* QUESTION ANALYSIS */}

              <div
                style={{
                  marginTop: "35px",
                }}
              >
                <h2>
                  Question-by-Question Analysis
                </h2>

                {evaluation.results?.map(
                  (item, index) => (
                    <div
                      key={index}
                      style={{
                        marginTop: "18px",
                        padding: "25px",
                        borderRadius: "18px",
                        background: "#0b0a12",
                        border:
                          "1px solid #292733",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent:
                            "space-between",
                          gap: "20px",
                        }}
                      >
                        <small>
                          QUESTION {index + 1}
                        </small>

                        <strong>
                          {item.answer?.trim() ? item.score : 0}/10
                        </strong>
                      </div>

                      <h3
                        style={{
                          marginTop: "12px",
                        }}
                      >
                        {item.question}
                      </h3>

                      <p
                        style={{
                          marginTop: "18px",
                          color: "#aaa",
                        }}
                      >
                        <strong
                          style={{
                            color: "#fff",
                          }}
                        >
                          Your Answer:
                        </strong>{" "}
                        {item.answer ||
                          "No answer provided"}
                      </p>

                      <p
                        style={{
                          marginTop: "14px",
                        }}
                      >
                        <strong>
                          Status:
                        </strong>{" "}
                        {item.answer?.trim() ? item.status : "Not Attended"}
                      </p>

                      <p
                        style={{
                          marginTop: "14px",
                          color: "#aaa",
                        }}
                      >
                        <strong
                          style={{
                            color: "#fff",
                          }}
                        >
                          Feedback:
                        </strong>{" "}
                        {item.feedback}
                      </p>

                      {item.missing_points?.length >
                        0 && (
                        <div
                          style={{
                            marginTop: "16px",
                          }}
                        >
                          <strong>
                            Missing Concepts
                          </strong>

                          <ul
                            style={{
                              marginTop: "8px",
                              paddingLeft: "22px",
                              color: "#aaa",
                            }}
                          >
                            {item.missing_points.map(
                              (point, i) => (
                                <li key={i}>
                                  {point}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "50px",
              }}
            >
              <h2>
                Evaluation could not be loaded.
              </h2>

              <p
                style={{
                  marginTop: "15px",
                  color: "#888",
                }}
              >
                Make sure FastAPI and Ollama are
                running.
              </p>
            </div>
          )}
        </div>

        <button
          className="primary"
          style={{
            marginTop: "40px",
          }}
          onClick={() => {
            setPage("home");
            setEvaluation(null);
            setAnswers([]);
            setAnswer("");
            setQuestionIndex(0);
          }}
        >
          Back to Home →
        </button>
      </section>
    </div>
  );
}

  // -----------------------------
  // HOME PAGE  (new neon landing page - see LandingPage.jsx / landing.css)
  // -----------------------------

  return (
    <LandingPage
      roles={roles}
      user={user}
      onProfile={() => setPage("profile")}
      onLogout={handleLogout}
      onLogin={() => {
        setAuthMode("login");
        setAuthError("");
        setPage("auth");
      }}
      onGetStarted={() => {
        setInterviewMode(isLoggedIn ? "loggedIn" : "guest");
        setPage("setup");
      }}
      onStartInterview={() => {
        setInterviewMode(isLoggedIn ? "loggedIn" : "guest");
        setPage("setup");
      }}
      onStartVideo={() => {
        setInterviewMode("video");
        setPage("setup");
      }}
      onSelectRole={(title) => {
        setInterviewMode(isLoggedIn ? "loggedIn" : "guest");
        setRole(title);
        setPage("setup");
      }}
    />
  );
}

export default App;