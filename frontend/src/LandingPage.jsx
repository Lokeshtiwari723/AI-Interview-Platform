import { useEffect } from "react";
import avatarImg from "./assets/avatar.png";
import "./landing.css";
import { ProfileMenu } from "./Profile";

/* ---------- small inline icons (no extra library needed) ---------- */
const Svg = ({ children, size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const RoleIcon = ({ title }) => {
  switch (title) {
    case "Backend Developer":
      return (
        <Svg>
          <rect x="2" y="3" width="20" height="7" rx="2" />
          <rect x="2" y="14" width="20" height="7" rx="2" />
          <line x1="6" y1="6.5" x2="6.01" y2="6.5" />
          <line x1="6" y1="17.5" x2="6.01" y2="17.5" />
        </Svg>
      );
    case "Full Stack Developer":
      return (
        <Svg>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </Svg>
      );
    case "Data Analyst":
      return (
        <Svg>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </Svg>
      );
    case "Product Engineer":
      return (
        <Svg>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" />
          <line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" />
          <line x1="15" y1="20" x2="15" y2="23" />
        </Svg>
      );
    case "Languages":
      return (
        <Svg>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </Svg>
      );
    default: // Frontend Developer
      return (
        <Svg>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </Svg>
      );
  }
};

const Arrow = () => (
  <Svg size={18}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </Svg>
);

const Check = () => (
  <Svg size={18}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

const features = [
  {
    title: "AI Interviewer",
    desc: "Practice with an AI interviewer that asks realistic interview questions, just like the real thing.",
    icon: (
      <Svg size={26}>
        <rect x="3" y="8" width="18" height="12" rx="3" />
        <line x1="12" y1="8" x2="12" y2="4" />
        <circle cx="9" cy="14" r="1" />
        <circle cx="15" cy="14" r="1" />
      </Svg>
    ),
  },
  {
    title: "Voice + Text",
    desc: "Answer naturally using your microphone, or simply type your response.",
    icon: (
      <Svg size={26}>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </Svg>
    ),
  },
  {
    title: "Role-Based Questions",
    desc: "Questions for every role and level: Fresher, Intermediate and Advanced.",
    icon: (
      <Svg size={26}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </Svg>
    ),
  },
  {
    title: "Actionable Feedback",
    desc: "Understand what you did well, what is missing and what you should improve next.",
    icon: (
      <Svg size={26}>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </Svg>
    ),
  },
];

const steps = [
  { n: "01", title: "Choose your role", desc: "Pick a role and your experience level to get matching questions." },
  { n: "02", title: "Practice out loud", desc: "The AI asks, you answer by voice or text, one question at a time." },
  { n: "03", title: "Improve with feedback", desc: "Get a score, strengths, weak areas and missing concepts." },
];

function LandingPage({
  roles,
  user,
  onProfile,
  onLogout,
  onLogin,
  onGetStarted,
  onStartInterview,
  onStartVideo,
  onSelectRole,
}) {
  // scroll-reveal animation
  useEffect(() => {
    const items = document.querySelectorAll(".lp-reveal");

    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("lp-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lp">
      {/* ================= NAVBAR ================= */}
      <div className="lp-nav-wrap">
        <div className="lp-nav">
          <a className="lp-brand" href="#top">
            <span className="lp-logo">AI</span>
            <span className="lp-brand-text">
              Interview<span>AI</span>
            </span>
          </a>

          <nav className="lp-links">
            <a className="lp-active" href="#top">Home</a>
            <a href="#roles">Interview Roles</a>
            <a href="#features">Features</a>
            <a href="#about">How It Works</a>
          </nav>

          <div className="lp-nav-actions">
            {user ? (
              <ProfileMenu user={user} onProfile={onProfile} onLogout={onLogout} />
            ) : (
              <button className="lp-login" onClick={onLogin}>
                Login
              </button>
            )}
            <button className="lp-btn lp-btn-primary lp-btn-sm" onClick={onGetStarted}>
              Get Started
            </button>
          </div>
        </div>
      </div>

      {/* ================= HERO ================= */}
      <div className="lp-hero" id="top">
        <div className="lp-hero-glow lp-glow-a" />
        <div className="lp-hero-glow lp-glow-b" />

        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <div className="lp-pill lp-fade" style={{ "--d": "0ms" }}>
              <span>✦</span> AI-POWERED INTERVIEW PLATFORM
            </div>

            <h1 className="lp-title lp-fade" style={{ "--d": "100ms" }}>
              Practice. <span>Perform.</span>
            </h1>

            <p className="lp-sub lp-fade" style={{ "--d": "200ms" }}>
              Get ready for your dream job with AI-powered mock interviews.
              Practice anytime, get instant feedback, and improve faster.
            </p>

            <div className="lp-cta-row lp-fade" style={{ "--d": "300ms" }}>
              <button className="lp-btn lp-btn-primary" onClick={onStartInterview}>
                <Svg size={18}>
                  <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
                </Svg>
                Start Interview
                <Arrow />
              </button>

              <button className="lp-btn lp-btn-outline" onClick={onStartVideo}>
                <Svg size={20}>
                  <rect x="2" y="6" width="14" height="12" rx="3" />
                  <polygon points="22 8 16 12 22 16 22 8" />
                </Svg>
                Start Video Interview
                <Arrow />
              </button>
            </div>

            <div className="lp-checks lp-fade" style={{ "--d": "400ms" }}>
              <span><Check /> No pressure</span>
              <span><Check /> Voice + text answers</span>
              <span><Check /> AI feedback</span>
            </div>
          </div>

          <div className="lp-hero-visual lp-fade" style={{ "--d": "250ms" }}>
            <img
              className="lp-avatar-img"
              src={avatarImg}
              alt="AI interviewer saying hi"
              draggable="false"
            />
          </div>
        </div>
      </div>

      {/* ================= ROLES ================= */}
      <div className="lp-section" id="roles">
        <div className="lp-head lp-reveal">
          <span className="lp-kicker">INTERVIEW ROLES</span>
          <h2>
            Choose <span>Your Path</span>
          </h2>
          <p>Select from a variety of roles and levels to get personalized interview questions.</p>
        </div>

        <div className="lp-roles">
          {roles.map((item, i) => (
            <button
              key={item.title}
              className="lp-role lp-reveal"
              style={{ "--d": `${i * 70}ms` }}
              onClick={() => onSelectRole(item.title)}
            >
              <span className="lp-role-icon">
                <RoleIcon title={item.title} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
              <span className="lp-role-go">
                Start practicing <Arrow />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ================= FEATURES ================= */}
      <div className="lp-section" id="features">
        <div className="lp-head lp-reveal">
          <span className="lp-kicker">BUILT FOR PRACTICE</span>
          <h2>
            Everything <span>You Need</span>
          </h2>
          <p>Simple tools that make interview practice feel real.</p>
        </div>

        <div className="lp-features">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="lp-feature lp-reveal"
              style={{ "--d": `${i * 80}ms` }}
            >
              <span className="lp-feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ================= HOW IT WORKS ================= */}
      <div className="lp-section" id="about">
        <div className="lp-head lp-reveal">
          <span className="lp-kicker">HOW IT WORKS</span>
          <h2>
            Ready in <span>3 Steps</span>
          </h2>
          <p>Practice at your own pace, one question at a time.</p>
        </div>

        <div className="lp-steps">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className="lp-step lp-reveal"
              style={{ "--d": `${i * 100}ms` }}
            >
              <span className="lp-step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ================= CTA ================= */}
      <div className="lp-section lp-section-tight">
        <div className="lp-final lp-reveal">
          <span className="lp-kicker">READY?</span>
          <h2>
            Your next interview <span>starts here.</span>
          </h2>
          <p>Practice today. Walk into your real interview prepared.</p>
          <button className="lp-btn lp-btn-primary" onClick={onGetStarted}>
            Start Practicing <Arrow />
          </button>
        </div>
      </div>

      {/* ================= FOOTER ================= */}
      <div className="lp-footer">
        <span>© 2026 InterviewAI</span>
        <span>AI-powered interview practice</span>
      </div>
    </div>
  );
}

export default LandingPage;