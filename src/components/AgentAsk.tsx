"use client";

import { useRef, useState } from "react";
import { trustClass } from "@/lib/meddesert";
import type { ChartSpec } from "@/lib/chartSpec";
import AgentChart from "./AgentChart";

const SUGGESTIONS = [
  "Worst ICU gaps in India?",
  "Maternity gaps in Bihar",
  "Which trauma regions are data-poor?",
  "Show ICU hospitals in Kerala",
];

interface Citation { name: string; trust: string; citation: string }

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
  const [chart, setChart] = useState<ChartSpec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Genie conversations are stateful: keep the id so the user can continue the same thread.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(question: string, continueThread = false) {
    const text = question.trim();
    if (!text || loading) return;
    const threadId = continueThread ? conversationId : null; // continue the same Genie conversation
    setFollowUp(continueThread && Boolean(threadId));
    setLoading(true);
    setErr(null);
    setAnswer(null);
    setCitations([]);
    setChart(null);
    setSteps([]);
    setShown(0);
    setQ("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, conversationId: threadId ?? undefined }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "agent failed");
      // Stagger the reasoning steps so the user sees the agent "think".
      setSteps(j.steps);
      j.steps.forEach((_: string, i: number) => setTimeout(() => setShown(i + 1), i * 320));
      setTimeout(() => {
        setAnswer(j.answer);
        setCitations(j.citations ?? []);
        setChart(j.chart ?? null);
        setConversationId(j.conversationId ?? null);
        onResult(j.parsed.capability, j.focusState ?? null);
      }, j.steps.length * 320 + 120);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "agent failed");
    } finally {
      setLoading(false);
    }
  }

  function continueConversation() {
    setFollowUp(true);
    inputRef.current?.focus();
  }

  return (
    <section className="panel agent">
      <div className="panel__head">
        <div className="panel__eyebrow">AI planner agent</div>
        <h2 className="panel__title">Ask in plain English</h2>
      </div>
      <div className="panel__body">
        {followUp && conversationId && (
          <div className="ask__followup">
            <span className="ask__followup-dot" />
            Following up — the agent remembers this thread
            <button type="button" className="ask__followup-new" onClick={() => setFollowUp(false)}>New topic</button>
          </div>
        )}
        <form className="ask__form" onSubmit={(e) => { e.preventDefault(); ask(q, followUp); }}>
          <input ref={inputRef} className="ask__input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={followUp ? "Ask a follow-up question…" : "Where are the worst ICU gaps?"}
            maxLength={500} aria-label="Ask the planner agent" />
          <button className="ask__send" disabled={loading || !q.trim()} aria-label="Ask">
            {loading ? <span className="ask__spin" /> : "→"}
          </button>
        </form>
        <div className="ask__chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="ask__chip" disabled={loading} onClick={() => { setQ(s); ask(s, false); }}>{s}</button>
          ))}
        </div>

        {steps.length > 0 && (
          <div className="ask__steps">
            <div className="ask__steps-head">Reasoning</div>
            <ol className="ask__steps-list">
              {steps.slice(0, shown).map((s, i) => (
                <li key={i} className="ask__step"><Rich text={s} /></li>
              ))}
              {shown < steps.length && <li className="ask__step ask__step--pending">running…</li>}
            </ol>
          </div>
        )}

        {answer && (
          <div className="ask__answer">
            <p className="ask__text"><Rich text={answer} /></p>
            <AgentChart spec={chart} />
            {citations.length > 0 && (
              <ul className="ask__cites">
                {citations.map((c, i) => (
                  <li key={i} className="ask__cite">
                    <div className="ask__cite-top">
                      <span className="ask__cite-name">{c.name || "Facility"}</span>
                      <span className={`trust ${trustClass(c.trust)}`}>{c.trust}</span>
                    </div>
                    <blockquote className="fac__cite">“{c.citation}”</blockquote>
                  </li>
                ))}
              </ul>
            )}
            {conversationId && !followUp && (
              <button type="button" className="ask__continue" onClick={continueConversation}>
                ↳ Continue this conversation
              </button>
            )}
          </div>
        )}
        {err && <p className="save__err">{err}</p>}
      </div>
    </section>
  );
}
