/* Match page logic (Google Sheets + AI classification).
   - Home page redirects to /match.html?website=...
   - This page shows a 4s loading sequence, then reveals the creator match. */

const SHEET_CONFIG = {
  spreadsheetId: "1QRQ_P3bi5ClIH_aD5ztTbFgxTH8XnypIWnPjsaqJ87Q",
  gid: "0",
};

const CANONICAL_CATEGORIES = [
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

const state = {
  creatorsByCategory: new Map(), // Map<string, Array<Creator>>
  categoriesWithCreators: [],
  sheetIgnoredCount: 0,
};

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sheetGvizUrl({ spreadsheetId, gid }) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(
    gid
  )}`;
}

function sheetCsvUrl({ spreadsheetId, gid }) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(
    gid
  )}`;
}

function toTitleCase(label) {
  return String(label || "")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function normalizeCategoryLabel(label) {
  return toTitleCase(label).trim();
}

function normalizeToCanonicalCategory(rawLabel) {
  const label = normalizeCategoryLabel(rawLabel);
  const key = label.toLowerCase();

  for (const c of CANONICAL_CATEGORIES) {
    if (key === c.toLowerCase()) return c;
  }

  const map = [
    { to: "Games", from: ["game", "games", "gaming", "video games", "esports"] },
    { to: "Social", from: ["social", "community", "messaging", "chat"] },
    { to: "Entertainment", from: ["entertainment", "media", "music", "video", "streaming"] },
    { to: "Productivity", from: ["productivity", "tools", "workspace", "notes", "calendar", "tasks"] },
    { to: "Lifestyle", from: ["lifestyle", "home", "shopping", "dating"] },
    { to: "Health & Fitness", from: ["health", "fitness", "wellness", "workout", "gym", "nutrition"] },
    { to: "Education", from: ["education", "learning", "course", "school", "training"] },
    { to: "Business", from: ["business", "b2b", "enterprise", "crm", "sales", "marketing"] },
    { to: "Finance", from: ["finance", "fintech", "bank", "banking", "payments", "wallet", "credit", "investing"] },
    { to: "Utilities", from: ["utilities", "utility", "security", "vpn", "scanner", "file", "storage"] },
  ];

  for (const entry of map) {
    for (const k of entry.from) {
      if (key === k || key.includes(k)) return entry.to;
    }
  }

  return null;
}

function normalizeRowKey(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
}

function safeNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function parseGvizResponse(text) {
  const marker = "google.visualization.Query.setResponse(";
  const start = text.indexOf(marker);
  if (start === -1) throw new Error("Unexpected gviz response");
  const jsonStart = start + marker.length;
  const jsonEnd = text.lastIndexOf(");");
  if (jsonEnd === -1) throw new Error("Unexpected gviz response");
  return JSON.parse(text.slice(jsonStart, jsonEnd));
}

function rowsFromGviz(json) {
  const table = json && json.table;
  if (!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) {
    throw new Error("Invalid gviz table");
  }

  const labels = table.cols.map((c) => normalizeRowKey(c.label || c.id || ""));
  const idx = {
    creator: labels.indexOf("creator"),
    category: labels.indexOf("category"),
    photo: labels.indexOf("photo"),
    price: labels.indexOf("price"),
  };
  if (idx.creator === -1 || idx.category === -1) {
    throw new Error("Sheet must have columns: Creator, Category (and optionally Photo, Price)");
  }

  const creators = [];
  for (const r of table.rows) {
    const cells = (r && r.c) || [];
    const name = String(cells[idx.creator]?.v ?? "").trim();
    const category = String(cells[idx.category]?.v ?? "").trim();
    const photoUrl = idx.photo !== -1 ? String(cells[idx.photo]?.v ?? "").trim() : "";
    const price = idx.price !== -1 ? safeNumber(cells[idx.price]?.v) : null;
    if (!name || !category) continue;

    creators.push({
      name,
      category: normalizeCategoryLabel(category),
      photoUrl: photoUrl || null,
      price,
    });
  }
  return creators;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\r" && next === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

function creatorsFromCsvRows(rows) {
  if (!rows || rows.length < 2) throw new Error("CSV appears empty");
  const headers = rows[0].map((h) => normalizeRowKey(h));
  const idx = {
    creator: headers.indexOf("creator"),
    category: headers.indexOf("category"),
    photo: headers.indexOf("photo"),
    price: headers.indexOf("price"),
  };
  if (idx.creator === -1 || idx.category === -1) {
    throw new Error("Sheet must have columns: Creator, Category (and optionally Photo, Price)");
  }

  const creators = [];
  for (const r of rows.slice(1)) {
    const name = String(r[idx.creator] || "").trim();
    const category = String(r[idx.category] || "").trim();
    const photoUrl = idx.photo !== -1 ? String(r[idx.photo] || "").trim() : "";
    const price = idx.price !== -1 ? safeNumber(r[idx.price]) : null;
    if (!name || !category) continue;
    creators.push({ name, category: normalizeCategoryLabel(category), photoUrl: photoUrl || null, price });
  }
  return creators;
}

async function loadCreatorsFromSheet() {
  const urls = [sheetGvizUrl(SHEET_CONFIG), sheetCsvUrl(SHEET_CONFIG)];
  let lastErr = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const text = await res.text();
      if (url.includes("/gviz/")) return rowsFromGviz(parseGvizResponse(text));
      return creatorsFromCsvRows(parseCsv(text));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Failed to load sheet");
}

function setCategoriesSelectOptions(categories) {
  const select = $("categorySelect");
  select.innerHTML = "";
  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
}

function setStateCreatorsFromList(creators) {
  let ignored = 0;
  const map = new Map();

  for (const c of creators) {
    const canonical = normalizeToCanonicalCategory(c.category);
    if (!canonical) {
      ignored += 1;
      continue;
    }
    if (!map.has(canonical)) map.set(canonical, []);
    map.get(canonical).push({ ...c, category: canonical });
  }

  state.sheetIgnoredCount = ignored;
  state.creatorsByCategory = map;
  state.categoriesWithCreators = CANONICAL_CATEGORIES.filter((c) => (map.get(c) || []).length);
  setCategoriesSelectOptions(state.categoriesWithCreators.length ? state.categoriesWithCreators : CANONICAL_CATEGORIES);
}

async function classifyWebsiteCategory(url) {
  const res = await fetch(`/api/classify?url=${encodeURIComponent(url.href)}`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Classifier failed (${res.status})`);
  }

  const data = await res.json();
  const category = normalizeToCanonicalCategory(data.category) || null;
  const confidence = typeof data.confidence === "number" ? data.confidence : 0.6;
  if (!category) throw new Error("Classifier returned an unknown category");
  return { category, confidence };
}

function pickCreator(category, seedText) {
  const list = state.creatorsByCategory.get(category) || [];
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) >>> 0;
  const idx = list.length ? h % list.length : 0;
  return list[idx] || null;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatOutreach({ brandHost, categoryLabel, creatorName }) {
  return [
    `Hi ${creatorName}!`,
    "",
    `I’m reaching out from ${brandHost}. We’re in ${categoryLabel} and I think your audience is a strong fit.`,
    "Would you be open to a quick collaboration idea?",
    "",
    "If yes, what are your rates and availability for the next 2 weeks?",
    "",
    "Thanks!",
    "—",
  ].join("\n");
}

function renderMatch({ url, inferredCategory, confidence, creator }) {
  const categoryLabel = inferredCategory;
  const confidenceLabel = confidence >= 0.75 ? "High" : confidence >= 0.55 ? "Medium" : "Low";

  const brandHost = url.hostname.replace(/^www\./, "");
  const outreach = formatOutreach({
    brandHost,
    categoryLabel,
    creatorName: creator.name.split(" ")[0],
  });

  const priceText = creator.price !== null && creator.price !== undefined ? `$${creator.price}` : "—";
  const photoHtml = creator.photoUrl
    ? `<div class="photo-wrap" aria-label="Creator photo"><img class="creator-photo" src="${escapeHtml(
        creator.photoUrl
      )}" alt="${escapeHtml(creator.name)}" loading="lazy" /></div>`
    : "";

  return `
    <div class="card" role="region" aria-label="Creator match result">
      <div class="card-top">
        <div class="avatar" aria-hidden="true">${escapeHtml(initials(creator.name))}</div>
        <div>
          <div class="name">${escapeHtml(creator.name)}</div>
          <div class="meta">Category: ${escapeHtml(categoryLabel)}</div>
        </div>
        <div class="tag" title="Match confidence">Match (${escapeHtml(confidenceLabel)})</div>
      </div>

      <div class="card-body">
        Recommended creator for <strong>${escapeHtml(categoryLabel)}</strong>.
      </div>

      ${photoHtml}

      <div class="stats" aria-label="Stats">
        <div class="stat">
          <div class="stat-label">Price</div>
          <div class="stat-value">${escapeHtml(priceText)}</div>
        </div>
      </div>

      <textarea class="sr-only" aria-hidden="true" tabindex="-1" data-outreach>${escapeHtml(outreach)}</textarea>
    </div>
  `;
}

function setResults(html) {
  $("results").innerHTML = html || "";
}

function showFallback(show) {
  $("categoryFallback").hidden = !show;
}

function hideLoader() {
  $("loader").hidden = true;
}

function setLoader(step, title, subtitle) {
  $("loaderTitle").textContent = title;
  $("loaderSubtitle").textContent = subtitle;
  $("step1").classList.toggle("active", step === 1);
  $("step2").classList.toggle("active", step === 2);
  $("step3").classList.toggle("active", step === 3);
}

function getWebsiteFromQuery() {
  const u = new URL(window.location.href);
  const raw = u.searchParams.get("website");
  if (!raw) return null;
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(withScheme);
  } catch {
    return null;
  }
}

async function runMatchPage() {
  // If we’re not on match.html (or missing elements), do nothing.
  const hasMatchUi = document.getElementById("loader") && document.getElementById("results");
  if (!hasMatchUi) return;

  const websiteUrl = getWebsiteFromQuery();
  if (!websiteUrl) {
    hideLoader();
    setResults(
      `<div class="card"><div class="name">Missing website URL</div><div class="meta">Go back and enter your website.</div><div class="cta-row" style="margin-top:12px"><a class="link-btn primary" href="./index.html">Back to home</a></div></div>`
    );
    return;
  }

  $("websiteLabel").textContent = websiteUrl.hostname.replace(/^www\./, "");

  // Start the 4s loading sequence (even if the network work finishes early).
  const minDelay = delay(4000);
  setLoader(1, "Categorizing your website…", "Reading public signals from your homepage.");
  setTimeout(() => setLoader(2, "Finding the right creators…", "Filtering your creator database."), 1600);
  setTimeout(() => setLoader(3, "Finalizing your match…", "Preparing your recommended creator."), 3000);

  // Do real work in parallel.
  const creatorsPromise = loadCreatorsFromSheet().then((creators) => {
    if (!creators.length) throw new Error("No creators found in the sheet");
    setStateCreatorsFromList(creators);
    return creators;
  });

  const classifyPromise = classifyWebsiteCategory(websiteUrl);

  try {
    const [, classified] = await Promise.all([creatorsPromise, classifyPromise]);
    const category = classified.category;
    const confidence = classified.confidence;

    const seed = `${websiteUrl.hostname}${websiteUrl.pathname}${websiteUrl.search}`.toLowerCase();
    const creator = pickCreator(category, seed);

    await minDelay;
    hideLoader();

    if (!creator) {
      setResults(
        `<div class="card"><div class="name">No creators found for ${escapeHtml(
          category
        )}</div><div class="meta">Pick another category below, or add creators in that category to the sheet.</div></div>`
      );
      showFallback(true);
      $("categorySelect").value = state.categoriesWithCreators[0] || "Lifestyle";
      return;
    }

    setResults(
      renderMatch({
        url: websiteUrl,
        inferredCategory: category,
        confidence,
        creator,
      })
    );

    // If confidence is low, offer refinement.
    if (confidence < 0.55) {
      showFallback(true);
      $("categorySelect").value = category;
    }
  } catch (e) {
    await minDelay;
    hideLoader();
    setResults(
      `<div class="card"><div class="name">We couldn’t complete the match</div><div class="meta">Check that the sheet is accessible and your server is running.</div><div class="help" style="margin-top:10px">${escapeHtml(
        e && e.message ? e.message : "Unknown error"
      )}</div><div class="cta-row" style="margin-top:12px"><a class="link-btn primary" href="./index.html">Try again</a></div></div>`
    );
    showFallback(true);
    $("categorySelect").value = CANONICAL_CATEGORIES[0];
  }
}

function setupInteractions() {
  if (!document.getElementById("results")) return;

  $("refineBtn").addEventListener("click", () => {
    const category = $("categorySelect").value;
    const websiteUrl = getWebsiteFromQuery();
    if (!websiteUrl) return;

    const seed = `${websiteUrl.hostname}${websiteUrl.pathname}${websiteUrl.search}`.toLowerCase();
    const creator = pickCreator(category, seed);
    if (!creator) {
      setResults(
        `<div class="card"><div class="name">No creators found for ${escapeHtml(
          category
        )}</div><div class="meta">Add at least one creator in that category to the sheet.</div></div>`
      );
      return;
    }

    hideLoader();
    showFallback(false);
    setResults(renderMatch({ url: websiteUrl, inferredCategory: category, confidence: 0.85, creator }));
  });

  // Delegate clicks for copy button within results.
  $("results").addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-copy-outreach]") : null;
    if (!btn) return;

    const ta = $("results").querySelector("[data-outreach]");
    const text = ta ? ta.value : "";
    if (!text) return;

    async function copyText(textToCopy) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(textToCopy);
        return true;
      }
      return false;
    }

    function legacyCopyText(textToCopy) {
      const tmp = document.createElement("textarea");
      tmp.value = textToCopy;
      tmp.setAttribute("readonly", "true");
      tmp.style.position = "fixed";
      tmp.style.top = "-9999px";
      tmp.style.left = "-9999px";
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        document.body.removeChild(tmp);
      }
    }

    try {
      const ok = await copyText(text);
      if (!ok && !legacyCopyText(text)) throw new Error("Copy failed");
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = "Copy outreach message";
      }, 1200);
    } catch {
      ta.classList.remove("sr-only");
      ta.setAttribute("aria-hidden", "false");
      ta.tabIndex = 0;
      ta.focus();
      ta.select();
      btn.textContent = "Select & copy";
    }
  });
}

setupInteractions();
// eslint-disable-next-line no-void
void runMatchPage();
