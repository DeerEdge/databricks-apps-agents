"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "maplibre-gl/dist/maplibre-gl.css";
import { trustClass } from "@/lib/meddesert";
import type { ReferralCandidate, SavedShortlistItem } from "@/lib/referral";

function matchLabel(trust: string): string {
  return { strong: "Strong match", partial: "Partial match", weak: "Weak match", none: "No match" }[trust] ?? "Weak match";
}

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const SUGGESTIONS = [
  "Dialysis near Jaipur",
  "Emergency surgery near Patna",
  "NICU in Kerala",
  "Oncology near Mumbai",
  "Trauma center near Lucknow",
];

const SUGGESTION_CARDS = [
  { query: "Dialysis near Jaipur",          desc: "Nephrology & renal care in Rajasthan" },
  { query: "Emergency surgery near Patna",  desc: "Trauma & emergency centers in Bihar" },
  { query: "NICU in Kerala",                desc: "Neonatal intensive care facilities" },
  { query: "Oncology near Mumbai",          desc: "Cancer treatment centers in Maharashtra" },
];

const LOADING_MESSAGES = [
  "Searching cited facility evidence",
  "Resolving location coordinates",
  "Scanning facility records",
  "Checking evidence quality",
  "Ranking by trust and distance",
  "Looking up nearby facilities",
  "Matching care need to specialties",
];

function useTypewriter(phrases: string[], typingMs = 60, pauseMs = 1500, deletingMs = 35) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!active) return;
    let idx = 0;
    let charIdx = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      const phrase = phrases[idx];
      if (!deleting) {
        charIdx++;
        setText(phrase.slice(0, charIdx));
        if (charIdx >= phrase.length) {
          timer = setTimeout(() => { deleting = true; tick(); }, pauseMs);
          return;
        }
        timer = setTimeout(tick, typingMs);
      } else {
        charIdx--;
        setText(phrase.slice(0, charIdx));
        if (charIdx <= 0) {
          deleting = false;
          idx = (idx + 1) % phrases.length;
          timer = setTimeout(tick, 300);
          return;
        }
        timer = setTimeout(tick, deletingMs);
      }
    }
    tick();
    return () => clearTimeout(timer);
  }, [active, phrases, typingMs, pauseMs, deletingMs]);

  return { text, stop: () => setActive(false) };
}

interface QueryMeta {
  ms: number;
  rows: number;
  source: string;
  engine: string;
}

interface Message {
  role: "user" | "maya";
  content: string;
  reasoningSteps?: string[];
  candidates?: ReferralCandidate[];
  meta?: QueryMeta | null;
  queryContext?: string;
  timestamp: number;
}

function snippet(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean;
}

function topEvidenceLines(candidate: ReferralCandidate, max = 2): string[] {
  const lines: string[] = [];
  const fe = candidate.fieldEvidence;
  if (!fe) return lines;
  if (fe.specialties) lines.push(`Specialty: ${fe.specialties}`);
  if (fe.procedures && lines.length < max) lines.push(`Procedure: ${fe.procedures}`);
  if (fe.equipment && lines.length < max) lines.push(`Equipment: ${fe.equipment}`);
  return lines.map((l) => snippet(l, 80));
}

function MiniFacilityMap({ candidate }: { candidate: ReferralCandidate }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const center: [number, number] = [candidate.lon, candidate.lat];

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled) return;

      if (!mapRef.current) {
        const map = new maplibregl.Map({
          container,
          style: STYLE,
          center,
          zoom: 12,
          interactive: false,
          attributionControl: false,
        });
        mapRef.current = map;
        markerRef.current = new maplibregl.Marker({ color: "#1e6091" }).setLngLat(center).addTo(map);
        map.on("load", () => map.resize());
      } else {
        mapRef.current.jumpTo({ center, zoom: 12 });
        markerRef.current?.setLngLat(center);
        mapRef.current.resize();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [candidate.facilityId, candidate.lat, candidate.lon]);

  useEffect(() => {
    return () => {
      markerRef.current?.remove();
      mapRef.current?.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  return <div className="ref__map" ref={containerRef} aria-label={`Map centered on ${candidate.name}`} />;
}

export default function MayaCopilot() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<ReferralCandidate | null>(null);
  const [selectedQueryContext, setSelectedQueryContext] = useState("");
  const [shortlist, setShortlist] = useState<SavedShortlistItem[]>([]);
  const [shownSteps, setShownSteps] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const loadingIdxRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const selectedSaved = selectedCandidate
    ? shortlist.some((item) => item.facilityId === selectedCandidate.facilityId)
    : false;

  async function loadShortlist() {
    try {
      const res = await fetch("/api/shortlist");
      const j = await res.json();
      const items = j.ok ? j.items : [];
      setShortlist(items);
      window.dispatchEvent(new CustomEvent("maya-shortlist-updated", { detail: { count: items.length } }));
    } catch {
      setShortlist([]);
    }
  }

  useEffect(() => {
    loadShortlist();
  }, []);


  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, shownSteps, loading]);

  // Rotate loading message every 3 dot-animation cycles (3 × 1.4s = 4.2s)
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      loadingIdxRef.current = (loadingIdxRef.current + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[loadingIdxRef.current]);
    }, 4200);
    return () => clearInterval(interval);
  }, [loading]);

  function animateSteps(timestamp: number, steps: string[]) {
    setShownSteps((prev) => ({ ...prev, [timestamp]: 0 }));
    const timers = steps.map((_, i) =>
      setTimeout(() => {
        setShownSteps((prev) => ({ ...prev, [timestamp]: i + 1 }));
      }, i * 320)
    );
    return () => timers.forEach(clearTimeout);
  }

  async function askMaya(question: string) {
    const text = question.trim();
    if (!text || loading) return;

    const userMessage: Message = { role: "user", content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);
    setSaveError(null);
    const startIdx = Math.floor(Math.random() * LOADING_MESSAGES.length);
    loadingIdxRef.current = startIdx;
    setLoadingMsg(LOADING_MESSAGES[startIdx]);

    try {
      const history = messages.slice(-20).map((m) => ({
        role: m.role === "maya" ? "assistant" : "user",
        content: m.content,
      }));
      const res = await fetch("/api/referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, history }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "Maya failed");

      const timestamp = Date.now() + 1;
      const reasoningSteps = Array.isArray(j.reasoningSteps) ? j.reasoningSteps.map(String) : [];
      const mayaMessage: Message = {
        role: "maya",
        content: String(j.answer ?? ""),
        reasoningSteps,
        candidates: Array.isArray(j.candidates) ? j.candidates : [],
        meta: j.meta ?? null,
        queryContext: text,
        timestamp,
      };
      setMessages((prev) => [...prev, mayaMessage]);
      animateSteps(timestamp, reasoningSteps);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Something went wrong with my search. Please try again.";
      setError(errMsg);
      setMessages((prev) => [
        ...prev,
        {
          role: "maya",
          content: errMsg,
          timestamp: Date.now() + 1,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected() {
    if (!selectedCandidate || selectedSaved || savingId) return;
    setSavingId(selectedCandidate.facilityId);
    setSaveError(null);
    try {
      const res = await fetch("/api/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: selectedCandidate.facilityId,
          name: selectedCandidate.name,
          city: selectedCandidate.city,
          state: selectedCandidate.state,
          lat: selectedCandidate.lat,
          lon: selectedCandidate.lon,
          distanceKm: selectedCandidate.distanceKm,
          trust: selectedCandidate.trust,
          citation: selectedCandidate.citation,
          queryContext: selectedQueryContext,
          note: "",
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "save failed");
      setShortlist((prev) => {
        const next = [j.item, ...prev];
        window.dispatchEvent(new CustomEvent("maya-shortlist-updated", { detail: { count: next.length } }));
        return next;
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteShortlistItem(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/shortlist?id=${id}`, { method: "DELETE" });
      const j = await res.json();
      if (j.ok) {
        setShortlist((prev) => {
          const next = prev.filter((item) => item.id !== id);
          window.dispatchEvent(new CustomEvent("maya-shortlist-updated", { detail: { count: next.length } }));
          return next;
        });
      }
    } catch {
      // silent — item stays in list
    } finally {
      setDeletingId(null);
    }
  }

  function selectCandidate(candidate: ReferralCandidate, queryContext = "") {
    setSelectedCandidate(candidate);
    setSelectedQueryContext(queryContext);
    setSaveError(null);
  }

  const { text: placeholder, stop: stopTypewriter } = useTypewriter(SUGGESTIONS);

  return (
    <main className={`ref__layout${selectedCandidate ? " ref__layout--panel" : ""}`}>
      {/* navigation header */}
      <div className="ref__peek-header">
        <div className="brand">
          <Link href="/" className="brand__name">MedIndia</Link>
          <div className="brand__div" />
          <nav className="brand__subnav">
            <Link href="/" className="brand__subnav-link">Home</Link>
            <span className="brand__subnav-link brand__subnav-link--active">Maya</span>
          </nav>
        </div>
        <button
          className="ref__sl-toggle"
          onClick={() => setShortlistOpen((v) => !v)}
          aria-label={shortlistOpen ? "Close shortlist" : "Open shortlist"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          {shortlist.length > 0 && <span className="ref__sl-badge">{shortlist.length}</span>}
        </button>
      </div>
      <div className="ref__body">
      <section className="ref__chat" aria-label="Maya referral chat">

        {/* ── HERO: initial empty state ───────────────────── */}
        {messages.length === 0 && (
          <div className="ref__hero">
            <h1 className="ref__hero-title">Maya</h1>
            <p className="ref__hero-sub">Your Hospital Referral Copilot</p>
            <form
              className="ref__hero-form"
              onSubmit={(e) => { e.preventDefault(); stopTypewriter(); askMaya(input); }}
            >
              <input
                className="ref__hero-input"
                value={input}
                onChange={(e) => { setInput(e.target.value); stopTypewriter(); }}
                placeholder={placeholder}
                maxLength={500}
                aria-label="Ask Maya for a referral"
              />
              <button className="ref__send" disabled={loading || !input.trim()} aria-label="Send">
                {loading ? <span className="ask__spin" /> : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
                )}
              </button>
            </form>

            {/* Suggestion cards */}
            <div className="ref__sug-grid">
              {SUGGESTION_CARDS.map((card) => (
                <button
                  key={card.query}
                  className="ref__sug-card"
                  onClick={() => { stopTypewriter(); askMaya(card.query); }}
                >
                  <span className="ref__sug-title">{card.query}</span>
                  <span className="ref__sug-desc">{card.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}


        {/* ── SHORTLIST DRAWER ───────────────────────────── */}
        {shortlistOpen && (
          <div className="ref__sl-drawer">
            <div className="ref__sl-header">
              <h3 className="ref__sl-title">Saved Referrals</h3>
              <button className="ref__sl-close" onClick={() => setShortlistOpen(false)} aria-label="Close shortlist">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
              </button>
            </div>
            {shortlist.length === 0 ? (
              <p className="ref__sl-empty">No saved referrals yet. Search for facilities and save them from the detail panel.</p>
            ) : (
              <ul className="ref__sl-list">
                {shortlist.map((item) => (
                  <li key={item.id} className="ref__sl-item">
                    <button
                      className="ref__sl-item-main"
                      onClick={() => {
                        selectCandidate({
                          facilityId: item.facilityId,
                          name: item.name,
                          city: item.city,
                          state: item.state,
                          lat: item.lat,
                          lon: item.lon,
                          distanceKm: item.distanceKm,
                          trust: item.trust as "strong" | "partial" | "weak",
                          citation: item.citation,
                          matchingEvidence: [],
                          missingEvidence: [],
                          explanation: "",
                        }, item.queryContext);
                        setShortlistOpen(false);
                      }}
                    >
                      <span className="ref__sl-item-top">
                        <span className="ref__sl-item-name">{item.name}</span>
                        <span className={`trust trust--sm ${trustClass(item.trust)}`}>{matchLabel(item.trust)}</span>
                      </span>
                      <span className="ref__sl-item-meta">
                        {item.distanceKm.toFixed(1)} km — {item.city || item.state}
                      </span>
                      {item.queryContext && (
                        <span className="ref__sl-item-query">Searched: {item.queryContext}</span>
                      )}
                    </button>
                    <button
                      className="ref__sl-delete"
                      onClick={() => deleteShortlistItem(item.id)}
                      disabled={deletingId === item.id}
                      aria-label={`Remove ${item.name} from shortlist`}
                    >
                      {deletingId === item.id ? (
                        <span className="ask__spin" />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── MESSAGES ────────────────────────────────────── */}
        <div className="ref__messages">
          {messages.length > 0 && (
            <article className="ref__msg ref__msg--maya">
              <div className="ref__avatar">M</div>
              <div className="ref__bubble">
                <p>How can I help you find the right facility?</p>
              </div>
            </article>
          )}

          {messages.map((message) => (
            <article key={message.timestamp} className={`ref__msg ref__msg--${message.role}`}>
              <div className="ref__avatar">{message.role === "maya" ? "M" : "You"}</div>
              <div className="ref__bubble">
                <p>{message.content}</p>

                {message.reasoningSteps && message.reasoningSteps.length > 0 && (
                  <div className="ask__steps ref__steps">
                    <div className="ask__steps-head">Reasoning</div>
                    <ol className="ask__steps-list">
                      {message.reasoningSteps
                        .slice(0, shownSteps[message.timestamp] ?? message.reasoningSteps.length)
                        .map((step, i) => (
                          <li key={i} className="ask__step">{step}</li>
                        ))}
                      {(shownSteps[message.timestamp] ?? message.reasoningSteps.length) < message.reasoningSteps.length && (
                        <li className="ask__step ask__step--pending">running...</li>
                      )}
                    </ol>
                  </div>
                )}

                {message.candidates && message.candidates.length > 0 && (
                  <div className="ref__cards" aria-label="Referral recommendations">
                    {message.candidates.map((candidate) => (
                      <button
                        key={candidate.facilityId}
                        className={`ref__card${selectedCandidate?.facilityId === candidate.facilityId ? " ref__card--active" : ""}`}
                        onClick={() => selectCandidate(candidate, message.queryContext)}
                      >
                        <span className="ref__card-top">
                          <span className="ref__card-name">{candidate.name}</span>
                          <span className={`trust ${trustClass(candidate.trust)}`}>{matchLabel(candidate.trust)}</span>
                        </span>
                        <span className="ref__card-meta">
                          {candidate.distanceKm.toFixed(1)} km — {candidate.city || candidate.state}
                        </span>
                        {topEvidenceLines(candidate).length > 0 ? (
                          <span className="ref__card-evidence">
                            {topEvidenceLines(candidate).map((line, j) => (
                              <span key={j} className="ref__card-ev-line">{line}</span>
                            ))}
                          </span>
                        ) : (
                          <span className="ref__card-cite">{snippet(candidate.citation || candidate.explanation)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}

          {loading && (
            <article className="ref__msg ref__msg--maya">
              <div className="ref__avatar">M</div>
              <div className="ref__bubble ref__bubble--loading">
                <span>{loadingMsg}</span>
                <span className="ref__dots" aria-hidden="true">
                  <span>.</span><span>.</span><span>.</span>
                </span>
              </div>
            </article>
          )}
          {error && <p className="save__err ref__error">{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* ── BOTTOM COMPOSER: shown during active chat ── */}
        {messages.length > 0 && (
          <div className="ref__composer">
            <form
              className="ref__hero-form"
              onSubmit={(e) => { e.preventDefault(); askMaya(input); }}
            >
              <input
                className="ref__hero-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Maya..."
                maxLength={500}
                aria-label="Ask Maya for a referral"
              />
              <button className="ref__send" disabled={loading || !input.trim()} aria-label="Send">
                {loading ? <span className="ask__spin" /> : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
                )}
              </button>
            </form>
          </div>
        )}
      </section>

      {selectedCandidate && (
        <aside className="ref__panel ref__panel--open" aria-label="Selected facility details">
          <button className="ref__close" onClick={() => setSelectedCandidate(null)} aria-label="Close facility panel">
            X
          </button>
          <MiniFacilityMap candidate={selectedCandidate} />

          <div className="ref__panel-head">
            <div className="panel__eyebrow">Selected recommendation</div>
            <div className="ref__title-row">
              <h2 className="panel__title">{selectedCandidate.name}</h2>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedCandidate.lat},${selectedCandidate.lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ref__directions"
                aria-label={`Get directions to ${selectedCandidate.name} on Google Maps`}
                title="Open in Google Maps"
              >
                <svg width="20" height="20" viewBox="0 0 92.3 132.3" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#1a73e8" d="M60.2 2.2C55.8.8 51 0 46.1 0 32 0 19.3 6.4 10.8 16.5l21.8 18.3L60.2 2.2z"/>
                  <path fill="#ea4335" d="M10.8 16.5C4.1 24.5 0 34.9 0 46.1c0 8.7 1.7 15.7 4.6 22l28-32.8L10.8 16.5z"/>
                  <path fill="#4285f4" d="M46.2 28.5c9.8 0 17.7 7.9 17.7 17.7 0 4.3-1.6 8.3-4.2 11.4 0 0 13.9-16.2 27.5-32.4-5.6-10.8-15.3-19-27-22.7L32.6 34.8c3.3-3.8 8.1-6.3 13.6-6.3z"/>
                  <path fill="#fbbc04" d="M46.2 63.8c-9.8 0-17.7-7.9-17.7-17.7 0-4.3 1.5-8.3 4.1-11.3l-28 32.8c4.8 10.6 12.8 19.2 21 29.9l34.1-39.9c-3.2 3.6-8 6.2-13.5 6.2z"/>
                  <path fill="#34a853" d="M59.1 109.2c15.4-24.1 33.3-35 33.3-63 0-7.7-1.9-14.9-5.2-21.3L25.6 97.5c2.8 4.7 5.8 9.7 8.4 15.1 5.9 12.4 12.2 19.7 12.2 19.7s6.1-7.1 12.9-23.1z"/>
                </svg>
              </a>
            </div>
            <p className="ref__loc">
              {selectedCandidate.city || selectedCandidate.state} - {selectedCandidate.distanceKm.toFixed(1)} km away
            </p>
          </div>

          <section className="ref__why">
            <div className="ref__why-header">
              <div className="ref__section-title">Why recommended</div>
              <span className={`trust ${trustClass(selectedCandidate.trust)}`}>{matchLabel(selectedCandidate.trust)}</span>
            </div>
            {selectedCandidate.rankReason && (
              <p className="ref__rank-reason">{selectedCandidate.rankReason}</p>
            )}
            {selectedCandidate.qualitativeAnalysis ? (
              <p className="ref__analysis">{selectedCandidate.qualitativeAnalysis}</p>
            ) : selectedCandidate.explanation ? (
              <p className="ref__explanation">{selectedCandidate.explanation}</p>
            ) : null}
          </section>

          {selectedCandidate.matchingEvidence.length > 0 && (
            <section className="ref__evidence-section">
              <div className="ref__section-title">Evidence found</div>
              <ul className="ref__evidence-list">
                {selectedCandidate.matchingEvidence.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </section>
          )}

          {(selectedCandidate.citation || selectedCandidate.fieldEvidence || selectedCandidate.externalSources) && (
            <section className="ref__citation-section">
              <div className="ref__section-title">Sources</div>

              {/* Internal Data */}
              {(selectedCandidate.citation || selectedCandidate.fieldEvidence) && (
                <div className="ref__src-group">
                  <div className="ref__src-group-label">Internal Data</div>
                  {selectedCandidate.citation && (
                    <blockquote className="fac__cite">&ldquo;{selectedCandidate.citation}&rdquo;</blockquote>
                  )}
                  {selectedCandidate.fieldEvidence && (
                    <dl className="ref__source-fields">
                      {selectedCandidate.fieldEvidence.specialties && (
                        <><dt>Specialties</dt><dd>{selectedCandidate.fieldEvidence.specialties}</dd></>
                      )}
                      {selectedCandidate.fieldEvidence.procedures && (
                        <><dt>Procedures</dt><dd>{selectedCandidate.fieldEvidence.procedures}</dd></>
                      )}
                      {selectedCandidate.fieldEvidence.equipment && (
                        <><dt>Equipment</dt><dd>{selectedCandidate.fieldEvidence.equipment}</dd></>
                      )}
                      {selectedCandidate.fieldEvidence.description && (
                        <><dt>Description</dt><dd>{selectedCandidate.fieldEvidence.description}</dd></>
                      )}
                    </dl>
                  )}
                  {selectedCandidate.qualitativeAnalysis && (
                    <p className="ref__source-attr">Analysis generated by Cerebras AI from the above sources</p>
                  )}
                </div>
              )}

              {/* External References */}
              {selectedCandidate.externalSources && selectedCandidate.externalSources.length > 0 && (
                <div className="ref__src-group">
                  <div className="ref__src-group-label">External References</div>
                  <ul className="ref__ext-links">
                    {selectedCandidate.externalSources.map((src, i) => (
                      <li key={i}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer">{src.name}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="ref__missing">
            <div className="ref__section-title">Missing / uncertain</div>
            {selectedCandidate.missingEvidence.length > 0 ? (
              <ul className="ref__evidence-list">
                {selectedCandidate.missingEvidence.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            ) : (
              <p>No explicit missing evidence was returned. Verify current service availability before referral.</p>
            )}
          </section>

          <button className="ref__save" onClick={saveSelected} disabled={selectedSaved || savingId === selectedCandidate.facilityId}>
            {selectedSaved ? "Saved to shortlist" : savingId === selectedCandidate.facilityId ? "Saving..." : "Save to Shortlist"}
          </button>
          {saveError && <p className="save__err">{saveError}</p>}
          {shortlist.length > 0 && <p className="note">{shortlist.length} saved referral{shortlist.length === 1 ? "" : "s"} in Lakebase.</p>}
        </aside>
      )}
      </div>
    </main>
  );
}
