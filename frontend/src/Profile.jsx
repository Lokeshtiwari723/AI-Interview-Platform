import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./profile.css";

/*
  Profile.jsx  (everything about the user profile in ONE file)

    1. history helpers  - read / delete the saved interviews in Supabase
    2. ProfileMenu      - the round profile icon (top right) + its dropdown
    3. ProfilePage      - the full profile page with the whole history
*/

/* ============================================================
   1. HISTORY HELPERS (Supabase table "interviews")
   ============================================================ */

/* Everything that reads or deletes a user's saved interviews. */

function friendlyError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();

  if (text.includes("42p01") || text.includes("does not exist") || text.includes("schema cache")) {
    return "The history table is missing. Run supabase_setup.sql in the Supabase SQL Editor.";
  }

  return "Could not load your history. Please try again.";
}

// list of the user's interviews, newest first (light columns only)
async function fetchHistory() {
  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, role, level, language, mode, overall_score, performance, total_questions, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("History error:", error);
    return { rows: [], error: friendlyError(error) };
  }

  return { rows: data || [], error: "" };
}

// the full report of one interview
async function fetchReport(id) {
  const { data, error } = await supabase
    .from("interviews")
    .select("results")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Report error:", error);
    return null;
  }

  return data.results;
}

async function deleteInterview(id) {
  const { error } = await supabase.from("interviews").delete().eq("id", id);

  if (error) {
    console.error("Delete error:", error);
    return false;
  }

  return true;
}

// numbers shown on the profile
function summarize(rows) {
  if (!rows.length) {
    return { count: 0, average: 0, best: 0, last: null };
  }

  const scores = rows.map((row) => Number(row.overall_score) || 0);
  const total = scores.reduce((sum, value) => sum + value, 0);

  return {
    count: rows.length,
    average: Math.round((total / rows.length) * 10) / 10,
    best: Math.max(...scores),
    last: rows[0].created_at,
  };
}

function scoreTone(score) {
  const value = Number(score) || 0;

  if (value >= 8) return "great";
  if (value >= 6) return "good";
  if (value >= 4) return "ok";
  return "low";
}

function formatDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ============================================================
   2. PROFILE ICON + DROPDOWN
   ============================================================ */

function initialOf(user) {
  const text = (user?.name || user?.email || "?").trim();
  return text.charAt(0).toUpperCase();
}

/*
  The round profile icon (top right corner).
  Click it -> name, email, quick numbers and the last interviews.
*/
export function ProfileMenu({ user, onProfile, onLogout }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null); // null = still loading
  const boxRef = useRef(null);

  // close with a click outside or the Escape key
  useEffect(() => {
    if (!open) return undefined;

    const closeOutside = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const closeEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);

    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  // load the short summary every time the menu opens
  useEffect(() => {
    if (!open) return undefined;

    let alive = true;

    fetchHistory().then(({ rows: list }) => {
      if (alive) setRows(list);
    });

    return () => {
      alive = false;
    };
  }, [open]);

  const toggle = () => {
    if (!open) setRows(null);
    setOpen(!open);
  };

  const stats = rows ? summarize(rows) : null;
  const recent = rows ? rows.slice(0, 3) : [];

  return (
    <div className="pm" ref={boxRef}>
      <button
        type="button"
        className="pm-avatar"
        onClick={toggle}
        aria-label="Open profile menu"
        aria-expanded={open}
        title={user.name}
      >
        {initialOf(user)}
      </button>

      {open && (
        <div className="pm-panel" role="menu">
          <div className="pm-head">
            <span className="pm-avatar pm-avatar-lg">{initialOf(user)}</span>

            <div className="pm-who">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
          </div>

          <div className="pm-stats">
            <div>
              <b>{stats ? stats.count : "..."}</b>
              <span>Interviews</span>
            </div>
            <div>
              <b>{stats ? stats.average : "..."}</b>
              <span>Avg score</span>
            </div>
            <div>
              <b>{stats ? stats.best : "..."}</b>
              <span>Best</span>
            </div>
          </div>

          <div className="pm-recent">
            <span className="pm-label">RECENT INTERVIEWS</span>

            {rows === null && <p className="pm-empty">Loading...</p>}

            {rows !== null && recent.length === 0 && (
              <p className="pm-empty">No interviews yet. Finish one and it will show here.</p>
            )}

            {recent.map((row) => (
              <div className="pm-row" key={row.id}>
                <div>
                  <b>{row.role}</b>
                  <small>
                    {row.level} · {formatDate(row.created_at)}
                  </small>
                </div>

                <span className={`pm-score is-${scoreTone(row.overall_score)}`}>
                  {Number(row.overall_score)}/10
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="pm-item pm-main"
            onClick={() => {
              setOpen(false);
              onProfile();
            }}
          >
            View full profile &amp; history
          </button>

          <button
            type="button"
            className="pm-item pm-danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   3. FULL PROFILE PAGE
   ============================================================ */

/*
  Full profile page: name, email, numbers, a small score chart and the
  whole interview history (open a report again, or delete it).
*/
export default function ProfilePage({
  user,
  onBack,
  onStart,
  onLogout,
  onOpenReport,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const result = await fetchHistory();

    setRows(result.rows);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => summarize(rows), [rows]);

  // last 10 scores, oldest first, for the small chart
  const chartRows = useMemo(() => rows.slice(0, 10).reverse(), [rows]);

  const openReport = async (row) => {
    setBusyId(row.id);
    setError("");

    const report = await fetchReport(row.id);

    setBusyId("");

    if (!report) {
      setError("Could not open this report.");
      return;
    }

    onOpenReport(row, report);
  };

  const removeRow = async (row) => {
    const sure = window.confirm("Delete this interview from your history?");
    if (!sure) return;

    setBusyId(row.id);

    const done = await deleteInterview(row.id);

    setBusyId("");

    if (done) {
      setRows((list) => list.filter((item) => item.id !== row.id));
    } else {
      setError("Could not delete this interview.");
    }
  };

  return (
    <div className="pf">
      <header className="pf-top">
        <div className="pf-brand">
          <span className="pf-logo">AI</span>
          <span className="pf-brand-text">
            Interview<span>AI</span>
          </span>
        </div>

        <div className="pf-top-actions">
          <button type="button" className="pf-btn" onClick={onBack}>
            ← Home
          </button>
          <button type="button" className="pf-btn pf-btn-danger" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="pf-main">
        {/* ---- who you are ---- */}
        <section className="pf-card pf-user">
          <span className="pm-avatar pm-avatar-xl">{initialOf(user)}</span>

          <div className="pf-user-text">
            <h1>{user.name}</h1>
            <p>{user.email}</p>
            {user.createdAt && (
              <small>Member since {formatDate(user.createdAt)}</small>
            )}
          </div>

          <button type="button" className="pf-btn pf-btn-main" onClick={onStart}>
            Start a new interview →
          </button>
        </section>

        {/* ---- numbers ---- */}
        <section className="pf-stats">
          <div className="pf-card">
            <span>Interviews</span>
            <b>{stats.count}</b>
          </div>
          <div className="pf-card">
            <span>Average score</span>
            <b>
              {stats.average}
              <i>/10</i>
            </b>
          </div>
          <div className="pf-card">
            <span>Best score</span>
            <b>
              {stats.best}
              <i>/10</i>
            </b>
          </div>
          <div className="pf-card">
            <span>Last interview</span>
            <b className="pf-small">{stats.last ? formatDate(stats.last) : "-"}</b>
          </div>
        </section>

        {error && <p className="pf-error">{error}</p>}

        {/* ---- chart ---- */}
        {chartRows.length > 1 && (
          <section className="pf-card">
            <span className="pf-title">RECENT SCORES</span>

            <div className="pf-chart">
              {chartRows.map((row) => (
                <div
                  className="pf-bar"
                  key={row.id}
                  title={`${row.role} · ${formatDate(row.created_at)} · ${Number(row.overall_score)}/10`}
                >
                  <em>{Number(row.overall_score)}</em>
                  <i
                    className={`is-${scoreTone(row.overall_score)}`}
                    style={{ height: `${Math.max(6, Number(row.overall_score) * 10)}%` }}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- history ---- */}
        <section className="pf-card">
          <span className="pf-title">INTERVIEW HISTORY</span>

          {loading && <p className="pf-empty">Loading your history...</p>}

          {!loading && !error && rows.length === 0 && (
            <p className="pf-empty">
              No interviews saved yet. Finish an interview while you are logged
              in and it will appear here.
            </p>
          )}

          <div className="pf-list">
            {rows.map((row) => (
              <div className="pf-item" key={row.id}>
                <div className="pf-item-main">
                  <b>
                    {row.role}
                    {row.language ? ` · ${row.language}` : ""}
                  </b>

                  <div className="pf-tags">
                    <span>{row.level}</span>
                    <span>{row.mode === "video" ? "Video" : "Standard"}</span>
                    <span>{row.total_questions} questions</span>
                    <span>{formatDate(row.created_at)}</span>
                  </div>
                </div>

                <div className="pf-item-score">
                  <span className={`pm-score is-${scoreTone(row.overall_score)}`}>
                    {Number(row.overall_score)}/10
                  </span>
                  <small>{row.performance}</small>
                </div>

                <div className="pf-item-actions">
                  <button
                    type="button"
                    className="pf-btn"
                    onClick={() => openReport(row)}
                    disabled={busyId === row.id}
                  >
                    {busyId === row.id ? "..." : "View report"}
                  </button>

                  <button
                    type="button"
                    className="pf-btn pf-btn-danger"
                    onClick={() => removeRow(row)}
                    disabled={busyId === row.id}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}