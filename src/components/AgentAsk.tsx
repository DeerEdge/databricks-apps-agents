"use client";

import { useEffect, useRef, useState } from "react";
import { trustClass } from "@/lib/meddesert";
import AgentChart from "./AgentChart";
import {
  createChat,
  getChat,
  addMessageToChat,
  setConversationId,
  setCurrentChatId,
  getCurrentChatId,
  type Chat,
  type Message,
} from "@/lib/chatStorage";

const SUGGESTIONS = [
  "Worst ICU gaps in India?",
  "Maternity gaps in Bihar",
  "Which trauma regions are data-poor?",
  "Show ICU hospitals in Kerala",
];

// Render text with **bold** spans without dangerouslySetInnerHTML
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
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [conversationId, setConvId] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<{ [key: string]: boolean }>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize chat on mount
  useEffect(() => {
    const chatId = getCurrentChatId();
    let chat: Chat | null = null;
    if (chatId) {
      chat = getChat(chatId);
    }
    if (!chat) {
      chat = createChat();
      setCurrentChatId(chat.id);
    }
    setCurrentChat(chat);
    setConvId(chat.conversationId);
  }, []);

  async function ask(question: string, continueThread = false) {
    const text = question.trim();
    if (!text || loading || !currentChat) return;

    const threadId = continueThread ? conversationId : null;
    setFollowUp(continueThread && Boolean(threadId));
    setLoading(true);
    setErr(null);
    setSteps([]);
    setShown(0);
    setQ("");

    // Add user message to chat history
    const userMessage: Message = {
      id: Math.random().toString(36).substring(2, 11),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessageToChat(currentChat.id, userMessage);
    setCurrentChat((prev) => (prev ? { ...prev, messages: [...prev.messages, userMessage] } : null));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, conversationId: threadId ?? undefined }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "agent failed");

      setSteps(j.steps);
      j.steps.forEach((_: string, i: number) => setTimeout(() => setShown(i + 1), i * 320));

      setTimeout(() => {
        setConvId(j.conversationId ?? null);

        // Add agent message to chat history — this is the single source of truth for rendering
        const agentMessage: Message = {
          id: Math.random().toString(36).substring(2, 11),
          role: "agent",
          content: j.answer,
          timestamp: new Date().toISOString(),
          citations: j.citations ?? [],
          chart: j.chart ?? null,
          steps: j.steps,
        };
        addMessageToChat(currentChat!.id, agentMessage);
        if (j.conversationId) {
          setConversationId(currentChat!.id, j.conversationId);
        }
        setCurrentChat((prev) => (prev ? { ...prev, messages: [...prev.messages, agentMessage] } : null));

        // Clear live reasoning now that the message holds it
        setSteps([]);
        setShown(0);
        setLoading(false);

        onResult(j.parsed.capability, j.focusState ?? null);
      }, j.steps.length * 320 + 120);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "agent failed");
      setLoading(false);
    }
  }

  function continueConversation() {
    setFollowUp(true);
    inputRef.current?.focus();
  }

  const hasMessages = Boolean(currentChat && currentChat.messages.length > 0);
  const started = loading || err !== null || hasMessages;
  // The last agent message gets the "continue" affordance under it
  const lastAgentId = currentChat?.messages.filter((m) => m.role === "agent").slice(-1)[0]?.id ?? null;

  return (
    <section className="agent">
      <div className="agent__scroll">
        {!started ? (
          <div className="agent__empty">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/databricks.png" alt="Databricks" className="agent__logo" />
            <p className="agent__hint">Ask the planner anything — or start with one of these:</p>
            <div className="ask__chips ask__chips--empty">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ask__chip" disabled={loading} onClick={() => { setQ(s); ask(s, false); }}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {currentChat && currentChat.messages.map((msg: any) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} style={{ display: "flex", justifyContent: "flex-end", padding: "0 12px", marginTop: "12px" }}>
                    <div style={{ maxWidth: "80%", padding: "9px 12px", borderRadius: "10px", background: "var(--accent)", color: "#f4f8fb", fontSize: "13px", lineHeight: "1.5", wordWrap: "break-word" }}>
                      {String(msg.content)}
                    </div>
                  </div>
                );
              }
              // agent message — collapsed reasoning by default, expandable dropdown at the top
              const isOpen = expandedSteps[msg.id] === true;
              return (
                <div key={msg.id} style={{ marginTop: "12px" }}>
                  {msg.steps && msg.steps.length > 0 && (
                    <div className="ask__steps" style={{ marginBottom: "12px" }}>
                      <button
                        type="button"
                        className="ask__steps-toggle"
                        onClick={() => setExpandedSteps((prev) => ({ ...prev, [msg.id]: !isOpen }))}
                      >
                        <span className={`ask__steps-caret${isOpen ? " ask__steps-caret--open" : ""}`}>▶</span>
                        Reasoning
                      </button>
                      <div className={`ask__steps-collapse${isOpen ? " ask__steps-collapse--open" : ""}`}>
                        <div>
                          <ol className="ask__steps-list">
                            {msg.steps.map((s: string, i: number) => (
                              <li key={i} className="ask__step"><Rich text={s} /></li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="ask__answer">
                    {typeof msg.content === "string" && (
                      <p className="ask__text"><Rich text={msg.content} /></p>
                    )}
                    <AgentChart spec={msg.chart} />
                    {msg.citations && msg.citations.length > 0 && (
                      <ul className="ask__cites">
                        {msg.citations.map((c: any, i: number) => (
                          <li key={i} className="ask__cite">
                            <div className="ask__cite-top">
                              <span className="ask__cite-name">{c.name || "Facility"}</span>
                              <span className={`trust ${trustClass(c.trust)}`}>{c.trust}</span>
                            </div>
                            <blockquote className="fac__cite">"{c.citation}"</blockquote>
                          </li>
                        ))}
                      </ul>
                    )}
                    {msg.id === lastAgentId && !loading && conversationId && !followUp && (
                      <button type="button" className="ask__continue" onClick={continueConversation}>
                        ↳ Continue this conversation
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* live reasoning while the agent is thinking — fully expanded, dropping in step by step */}
            {loading && steps.length > 0 && (
              <div className="ask__steps" style={{ marginTop: "12px" }}>
                <div className="ask__steps-head">Reasoning</div>
                <ol className="ask__steps-list">
                  {steps.slice(0, shown).map((s, i) => (
                    <li key={i} className="ask__step"><Rich text={s} /></li>
                  ))}
                  {shown < steps.length && <li className="ask__step ask__step--pending">running…</li>}
                </ol>
              </div>
            )}

            {loading && steps.length === 0 && (
              <div className="ask__typing">
                <div className="ask__typing-bubble">
                  <div className="ask__typing-dot" />
                  <div className="ask__typing-dot" />
                  <div className="ask__typing-dot" />
                </div>
              </div>
            )}

            {err && <p className="save__err">{err}</p>}
          </>
        )}
      </div>

      {followUp && conversationId && (
        <div className="ask__followup">
          <span className="ask__followup-dot" />
          Following up — the agent remembers this thread
          <button type="button" className="ask__followup-new" onClick={() => setFollowUp(false)}>New topic</button>
        </div>
      )}
      <form className="ask__form agent__bar" onSubmit={(e) => { e.preventDefault(); ask(q, followUp); }}>
        <input ref={inputRef} className="ask__input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={followUp ? "Ask a follow-up question…" : "Where are the worst ICU gaps?"}
          maxLength={500} aria-label="Ask the planner agent" />
        <button className="ask__send" disabled={loading || !q.trim()} aria-label="Ask">
          {loading ? <span className="ask__spin" /> : "→"}
        </button>
      </form>
    </section>
  );
}
