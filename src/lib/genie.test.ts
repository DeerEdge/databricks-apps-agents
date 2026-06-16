import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const HOST = "https://dbx.example.com";
const TOKEN = "super-secret-token";

function setEnv() {
  process.env.DATABRICKS_HOST = HOST;
  process.env.DATABRICKS_TOKEN = TOKEN;
  process.env.DATABRICKS_GENIE_SPACE_ID = "space123";
}

// Re-import the module so its top-level env consts capture the current process.env.
async function loadGenie() {
  vi.resetModules();
  return import("./genie");
}

type Body = Record<string, unknown>;
const res = (body: Body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const QUERY_ATT = {
  attachment_id: "a1",
  text: { content: "Bihar has the worst gap." },
  query: { query: "SELECT state, gap FROM t", description: "gaps by state" },
};
const QUERY_RESULT = {
  statement_response: {
    manifest: { schema: { columns: [{ name: "state" }, { name: "gap" }] } },
    result: { data_array: [["Bihar", "0.19"], ["Meghalaya", "0.37"]] },
  },
};

beforeEach(() => setEnv());
afterEach(() => vi.restoreAllMocks());

describe("askGenie", () => {
  it("returns text + parsed query result on the happy path", async () => {
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/start-conversation")) return res({ conversation_id: "c1", message_id: "m1" });
      if (u.endsWith("/messages/m1")) return res({ status: "COMPLETED", attachments: [QUERY_ATT] });
      if (u.endsWith("/attachments/a1/query-result")) return res(QUERY_RESULT);
      throw new Error(`unexpected ${init?.method} ${u}`);
    }) as unknown as typeof fetch;

    const { askGenie } = await loadGenie();
    const r = await askGenie("worst ICU gaps?");
    expect(r.text).toBe("Bihar has the worst gap.");
    expect(r.conversationId).toBe("c1");
    expect(r.messageId).toBe("m1");
    expect(r.query).toEqual({
      sql: "SELECT state, gap FROM t",
      description: "gaps by state",
      columns: ["state", "gap"],
      rows: [
        { state: "Bihar", gap: "0.19" },
        { state: "Meghalaya", gap: "0.37" },
      ],
    });
  });

  it("returns query=null when Genie attaches only text", async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/start-conversation")) return res({ conversation_id: "c1", message_id: "m1" });
      if (u.endsWith("/messages/m1"))
        return res({ status: "COMPLETED", attachments: [{ text: { content: "ICU means..." } }] });
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { askGenie } = await loadGenie();
    const r = await askGenie("what is an ICU?");
    expect(r.text).toBe("ICU means...");
    expect(r.query).toBeNull();
  });

  it("posts a follow-up turn when given a conversationId", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/conversations/c1/messages")) return res({ conversation_id: "c1", message_id: "m2" });
      if (u.endsWith("/messages/m2")) return res({ status: "COMPLETED", attachments: [{ text: { content: "ok" } }] });
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { askGenie } = await loadGenie();
    const r = await askGenie("and Bihar?", "c1");
    expect(r.messageId).toBe("m2");
    expect(calls.some((u) => u.endsWith("/start-conversation"))).toBe(false);
    expect(calls.some((u) => u.endsWith("/conversations/c1/messages"))).toBe(true);
  });

  it("polls until the message completes", async () => {
    let polls = 0;
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/start-conversation")) return res({ conversation_id: "c1", message_id: "m1" });
      if (u.endsWith("/messages/m1")) {
        polls++;
        return polls < 3
          ? res({ status: "EXECUTING_QUERY" })
          : res({ status: "COMPLETED", attachments: [{ text: { content: "done" } }] });
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { askGenie } = await loadGenie();
    vi.useFakeTimers();
    const p = askGenie("q");
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.text).toBe("done");
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("throws when the message ends in FAILED", async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/start-conversation")) return res({ conversation_id: "c1", message_id: "m1" });
      if (u.endsWith("/messages/m1")) return res({ status: "FAILED" });
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { askGenie } = await loadGenie();
    await expect(askGenie("q")).rejects.toThrow(/did not complete/i);
  });

  it("throws when start returns no conversation/message id", async () => {
    global.fetch = vi.fn(async () => res({})) as unknown as typeof fetch;
    const { askGenie } = await loadGenie();
    await expect(askGenie("q")).rejects.toThrow(/conversation\/message id/i);
  });

  it("surfaces API errors without leaking the bearer token", async () => {
    global.fetch = vi.fn(async () => res({ message: "forbidden" }, false, 403)) as unknown as typeof fetch;
    const { askGenie } = await loadGenie();
    await expect(askGenie("q")).rejects.toThrow(/Genie API 403/);
    await expect(askGenie("q")).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it("fails closed when env is not configured", async () => {
    delete process.env.DATABRICKS_GENIE_SPACE_ID;
    const { askGenie } = await loadGenie();
    await expect(askGenie("q")).rejects.toThrow(/not configured/i);
  });

  it("rejects an empty question", async () => {
    const { askGenie } = await loadGenie();
    await expect(askGenie("   ")).rejects.toThrow(/question required/i);
  });
});
