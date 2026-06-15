"use client";

import { useState } from "react";
import { trustClass } from "@/lib/meddesert";

const SUGGESTIONS = [
  "Worst ICU gaps in India?",
  "Maternity gaps in Bihar",
  "Which trauma regions are data-poor?",
  "Show ICU hospitals in Kerala",
];

interface Citation { name: string; trust: string; citation: string }
interface Meta { ms: number; rows: number; source: string; engine: string }

// Render text with **bold** spans without dangerouslySetInnerHTML (content is server-generated,
// but React text nodes keep it injection-safe regardless).
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((seg, i) => (i % 2 ? <strong key={i}>{seg}</strong> : <span key={i}>{seg}</span>))}
    </>
  );
}

export default function AgentAsk({ onResult }: { onResult: (capability: string, state: string | null) => void }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || loading) return;
    setLoading(true);
    setErr(null);
    setAnswer(null);
    setCitations([]);
    setMeta(null);
    setSteps([]);
    setShown(0);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "agent failed");
      // Stagger the reasoning steps so the user sees the agent "think".
      setSteps(j.steps);
      j.steps.forEach((_: string, i: number) => setTimeout(() => setShown(i + 1), i * 320));
      setTimeout(() => {
        setAnswer(j.answer);
        setCitations(j.citations ?? []);
        setMeta(j.meta ?? null);
        onResult(j.parsed.capability, j.focusState ?? null);
      }, j.steps.length * 320 + 120);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "agent failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel agent">
      <div className="panel__head">
        <div className="panel__eyebrow">Mosaic-style agent</div>
        <h2 className="panel__title">Ask the planner agent</h2>
      </div>
      <div className="panel__body">
        <form className="agent__form" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input className="agent__input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. where are the worst ICU gaps?" maxLength={500} />
          <button className="btn btn--primary" disabled={loading}>{loading ? "…" : "Ask"}</button>
        </form>
        <div className="agent__chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" disabled={loading} onClick={() => { setQ(s); ask(s); }}>{s}</button>
          ))}
        </div>

        {steps.length > 0 && (
          <ol className="agent__steps">
            {steps.slice(0, shown).map((s, i) => (
              <li key={i} className="agent__step"><Rich text={s} /></li>
            ))}
            {shown < steps.length && <li className="agent__step agent__step--pending">▍ running…</li>}
          </ol>
        )}

        {answer && (
          <div className="agent__answer">
            <p className="agent__text"><Rich text={answer} /></p>
            {citations.length > 0 && (
              <ul className="agent__cites">
                {citations.map((c, i) => (
                  <li key={i} className="agent__cite">
                    <div className="agent__cite-top">
                      <span className="agent__cite-name">{c.name || "Facility"}</span>
                      <span className={`trust ${trustClass(c.trust)}`}>{c.trust}</span>
                    </div>
                    <blockquote className="fac__cite">“{c.citation}”</blockquote>
                  </li>
                ))}
              </ul>
            )}
            {meta && <div className="obs"><span className="obs__dot" /> {meta.engine} · {meta.rows} regions · {meta.ms}ms</div>}
          </div>
        )}
        {err && <p className="save__err">{err}</p>}
      </div>
    </section>
  );
}
