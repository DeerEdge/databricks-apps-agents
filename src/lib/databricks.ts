// Server-only Databricks SQL client (Statement Execution API).
// NEVER import this into a client component — it reads the access token.

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;

export interface SqlParam {
  name: string;
  value: string | number | boolean | null;
  type?: string; // e.g. "INT", "STRING", "DOUBLE"
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertConfig() {
  if (!HOST || !TOKEN || !WAREHOUSE_ID) {
    throw new Error(
      "Databricks env not configured — set DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID in .env.local"
    );
  }
}

async function dbxFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    // Avoid leaking the token; surface only the API's message.
    const text = await res.text();
    throw new Error(`Databricks API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Run a SQL statement on the configured warehouse and return typed rows.
 * Use `params` with `:name` markers in the SQL — never string-concatenate input.
 */
export async function runSql(statement: string, params: SqlParam[] = []): Promise<QueryResult> {
  assertConfig();

  const body: Record<string, unknown> = {
    warehouse_id: WAREHOUSE_ID,
    statement,
    wait_timeout: "50s",
    on_wait_timeout: "CONTINUE",
    format: "JSON_ARRAY",
    disposition: "INLINE",
  };
  if (params.length) {
    body.parameters = params.map((p) => ({
      name: p.name,
      value: p.value === null ? null : String(p.value),
      ...(p.type ? { type: p.type } : {}),
    }));
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let data = (await dbxFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify(body),
  })) as any;

  const id = data?.statement_id;
  let state = data?.status?.state;

  // Poll until terminal (covers cold-start beyond the wait_timeout window).
  const deadline = Date.now() + 90_000;
  while ((state === "PENDING" || state === "RUNNING") && Date.now() < deadline) {
    await sleep(1200);
    data = (await dbxFetch(`/api/2.0/sql/statements/${id}`, { method: "GET" })) as any;
    state = data?.status?.state;
  }

  if (state !== "SUCCEEDED") {
    const msg = data?.status?.error?.message ?? `statement ended in state ${state}`;
    throw new Error(`Databricks query failed: ${msg}`);
  }

  const columns: string[] = (data.manifest?.schema?.columns ?? []).map((c: any) => c.name);
  const dataArray: unknown[][] = data.result?.data_array ?? [];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const rows = dataArray.map((r) =>
    Object.fromEntries(r.map((v, i) => [columns[i], v]))
  );
  return { columns, rows };
}
