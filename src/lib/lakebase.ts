// Server-only Lakebase (Postgres OLTP) client for persisted planning scenarios.
// NEVER import into a client component — it reads Databricks credentials.
//
// Auth: Lakebase has native login disabled, so the Postgres password is a short-lived
// OAuth token minted from the Databricks token via the Database Credentials API. We cache
// the token and refresh it before expiry; pg accepts an async `password` function per
// connection, so every new connection picks up a fresh token automatically.

import { Pool } from "pg";
import type { CleanScenario } from "./scenario";

const DBX_HOST = process.env.DATABRICKS_HOST;
const DBX_TOKEN = process.env.DATABRICKS_TOKEN;
const INSTANCE = process.env.LAKEBASE_INSTANCE;
const PG_HOST = process.env.LAKEBASE_HOST;
const PG_USER = process.env.LAKEBASE_USER;
const PG_DATABASE = process.env.LAKEBASE_DATABASE ?? "databricks_postgres";

export interface SavedScenario extends CleanScenario {
  id: string;
  createdAt: string;
}

function assertConfig() {
  if (!DBX_HOST || !DBX_TOKEN || !INSTANCE || !PG_HOST || !PG_USER) {
    throw new Error(
      "Lakebase not configured — set LAKEBASE_INSTANCE, LAKEBASE_HOST, LAKEBASE_USER in .env.local"
    );
  }
}

// Token cache (refresh ~2 min before the API-reported expiry).
let cachedToken: { token: string; expiresAt: number } | null = null;

async function databaseToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 120_000) return cachedToken.token;
  const res = await fetch(`${DBX_HOST}/api/2.0/database/credentials`, {
    method: "POST",
    headers: { Authorization: `Bearer ${DBX_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: crypto.randomUUID(), instance_names: [INSTANCE] }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Lakebase credential API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { token: string; expiration_time?: string };
  const expiresAt = data.expiration_time ? Date.parse(data.expiration_time) : Date.now() + 3_300_000;
  cachedToken = { token: data.token, expiresAt };
  return data.token;
}

// One pool per server process. `password` is an async fn → fresh token per connection.
let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (pool) return pool;
  assertConfig();
  pool = new Pool({
    host: PG_HOST,
    port: 5432,
    user: PG_USER,
    database: PG_DATABASE,
    password: databaseToken,
    ssl: true, // verified TLS (rejectUnauthorized defaults on) — Lakebase has a publicly-trusted cert
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  return pool;
}

function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS saved_scenario (
         id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         created_at  timestamptz NOT NULL DEFAULT now(),
         capability  text NOT NULL,
         state       text NOT NULL,
         gap_score   double precision,
         data_poor   boolean NOT NULL DEFAULT false,
         n_facilities integer NOT NULL DEFAULT 0,
         note        text NOT NULL DEFAULT '',
         evidence    jsonb NOT NULL DEFAULT '[]'::jsonb
       )`
    )
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null; // allow a retry on next call
      throw e;
    });
  return schemaReady;
}

export async function saveScenario(s: CleanScenario): Promise<SavedScenario> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO saved_scenario (capability, state, gap_score, data_poor, n_facilities, note, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, created_at, capability, state, gap_score, data_poor, n_facilities, note, evidence`,
    [s.capability, s.state, s.gapScore, s.dataPoor, s.nFacilities, s.note, JSON.stringify(s.evidence)]
  );
  return toScenario(rows[0]);
}

export async function listScenarios(limit = 50): Promise<SavedScenario[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, created_at, capability, state, gap_score, data_poor, n_facilities, note, evidence
     FROM saved_scenario ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(toScenario);
}

export async function deleteScenario(id: string): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(`DELETE FROM saved_scenario WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toScenario(r: any): SavedScenario {
  return {
    id: String(r.id),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    capability: r.capability,
    state: r.state,
    gapScore: r.gap_score === null ? null : Number(r.gap_score),
    dataPoor: r.data_poor === true,
    nFacilities: Number(r.n_facilities ?? 0),
    note: r.note ?? "",
    evidence: Array.isArray(r.evidence) ? r.evidence : [],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
