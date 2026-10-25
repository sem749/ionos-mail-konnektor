// Read-only IMAP MCP server for Claude custom connectors.
// Credentials live only in environment variables on the host; the MCP endpoint
// is protected by a secret token in the URL path (/mcp/<ACCESS_TOKEN>).
import crypto from "node:crypto";
import express from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.PORT || 3000);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_HOST = process.env.IMAP_HOST || "imap.ionos.de";
const DEFAULT_PORT = Number(process.env.IMAP_PORT || 993);

// Accounts: IMAP_USER / IMAP_PASSWORD, plus IMAP_USER_2 / IMAP_PASSWORD_2 ... up to 10.
// Optional per-account IMAP_HOST_n / IMAP_PORT_n override the defaults.
function loadAccounts() {
  const accounts = [];
  for (let i = 1; i <= 10; i++) {
    const sfx = i === 1 ? "" : `_${i}`;
    const user = process.env[`IMAP_USER${sfx}`] || (i === 1 ? process.env.IMAP_USER_1 : undefined);
    const pass = process.env[`IMAP_PASSWORD${sfx}`] || (i === 1 ? process.env.IMAP_PASSWORD_1 : undefined);
    if (!user || !pass) continue;
    accounts.push({
      user: user.trim(),
      pass,
      host: process.env[`IMAP_HOST${sfx}`] || DEFAULT_HOST,
      port: Number(process.env[`IMAP_PORT${sfx}`] || DEFAULT_PORT),
    });
  }
  return accounts;
}
const ACCOUNTS = loadAccounts();

function pickAccount(name) {
  if (!ACCOUNTS.length) throw new Error("No mail account configured on the server (IMAP_USER / IMAP_PASSWORD).");
  if (!name) return ACCOUNTS[0];
  const acc = ACCOUNTS.find((a) => a.user.toLowerCase() === name.toLowerCase());
  if (!acc) throw new Error(`Unknown account "${name}". Available: ${ACCOUNTS.map((a) => a.user).join(", ")}`);
  return acc;
}

async function withMailbox(accountName, folder, fn) {
  const acc = pickAccount(accountName);
  const client = new ImapFlow({
    host: acc.host,
    port: acc.port,
    secure: true,
    auth: { user: acc.user, pass: acc.pass },
    logger: false,
  });
  await client.connect();
  try {
    if (folder === null) return await fn(client);
    // readOnly => IMAP EXAMINE: nothing is ever marked read, moved or deleted.
    await client.mailboxOpen(folder || "INBOX", { readOnly: true });
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

const fmtAddr = (list) =>
  (list || []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");

function summarize(msg) {
  const e = msg.envelope || {};
  return {
    uid: msg.uid,
    date: e.date ? new Date(e.date).toISOString() : null,
    from: fmtAddr(e.from),
    to: fmtAddr(e.to),
    subject: e.subject || "(kein Betreff)",
    unread: !(msg.flags && msg.flags.has("\\Seen")),
  };
}

async function fetchSummaries(client, uids, limit) {
  const pick = uids.sort((a, b) => b - a).slice(0, limit);
  if (!pick.length) return [];
  const out = [];
  for await (const msg of client.fetch(pick, { uid: true, envelope: true, flags: true }, { uid: true })) {
    out.push(summarize(msg));
  }
  return out.sort((a, b) => b.uid - a.uid);
}

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

function buildServer() {
  const server = new McpServer({ name: "ionos-imap", version: "1.0.0" });
  const account = z.string().optional().describe("Mail address of the account; defaults to the first configured account");
  const folder = z.string().optional().describe('Folder path, default "INBOX"');
  const limit = z.number().int().min(1).max(100).optional().describe("Max results (default 20)");

  server.tool("list_accounts", "List the configured mail accounts.", {}, async () =>
    text(ACCOUNTS.map((a) => ({ account: a.user, host: a.host })))
  );

  server.tool("list_folders", "List all mail folders of an account.", { account }, async (a) =>
    text(
      await withMailbox(a.account, null, async (c) =>
        (await c.list()).map((f) => ({ path: f.path, specialUse: f.specialUse || null }))
      )
    )
  );

  server.tool(
    "list_messages",
    "List the newest messages in a folder (headers only). Read-only.",
    { account, folder, limit, unread_only: z.boolean().optional() },
    async (a) =>
      text(
        await withMailbox(a.account, a.folder, async (c) => {
          const uids = await c.search(a.unread_only ? { seen: false } : { all: true }, { uid: true });
          return fetchSummaries(c, uids || [], a.limit || 20);
        })
      )
  );

  server.tool(
    "search_messages",
    "Search messages in a folder. All given criteria must match. Dates as YYYY-MM-DD.",
    {
      account,
      folder,
      limit,
      text: z.string().optional().describe("Full-text search in headers and body"),
      from: z.string().optional(),
      to: z.string().optional(),
      subject: z.string().optional(),
      since: z.string().optional(),
      before: z.string().optional(),
      unread_only: z.boolean().optional(),
    },
    async (a) =>
      text(
        await withMailbox(a.account, a.folder, async (c) => {
          const q = {};
          if (a.text) q.text = a.text;
          if (a.from) q.from = a.from;
          if (a.to) q.to = a.to;
          if (a.subject) q.subject = a.subject;
          if (a.since) q.since = new Date(a.since);
          if (a.before) q.before = new Date(a.before);
          if (a.unread_only) q.seen = false;
          if (!Object.keys(q).length) q.all = true;
          const uids = await c.search(q, { uid: true });
          return fetchSummaries(c, uids || [], a.limit || 20);
        })
      )
  );

  server.tool(
    "read_message",
    "Read one message by UID (from list/search). Does not mark it as read.",
    { account, folder, uid: z.number().int(), max_chars: z.number().int().min(500).max(200000).optional() },
    async (a) =>
      text(
        await withMailbox(a.account, a.folder, async (c) => {
          const msg = await c.fetchOne(String(a.uid), { uid: true, source: true }, { uid: true });
          if (!msg || !msg.source) throw new Error(`Message ${a.uid} not found`);
          const p = await simpleParser(msg.source);
          let body = p.text || (p.html ? p.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ") : "");
          const max = a.max_chars || 20000;
          const truncated = body.length > max;
          if (truncated) body = body.slice(0, max);
          return {
            uid: a.uid,
            date: p.date ? p.date.toISOString() : null,
            from: p.from?.text || "",
            to: p.to?.text || "",
            cc: p.cc?.text || "",
            subject: p.subject || "",
            attachments: (p.attachments || []).map((x) => ({ filename: x.filename, type: x.contentType, size: x.size })),
            body,
            truncated,
          };
        })
      )
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/", (_req, res) => res.type("text").send("IMAP MCP server is running."));

function tokenOk(t) {
  if (!ACCESS_TOKEN || !t) return false;
  const a = Buffer.from(String(t));
  const b = Buffer.from(ACCESS_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.all("/mcp/:token", async (req, res) => {
  if (!tokenOk(req.params.token)) return res.status(404).send("Not found");
  if (req.method !== "POST") {
    // Stateless server: no SSE stream or session to resume.
    return res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});

if (!ACCESS_TOKEN || ACCESS_TOKEN.length < 24) {
  console.error("ACCESS_TOKEN must be set (at least 24 characters).");
  process.exit(1);
}
app.listen(PORT, () => console.log(`Listening on :${PORT}, ${ACCOUNTS.length} account(s) configured`));
