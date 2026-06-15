"use client";

import { useEffect, useState } from "react";
import GapMap, { type Region } from "@/components/GapMap";
import AgentAsk from "@/components/AgentAsk";
import { CAPABILITIES, type CapabilityKey, gapColor, trustLabel, trustClass } from "@/lib/meddesert";
import { explainGap } from "@/lib/reasoning";
import { scenarioBrief } from "@/lib/brief";

interface QueryMeta { ms: number; rows: number; source: string; engine: string }
interface District {
  district: string;
  nFacilities: number;
  strong: number;
  supply: number;
  institutionalBirth: number | null;
  needIndex: number | null;
  scarcity: number;
  gapScore: number;
  dataPoor: boolean;
}

interface Facility {
  name: string;
  city: string;
  trust: string;
  citation: string;
  structured: boolean;
  claim: boolean;
  lat: number | null;
  lon: number | null;
}

interface Scenario {
  id: string;
  createdAt: string;
  capability: string;
  state: string;
  gapScore: number | null;
  dataPoor: boolean;
  nFacilities: number;
  note: string;
  evidence: { name: string; trust: string; citation: string }[];
}

export default function MedDesertPlanner() {
  const [capability, setCapability] = useState<CapabilityKey>("icu");
  const [regions, setRegions] = useState<Region[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facLoading, setFacLoading] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [regionMeta, setRegionMeta] = useState<QueryMeta | null>(null);
  const [facMeta, setFacMeta] = useState<QueryMeta | null>(null);
  const [showMath, setShowMath] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { id: string; overrideTrust: string; note: string }>>({});
  const [editKey, setEditKey] = useState<string | null>(null);
  const [ovTrust, setOvTrust] = useState("weak");
  const [ovNote, setOvNote] = useState("");
  const [districts, setDistricts] = useState<District[]>([]);
  const [showDistricts, setShowDistricts] = useState(false);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadScenarios = () =>
    fetch("/api/scenarios")
      .then((r) => r.json())
      .then((j) => setScenarios(j.ok ? j.scenarios : []))
      .catch(() => {});

  useEffect(() => { loadScenarios(); }, []);
  useEffect(() => { setNote(""); setSaveErr(null); }, [selected, capability]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/regions?capability=${capability}`)
      .then((r) => r.json())
      .then((j) => { setRegions(j.ok ? j.regions : []); setRegionMeta(j.meta ?? null); })
      .catch(() => setRegions([]))
      .finally(() => setLoading(false));
  }, [capability]);

  // Drill-in: load the facility records (with cited evidence) behind the selected state.
  useEffect(() => {
    if (!selected) { setFacilities([]); return; }
    setFacLoading(true);
    const ctrl = new AbortController();
    fetch(`/api/facilities?capability=${capability}&state=${encodeURIComponent(selected)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => { setFacilities(j.ok ? j.facilities : []); setFacMeta(j.meta ?? null); })
      .catch(() => { if (!ctrl.signal.aborted) setFacilities([]); })
      .finally(() => { if (!ctrl.signal.aborted) setFacLoading(false); });
    return () => ctrl.abort();
  }, [selected, capability]);

  // Load any planner trust overrides for the selected scope.
  useEffect(() => {
    setEditKey(null);
    if (!selected) { setOverrides({}); return; }
    const ctrl = new AbortController();
    fetch(`/api/overrides?capability=${capability}&state=${encodeURIComponent(selected)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) return;
        const m: Record<string, { id: string; overrideTrust: string; note: string }> = {};
        j.overrides.forEach((o: { facilityName: string; id: string; overrideTrust: string; note: string }) => {
          m[o.facilityName] = { id: o.id, overrideTrust: o.overrideTrust, note: o.note };
        });
        setOverrides(m);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [selected, capability]);

  // District-level gap (supply via PIN × NFHS-5 demand) for the selected state × capability.
  useEffect(() => {
    setShowDistricts(false);
    if (!selected) { setDistricts([]); return; }
    const ctrl = new AbortController();
    fetch(`/api/districts?capability=${capability}&state=${encodeURIComponent(selected)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => setDistricts(j.ok ? j.districts : []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [selected, capability]);

  const realGaps = regions.filter((r) => !r.dataPoor).sort((a, b) => b.gapScore - a.gapScore);
  const sel = regions.find((r) => r.state === selected) ?? null;

  // Live national KPIs for the active capability (derived from the loaded regions — no extra query).
  const kpis = {
    realGaps: realGaps.length,
    dataPoor: regions.filter((r) => r.dataPoor).length,
    facilities: regions.reduce((a, r) => a + r.nFacilities, 0),
    strong: regions.reduce((a, r) => a + r.strong, 0),
  };

  async function applyOverride(name: string) {
    if (!sel) return;
    const res = await fetch("/api/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityName: name, capability, state: sel.state, overrideTrust: ovTrust, note: ovNote }),
    });
    const j = await res.json();
    if (j.ok) {
      setOverrides((p) => ({ ...p, [name]: { id: j.override.id, overrideTrust: j.override.overrideTrust, note: j.override.note } }));
      setEditKey(null);
      setOvNote("");
    }
  }

  async function clearOverride(name: string) {
    const o = overrides[name];
    if (!o) return;
    await fetch(`/api/overrides?id=${o.id}`, { method: "DELETE" }).catch(() => {});
    setOverrides((p) => { const n = { ...p }; delete n[name]; return n; });
  }

  async function copyBrief(s: Scenario) {
    try {
      await navigator.clipboard.writeText(scenarioBrief(s));
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((c) => (c === s.id ? null : c)), 1800);
    } catch { /* clipboard unavailable — the brief is still visible to copy manually */ }
  }

  async function saveScenario() {
    if (!sel) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability,
          state: sel.state,
          gapScore: sel.dataPoor ? null : sel.gapScore,
          dataPoor: sel.dataPoor,
          nFacilities: sel.nFacilities,
          note,
          evidence: facilities.slice(0, 5).map((f) => ({ name: f.name, trust: f.trust, citation: f.citation })),
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "save failed");
      setNote("");
      await loadScenarios();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeScenario(id: string) {
    await fetch(`/api/scenarios?id=${id}`, { method: "DELETE" }).catch(() => {});
    await loadScenarios();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">Medical Desert Planner</span>
          <span className="brand__sub">India · care-gap analysis</span>
        </div>
        <div className="feeds">
          <span className="pill">Virtue Foundation · NFHS-5</span>
          <span className="pill pill--live"><span className="dot" /> Databricks</span>
        </div>
      </header>

      <nav className="tabs">
        {CAPABILITIES.map((c) => (
          <button key={c.key} className={`tab${capability === c.key ? " tab--active" : ""}`}
            onClick={() => { setCapability(c.key); setSelected(null); }}>{c.label}</button>
        ))}
      </nav>

      <main className="stage">
        <section className="map-col">
          {loading && <div className="map-loading"><span className="map-loading__spin" />Loading {capability} coverage…<span className="map-loading__sub">querying Databricks</span></div>}
          <GapMap regions={regions} facilities={facilities} onSelect={setSelected} />
          {!loading && regions.length > 0 && (
            <div className="overlay overlay--tl kpis rise">
              <div className="kpis__cap">{capability.toUpperCase()} · India</div>
              <div className="kpis__row">
                <div className="kpi"><span className="kpi__n kpi__n--gap">{kpis.realGaps}</span><span className="kpi__l">real gaps</span></div>
                <div className="kpi"><span className="kpi__n">{kpis.dataPoor}</span><span className="kpi__l">data-poor</span></div>
                <div className="kpi"><span className="kpi__n">{kpis.facilities.toLocaleString()}</span><span className="kpi__l">facilities</span></div>
                <div className="kpi"><span className="kpi__n">{kpis.strong.toLocaleString()}</span><span className="kpi__l">strong evid.</span></div>
              </div>
            </div>
          )}
          <div className="overlay overlay--bl legend rise">
            <div className="legend__title">{capability.toUpperCase()} care gap</div>
            <div className="legend__bar" style={{ background: `linear-gradient(90deg, ${gapColor(0)}, ${gapColor(0.3)}, ${gapColor(0.6)})` }} />
            <div className="legend__scale"><span>covered</span><span>gap</span></div>
            <p className="legend__note">Gap = NFHS-5 need × trust-weighted facility scarcity. Grey = data-poor (not enough evidence to judge). Click a state to inspect.</p>
            {regionMeta && (
              <div className="obs obs--legend">
                <span className="obs__dot" /> {regionMeta.engine} · {regionMeta.rows} regions · {regionMeta.ms}ms · <code>{regionMeta.source}</code>
              </div>
            )}
          </div>
        </section>

        <aside className="rail">
          <AgentAsk onResult={(cap, state) => {
            if (CAPABILITIES.some((c) => c.key === cap)) setCapability(cap as CapabilityKey);
            setSelected(state);
          }} />

          <section className="panel">
            <div className="panel__head">
              <div className="panel__eyebrow">Highest-risk gaps</div>
              <h2 className="panel__title">{capability.toUpperCase()} — real care gaps</h2>
            </div>
            <div className="panel__body">
              {realGaps.length === 0 && <p className="note">Loading…</p>}
              <div className="alloc">
                {realGaps.slice(0, 8).map((r) => (
                  <button key={r.state} className="alloc__row alloc__row--btn" onClick={() => setSelected(r.state)}>
                    <div className="alloc__row__top">
                      <span className="alloc__county">{r.state}</span>
                      <span className="alloc__amt">{r.gapScore.toFixed(2)}</span>
                    </div>
                    <div className="bar"><div className="bar__fill" style={{ width: `${Math.round(r.gapScore / (realGaps[0].gapScore || 1) * 100)}%`, background: gapColor(r.gapScore) }} /></div>
                    <div className="alloc__action">{r.strong} strong · {r.nFacilities} facilities · NFHS inst-birth {r.institutionalBirth ?? "—"}%</div>
                  </button>
                ))}
              </div>
              <p className="note">Ranked by gap score among states with enough evidence + NFHS need data. Data-poor regions are shown grey on the map, not ranked.</p>
            </div>
          </section>

          {sel && (
            <section className="panel rise">
              <div className="panel__head">
                <div className="panel__eyebrow">{sel.dataPoor ? "Data-poor region" : "Selected region"}</div>
                <h2 className="panel__title">{sel.state}</h2>
              </div>
              <div className="panel__body">
                <div className="cond-grid">
                  <div className="cond"><span className="cond__label">Gap score</span><span className="cond__value">{sel.dataPoor ? "—" : sel.gapScore.toFixed(2)}</span></div>
                  <div className="cond"><span className="cond__label">Facilities</span><span className="cond__value">{sel.nFacilities}</span></div>
                  <div className="cond"><span className="cond__label">Strong evid.</span><span className="cond__value">{sel.strong}</span></div>
                  <div className="cond"><span className="cond__label">Inst. birth</span><span className="cond__value">{sel.institutionalBirth ?? "—"}<small>%</small></span></div>
                </div>
                {(() => {
                  const capLabel = CAPABILITIES.find((c) => c.key === capability)?.label ?? capability.toUpperCase();
                  const ex = explainGap(sel, capLabel);
                  return (
                    <div className={`verdict verdict--${ex.verdict.kind}`}>
                      <div className="verdict__head">{ex.verdict.headline}</div>
                      <ul className="verdict__why">
                        {ex.verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                      <button className="reveal" onClick={() => setShowMath((v) => !v)}>
                        {showMath ? "Hide the math ▲" : "How this score was computed ▼"}
                      </button>
                      {showMath && (
                        <ol className="cot">
                          {ex.steps.map((s) => (
                            <li key={s.n} className="cot__step">
                              <div className="cot__row">
                                <span className="cot__label">{s.label}</span>
                                <span className="cot__value">{s.value}</span>
                              </div>
                              <code className="cot__formula">{s.formula}</code>
                              <p className="cot__detail">{s.detail}</p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })()}

                {districts.length > 0 && (() => {
                  const realDist = districts.filter((d) => !d.dataPoor);
                  const top = realDist.slice(0, 12);
                  const maxGap = top[0]?.gapScore || 1;
                  return (
                    <div className="dist">
                      <button className="reveal" onClick={() => setShowDistricts((v) => !v)}>
                        {showDistricts ? "Hide district gaps ▲" : `District gaps — ${capability.toUpperCase()} (${realDist.length} real · ${districts.length - realDist.length} data-poor) ▼`}
                      </button>
                      {showDistricts && (
                        <>
                          <ul className="dist__list">
                            {top.map((d) => (
                              <li key={d.district} className="dist__row">
                                <span className="dist__name">{d.district}</span>
                                <span className="dist__bar"><span className="dist__fill" style={{ width: `${Math.round((d.gapScore / maxGap) * 100)}%`, background: gapColor(d.gapScore) }} /></span>
                                <span className="dist__val">{d.strong}s · {d.nFacilities}f</span>
                              </li>
                            ))}
                          </ul>
                          <p className="note">Facility supply mapped to district via PIN postcode × NFHS-5 district need. Gap = need × scarcity within {sel.state}. {districts.length - realDist.length} districts are data-poor (no NFHS match or &lt;5 facilities) and excluded from the ranking.</p>
                        </>
                      )}
                    </div>
                  );
                })()}

                <div className="evid__head">
                  <span className="evid__title">Facilities with {capability.toUpperCase()} evidence</span>
                  {!facLoading && <span className="evid__count">{facilities.length}</span>}
                </div>
                {facMeta && !facLoading && (
                  <div className="obs">
                    <span className="obs__dot" /> {facMeta.rows} rows · {facMeta.ms}ms · <code>{facMeta.source}</code>
                  </div>
                )}
                {facLoading && <p className="note">Loading facility records…</p>}
                {!facLoading && facilities.length === 0 && (
                  <p className="note">No facility in {sel.state} carries any {capability.toUpperCase()} claim — the gap here is an absence of evidence, not a verified service.</p>
                )}
                <ul className="evid">
                  {facilities.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="fac">
                      <div className="fac__top">
                        <span className="fac__name">{f.name || "Unnamed facility"}</span>
                        <span className={`trust ${trustClass(f.trust)}`}>{trustLabel(f.trust)}</span>
                      </div>
                      {f.city && <div className="fac__city">{f.city}</div>}
                      {f.citation && <blockquote className="fac__cite">“{f.citation}”</blockquote>}
                      <div className="fac__src">
                        {f.structured && <span className="src-tag">structured specialty</span>}
                        {f.claim && <span className="src-tag">facility claim</span>}
                        {!f.structured && !f.claim && <span className="src-tag src-tag--soft">description only</span>}
                      </div>
                      {overrides[f.name] ? (
                        <div className="ov ov--set">
                          <span className={`trust ${trustClass(overrides[f.name].overrideTrust)}`}>Planner: {trustLabel(overrides[f.name].overrideTrust)}</span>
                          {overrides[f.name].note && <span className="ov__note">{overrides[f.name].note}</span>}
                          <button className="ov__link" onClick={() => clearOverride(f.name)}>undo</button>
                        </div>
                      ) : editKey === f.name ? (
                        <div className="ov ov--edit">
                          <select className="ov__sel" value={ovTrust} onChange={(e) => setOvTrust(e.target.value)}>
                            <option value="strong">Strong</option>
                            <option value="partial">Partial</option>
                            <option value="weak">Weak</option>
                            <option value="none">No claim</option>
                          </select>
                          <input className="ov__input" placeholder="reason (optional)" value={ovNote} onChange={(e) => setOvNote(e.target.value)} maxLength={1000} />
                          <button className="ov__link ov__link--save" onClick={() => applyOverride(f.name)}>Save</button>
                          <button className="ov__link" onClick={() => setEditKey(null)}>✕</button>
                        </div>
                      ) : (
                        <button className="ov__open" onClick={() => { setEditKey(f.name); setOvTrust(f.trust === "none" ? "weak" : f.trust); setOvNote(""); }}>
                          Override trust ▾
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {facilities.length > 0 && (
                  <p className="note">Every row cites the facility&apos;s own text. Strong = structured code and claim agree; weak = mentioned only in free-text. Verify before acting.</p>
                )}

                <div className="save">
                  <label className="save__label" htmlFor="scenario-note">Save as a planning scenario</label>
                  <textarea id="scenario-note" className="save__note" rows={2}
                    placeholder={`Why ${sel.state} for ${capability.toUpperCase()}? (optional note)`}
                    value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                  <button className="btn btn--primary" onClick={saveScenario} disabled={saving}>
                    {saving ? "Saving…" : "Save scenario"}
                  </button>
                  {saveErr && <p className="save__err">{saveErr}</p>}
                  <p className="note">Persisted to Lakebase with a snapshot of the cited evidence above.</p>
                </div>
              </div>
            </section>
          )}

          {scenarios.length > 0 && (
            <section className="panel">
              <div className="panel__head">
                <div className="panel__eyebrow">Persisted · Lakebase</div>
                <h2 className="panel__title">Saved planning scenarios</h2>
              </div>
              <div className="panel__body">
                <ul className="scen">
                  {scenarios.map((s) => (
                    <li key={s.id} className="scen__item">
                      <div className="scen__top">
                        <button className="scen__title" onClick={() => { setCapability(s.capability as CapabilityKey); setSelected(s.state); }}>
                          {s.state} · {s.capability.toUpperCase()}
                        </button>
                        <div className="scen__actions">
                          <button className="ov__link" onClick={() => setBriefId((b) => (b === s.id ? null : s.id))}>{briefId === s.id ? "hide" : "brief"}</button>
                          <button className="scen__del" onClick={() => removeScenario(s.id)} aria-label="Delete scenario">✕</button>
                        </div>
                      </div>
                      <div className="scen__meta">
                        {s.dataPoor ? "data-poor" : `gap ${s.gapScore?.toFixed(2) ?? "—"}`} · {s.nFacilities} facilities · {s.evidence.length} cited
                      </div>
                      {s.note && <p className="scen__note">{s.note}</p>}
                      {briefId === s.id && (
                        <div className="brief">
                          <div className="brief__bar">
                            <span className="brief__label">Shareable brief (Markdown)</span>
                            <button className="ov__link ov__link--save" onClick={() => copyBrief(s)}>{copiedId === s.id ? "copied ✓" : "copy"}</button>
                          </div>
                          <pre className="brief__pre">{scenarioBrief(s)}</pre>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
