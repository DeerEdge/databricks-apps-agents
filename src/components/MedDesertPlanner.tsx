"use client";

import { useEffect, useState } from "react";
import GapMap, { type Region } from "@/components/GapMap";
import { CAPABILITIES, type CapabilityKey, gapColor, trustLabel, trustClass } from "@/lib/meddesert";

interface Facility {
  name: string;
  city: string;
  trust: string;
  citation: string;
  structured: boolean;
  claim: boolean;
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
      .then((j) => setRegions(j.ok ? j.regions : []))
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
      .then((j) => setFacilities(j.ok ? j.facilities : []))
      .catch(() => { if (!ctrl.signal.aborted) setFacilities([]); })
      .finally(() => { if (!ctrl.signal.aborted) setFacLoading(false); });
    return () => ctrl.abort();
  }, [selected, capability]);

  const realGaps = regions.filter((r) => !r.dataPoor).sort((a, b) => b.gapScore - a.gapScore);
  const sel = regions.find((r) => r.state === selected) ?? null;

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
          <GapMap regions={regions} onSelect={setSelected} />
          <div className="overlay overlay--bl legend rise">
            <div className="legend__title">{capability.toUpperCase()} care gap</div>
            <div className="legend__bar" style={{ background: `linear-gradient(90deg, ${gapColor(0)}, ${gapColor(0.3)}, ${gapColor(0.6)})` }} />
            <div className="legend__scale"><span>covered</span><span>gap</span></div>
            <p className="legend__note">Gap = NFHS-5 need × trust-weighted facility scarcity. Grey = data-poor (not enough evidence to judge). Click a state to inspect.</p>
          </div>
        </section>

        <aside className="rail">
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
                {sel.dataPoor && <p className="note">Too little evidence or no NFHS need data — treat with caution, don&apos;t conclude a real gap.</p>}

                <div className="evid__head">
                  <span className="evid__title">Facilities with {capability.toUpperCase()} evidence</span>
                  {!facLoading && <span className="evid__count">{facilities.length}</span>}
                </div>
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
                        <button className="scen__del" onClick={() => removeScenario(s.id)} aria-label="Delete scenario">✕</button>
                      </div>
                      <div className="scen__meta">
                        {s.dataPoor ? "data-poor" : `gap ${s.gapScore?.toFixed(2) ?? "—"}`} · {s.nFacilities} facilities · {s.evidence.length} cited
                      </div>
                      {s.note && <p className="scen__note">{s.note}</p>}
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
