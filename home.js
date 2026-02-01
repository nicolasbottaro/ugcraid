function normalizeWebsiteInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, reason: "Please enter your website URL." };

  const withScheme = value.includes("://") ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname || url.hostname.includes(" ")) {
      return { ok: false, reason: "That URL doesn’t look valid. Try something like https://yourbrand.com" };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, reason: "That URL doesn’t look valid. Try something like https://yourbrand.com" };
  }
}

function setupHome() {
  const form = document.getElementById("homeForm");
  const input = document.getElementById("website");
  const error = document.getElementById("websiteError");

  if (!form || !input || !error) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    error.textContent = "";

    const normalized = normalizeWebsiteInput(input.value);
    if (!normalized.ok) {
      error.textContent = normalized.reason;
      return;
    }

    const target = `./match.html?website=${encodeURIComponent(normalized.url.href)}`;
    window.location.assign(target);
  });
}

setupHome();

