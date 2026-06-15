"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { normalizeState, gapColor, trustColor, trustLabel } from "@/lib/meddesert";

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Escape interpolated values before injecting into popup HTML (state names come from
// messy public data — never trust them as markup).
const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const INDIA_BOUNDS: maplibregl.LngLatBoundsLike = [[68, 6], [98, 37]];

export interface Region {
  state: string;
  gapScore: number;
  dataPoor: boolean;
  nFacilities: number;
  strong: number;
  partial: number;
  weak: number;
  supply: number;
  institutionalBirth: number | null;
  insurancePct: number | null;
  needIndex: number;
  scarcity: number;
}

export interface FacilityPoint {
  name: string;
  trust: string;
  citation: string;
  lat: number | null;
  lon: number | null;
}

export default function GapMap({
  regions,
  facilities = [],
  onSelect,
}: {
  regions: Region[];
  facilities?: FacilityPoint[];
  onSelect: (state: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geoRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const regionsRef = useRef<Region[]>(regions);
  regionsRef.current = regions;
  const facRef = useRef<FacilityPoint[]>(facilities);
  facRef.current = facilities;

  function facCollection(): GeoJSON.FeatureCollection {
    return {
      type: "FeatureCollection",
      features: facRef.current
        .filter((f) => f.lat != null && f.lon != null && Number.isFinite(f.lat) && Number.isFinite(f.lon))
        .map((f) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [f.lon as number, f.lat as number] },
          properties: { name: f.name, trust: f.trust, trustLabel: trustLabel(f.trust), citation: f.citation, color: trustColor(f.trust) },
        })),
    };
  }

  function paintFacilities() {
    const map = mapRef.current;
    if (!map || !map.getSource("facilities")) return;
    const fc = facCollection();
    (map.getSource("facilities") as maplibregl.GeoJSONSource).setData(fc);
    if (fc.features.length) {
      const b = new maplibregl.LngLatBounds();
      fc.features.forEach((ft) => b.extend((ft.geometry as GeoJSON.Point).coordinates as [number, number]));
      map.fitBounds(b, { padding: 70, maxZoom: 8.5, duration: 700 });
    }
  }

  function paint() {
    const map = mapRef.current;
    const geo = geoRef.current;
    if (!map || !geo || !map.getSource("states")) return;
    const byState = new Map(regionsRef.current.map((r) => [normalizeState(r.state), r]));
    for (const f of geo.features) {
      const r = byState.get(normalizeState(String(f.properties?.shapeName ?? "")));
      f.properties = {
        ...(f.properties ?? {}),
        fill: !r || r.dataPoor ? "#d8d8d8" : gapColor(r.gapScore),
        gap: r?.gapScore ?? 0,
        dataPoor: !r || r.dataPoor,
        state: r?.state ?? f.properties?.shapeName,
      };
    }
    (map.getSource("states") as maplibregl.GeoJSONSource).setData(geo);
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current, style: STYLE,
      bounds: INDIA_BOUNDS, fitBoundsOptions: { padding: 20 },
      maxBounds: [[60, 2], [105, 42]], minZoom: 3, maxZoom: 9,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map?: maplibregl.Map }).__map = map;

    map.on("load", async () => {
      const geo = (await fetch("/india-states.json").then((r) => r.json())) as GeoJSON.FeatureCollection;
      geoRef.current = geo;
      map.addSource("states", { type: "geojson", data: geo });
      map.addLayer({ id: "state-fill", type: "fill", source: "states", paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.82 } });
      map.addLayer({ id: "state-line", type: "line", source: "states", paint: { "line-color": "#fff", "line-width": 0.5, "line-opacity": 0.7 } });
      paint();

      const popup = new maplibregl.Popup({ closeButton: false, className: "map-popup", offset: 8 });
      map.on("mousemove", "state-fill", (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        map.getCanvas().style.cursor = "pointer";
        popup.setLngLat(e.lngLat).setHTML(
          `<div class="pop__name">${esc(p.state)}</div><span class="pop__tag">${p.dataPoor ? "data-poor — click" : `gap ${Number(p.gap).toFixed(2)} — click to drill in`}</span>`
        ).addTo(map);
      });
      map.on("mouseleave", "state-fill", () => { map.getCanvas().style.cursor = ""; popup.remove(); });
      map.on("click", "state-fill", (e) => {
        const st = e.features?.[0]?.properties?.state;
        if (st) onSelect(String(st));
      });

      // Facility points for the selected state, colored by trust.
      map.addSource("facilities", { type: "geojson", data: facCollection() });
      map.addLayer({
        id: "facility-pts", type: "circle", source: "facilities",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.2, 8, 6.5],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2, "circle-opacity": 0.9,
        },
      });
      const fpop = new maplibregl.Popup({ closeButton: false, className: "map-popup", offset: 8 });
      map.on("mouseenter", "facility-pts", (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        map.getCanvas().style.cursor = "pointer";
        fpop.setLngLat((e.features![0].geometry as GeoJSON.Point).coordinates as [number, number]).setHTML(
          `<div class="pop__name">${esc(p.name)}</div><span class="pop__tag">${esc(p.trustLabel)}</span>${p.citation ? `<div class="pop__cite">“${esc(p.citation)}”</div>` : ""}`
        ).addTo(map);
      });
      map.on("mouseleave", "facility-pts", () => { map.getCanvas().style.cursor = ""; fpop.remove(); });
      paintFacilities();
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { paint(); }, [regions]);
  useEffect(() => { paintFacilities(); }, [facilities]);

  return <div className="map" ref={containerRef} />;
}
