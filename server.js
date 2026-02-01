// Minimal local server:
// - Serves this folder as a static site
// - Adds /api/classify?url=... which uses OpenAI (ChatGPT) to classify the site into a category
//
// Setup (PowerShell):
//   $env:OPENAI_API_KEY="sk-..."
//   node server.js
//
// Then open:
//   http://localhost:5173

const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
loadDotEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 5173);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const CATEGORIES = [
  "Games",
  "Social",
  "Entertainment",
  "Productivity",
  "Lifestyle",
  "Health & Fitness",
  "Education",
  "Business",
  "Finance",
  "Utilities",
];

function loadDotEnv(dotenvPath) {
  try {
    if (!fsSync.existsSync(dotenvPath)) return;
    const raw = fsSync.readFileSync(dotenvPath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();

      // Strip optional quotes.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Don’t override existing env vars.
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Ignore .env parsing failures.
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, { "content-type": "application/json; charset=utf-8" }, JSON.stringify(obj));
}

function notFound(res) {
  send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function serverError(res, message) {
  sendJson(res, 500, { error: message });
}

function safeFilePath(urlPath) {
  const raw = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(ROOT, raw);
  const normalizedRoot = path.resolve(ROOT);
  const normalizedFile = path.resolve(filePath);
  if (!normalizedFile.startsWith(normalizedRoot)) return null;
  return normalizedFile;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function extractWebsiteSnippet(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replaceAll(/\s+/g, " ").trim() : "";

  const descMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  const description = descMatch ? String(descMatch[1] || "").replaceAll(/\s+/g, " ").trim() : "";

  // Remove scripts/styles and tags (best-effort).
  let text = html
    .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replaceAll(/<\/?[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

  // Keep it small.
  if (text.length > 7000) text = text.slice(0, 7000);
  return { title, description, text };
}

async function fetchWebsiteHtml(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "BrandMarketplaceClassifier/1.0 (+https://localhost) Node fetch",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`Website fetch failed (${res.status})`);
    const html = await res.text();
    return html.slice(0, 150_000);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonFromText(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Model did not return JSON");
  const jsonStr = text.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

function normalizeCategory(label) {
  const l = String(label || "").trim().toLowerCase();
  for (const c of CATEGORIES) {
    if (c.toLowerCase() === l) return c;
  }
  // light normalization for common variants
  if (l === "health" || l === "fitness" || l === "health and fitness") return "Health & Fitness";
  if (l === "fintech" || l === "banking") return "Finance";
  if (l === "game" || l === "gaming") return "Games";
  return null;
}

async function classifyWithOpenAI({ websiteUrl, title, description, text }) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const system = [
    "You are a strict website classifier.",
    "Return ONLY valid JSON (no markdown, no code fences).",
    "Choose exactly one category from this list:",
    CATEGORIES.map((c) => `- ${c}`).join("\n"),
    "",
    "Output JSON schema:",
    '{ "category": "<one of the categories>", "confidence": <number 0..1>, "reason": "<short reason>" }',
  ].join("\n");

  const user = [
    `Website URL: ${websiteUrl}`,
    "",
    `Title: ${title || "(none)"}`,
    `Meta description: ${description || "(none)"}`,
    "",
    "Homepage text sample:",
    text ? text : "(no text)",
  ].join("\n");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`OpenAI error (${resp.status}): ${msg || "request failed"}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonFromText(String(content));
  const cat = normalizeCategory(parsed.category);
  const confidence = Number(parsed.confidence);
  const reason = String(parsed.reason || "").trim();

  if (!cat) throw new Error("Model returned an invalid category");
  return {
    category: cat,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
    reason: reason || "Classified by site signals",
  };
}

async function handleClassify(req, res, u) {
  const rawUrl = u.searchParams.get("url");
  if (!rawUrl) return badRequest(res, "Missing ?url=");

  let websiteUrl;
  try {
    websiteUrl = new URL(rawUrl);
  } catch {
    return badRequest(res, "Invalid url");
  }
  if (!["http:", "https:"].includes(websiteUrl.protocol)) {
    return badRequest(res, "URL must start with http:// or https://");
  }

  try {
    const html = await fetchWebsiteHtml(websiteUrl.href);
    const snippet = extractWebsiteSnippet(html);
    const result = await classifyWithOpenAI({
      websiteUrl: websiteUrl.href,
      title: snippet.title,
      description: snippet.description,
      text: snippet.text,
    });
    return sendJson(res, 200, result);
  } catch (e) {
    const msg = e && e.message ? e.message : "Classification failed";
    return serverError(res, msg);
  }
}

async function handleStatic(req, res, u) {
  const filePath = safeFilePath(u.pathname);
  if (!filePath) return notFound(res);

  try {
    const buf = await fs.readFile(filePath);
    return send(res, 200, { "content-type": contentTypeFor(filePath) }, buf);
  } catch {
    return notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname === "/api/classify") {
    if (req.method !== "GET") return badRequest(res, "Use GET");
    return handleClassify(req, res, u);
  }

  if (u.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  return handleStatic(req, res, u);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    // eslint-disable-next-line no-console
    console.log("WARNING: OPENAI_API_KEY is not set. /api/classify will fail until you set it.");
  }
});

