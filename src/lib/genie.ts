// Server-only Databricks Genie Conversation API client.
// NEVER import this into a client component — it reads the access token.
//
// Flow: start (or continue) a conversation with the planner's natural-language question, poll the
// resulting message until it completes, then collect the text answer and — when Genie ran SQL —
// fetch the query result so the chatbot can visualize it.

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const SPACE_ID = process.env.DATABRICKS_GENIE_SPACE_ID;

export interface GenieQuery {
  sql: string;
  description: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface GenieAnswer {
  text: string;
  conversationId: string;
  messageId: string;
  query: GenieQuery | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertConfig() {
  if (!HOST || !TOKEN || !SPACE_ID) {
    throw new Error(
      "Genie env not configured — set DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_GENIE_SPACE_ID in .env.local"
    );
  }
}

async function genieFetch(path: string, init: RequestInit): Promise<unknown> {
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
    // Surface only the API's message — never the bearer token.
    const text = await res.text();
    throw new Error(`Genie API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Parse a Statement Execution `statement_response` (manifest + data_array) into typed rows.
// Genie's query-result endpoint returns the same shape the SQL API does.
function parseStatement(stmt: any): { columns: string[]; rows: Record<string, unknown>[] } {
  const columns: string[] = (stmt?.manifest?.schema?.columns ?? []).map((c: any) => c.name);
  const dataArray: unknown[][] = stmt?.result?.data_array ?? [];
  const rows = dataArray.map((r) => Object.fromEntries(r.map((v, i) => [columns[i], v])));
  return { columns, rows };
}

/**
 * Ask Genie a natural-language question. Pass `conversationId` to continue an existing thread.
 * Returns the text answer plus, when Genie attached a query, its SQL and result rows.
 * Throws on misconfiguration, API errors, or a failed/timed-out message (fail closed).
 */
export async function askGenie(question: string, conversationId?: string): Promise<GenieAnswer> {
  assertConfig();
  const content = question.trim().slice(0, 500);
  if (!content) throw new Error("question required");

  // 1) Start a new conversation or post a follow-up turn.
  const started = (conversationId
    ? await genieFetch(`/api/2.0/genie/spaces/${SPACE_ID}/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      })
    : await genieFetch(`/api/2.0/genie/spaces/${SPACE_ID}/start-conversation`, {
        method: "POST",
        body: JSON.stringify({ content }),
      })) as any;

  const convId: string = started?.conversation_id ?? started?.conversation?.id ?? conversationId;
  const msgId: string = started?.message_id ?? started?.message?.id ?? started?.id;
  if (!convId || !msgId) throw new Error("Genie did not return a conversation/message id");

  // 2) Poll the message until it reaches a terminal state (Genie + warehouse cold-start is slow).
  const msgPath = `/api/2.0/genie/spaces/${SPACE_ID}/conversations/${convId}/messages/${msgId}`;
  const deadline = Date.now() + 90_000;
  let msg = (await genieFetch(msgPath, { method: "GET" })) as any;
  while (
    msg?.status &&
    msg.status !== "COMPLETED" &&
    msg.status !== "FAILED" &&
    msg.status !== "CANCELLED" &&
    msg.status !== "QUERY_RESULT_EXPIRED" &&
    Date.now() < deadline
  ) {
    await sleep(1200);
    msg = (await genieFetch(msgPath, { method: "GET" })) as any;
  }
  if (msg?.status !== "COMPLETED") {
    throw new Error(`Genie message did not complete (status ${msg?.status ?? "unknown"})`);
  }

  // 3) Collect the text answer and, if present, the query attachment + its result.
  const attachments: any[] = msg.attachments ?? [];
  const text = attachments
    .map((a) => a?.text?.content)
    .filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0)
    .join("\n\n")
    .trim();

  let query: GenieQuery | null = null;
  const queryAtt = attachments.find((a) => a?.query);
  if (queryAtt) {
    const attId = queryAtt.attachment_id ?? queryAtt.id;
    const result = (await genieFetch(`${msgPath}/attachments/${attId}/query-result`, {
      method: "GET",
    })) as any;
    const { columns, rows } = parseStatement(result?.statement_response);
    query = {
      sql: String(queryAtt.query.query ?? ""),
      description: String(queryAtt.query.description ?? ""),
      columns,
      rows,
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { text, conversationId: convId, messageId: msgId, query };
}
