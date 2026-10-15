const ipaddr = require("ipaddr.js");

const MAX_REDIRECTS = 8;
const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

async function assertPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "metadata.google.internal") {
    throw new Error("Host lokal atau internal diblokir.");
  }

  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new Error("Alamat IP privat atau khusus diblokir.");
    return;
  }

  const dns = require("node:dns").promises;
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Nama host tidak dapat diverifikasi.");
  }
  if (!records.length || records.some(record => !isPublicAddress(record.address))) {
    throw new Error("Host mengarah ke alamat privat atau tidak aman.");
  }
}

function validateUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("URL tidak valid."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Hanya HTTP/HTTPS yang diizinkan.");
  if (url.username || url.password) throw new Error("URL yang berisi kredensial ditolak.");
  if (!url.hostname) throw new Error("Host URL tidak ditemukan.");
  return url;
}

function extractRedirectParam(url) {
  for (const key of ["url", "target", "dest", "destination", "redirect", "redirect_url",
    "redirect_uri", "to", "out", "link", "r", "u"]) {
    const value = url.searchParams.get(key);
    if (value && /^https?:\/\//i.test(value.trim())) {
      try { return validateUrl(value.trim()).href; } catch {}
    }
  }
  return null;
}

async function readLimitedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); break; }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function requestOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url.href, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "NgebypassResolver/1.0",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Gunakan metode POST." });
  }

  const started = Date.now();
  try {
    const raw = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!raw || raw.length > 2048) throw new Error("Masukkan URL dengan panjang maksimal 2048 karakter.");

    let current = validateUrl(raw);
    const seen = new Set();
    let redirects = 0;
    let finalUrl = null;
    let method = "http_redirect";

    for (let step = 0; step <= MAX_REDIRECTS; step++) {
      if (seen.has(current.href)) throw new Error("Loop pengalihan terdeteksi.");
      seen.add(current.href);
      await assertPublicHost(current.hostname);

      const parameterUrl = extractRedirectParam(current);
      if (parameterUrl) {
        const candidate = validateUrl(parameterUrl);
        await assertPublicHost(candidate.hostname);
        finalUrl = candidate.href;
        method = "redirect_parameter";
        break;
      }

      const response = await requestOnce(current);
      if (REDIRECT_CODES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Server memberi status redirect tanpa header Location.");
        if (step === MAX_REDIRECTS) throw new Error("Batas pengalihan tercapai.");
        current = validateUrl(new URL(location, current).href);
        redirects++;
        continue;
      }

      if (!response.ok) throw new Error(`Server perantara merespons HTTP ${response.status}.`);

      const contentType = response.headers.get("content-type") || "";
      if (/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
        const body = await readLimitedText(response);
        const patterns = [
          /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"' >]+)[^"']*["']/i,
          /(?:window\.location(?:\.href)?|location\.href)\s*=\s*["'](https?:\/\/[^"']+)["']/i
        ];
        for (const pattern of patterns) {
          const match = body.match(pattern);
          if (!match?.[1]) continue;
          try {
            const candidate = validateUrl(new URL(match[1].replace(/&amp;/g, "&"), current).href);
            await assertPublicHost(candidate.hostname);
            finalUrl = candidate.href;
            method = "literal_page_url";
            break;
          } catch {}
        }
      }

      if (!finalUrl) {
        throw new Error("URL tujuan belum ditemukan. Halaman mungkin membutuhkan timer, JavaScript, token, atau mekanisme yang tidak tersedia.");
      }
      break;
    }

    if (!finalUrl) throw new Error("URL tujuan tidak berhasil diverifikasi.");
    return json(res, 200, { ok: true, destination: finalUrl, method, redirects, durationMs: Date.now() - started });
  } catch (error) {
    return json(res, 422, {
      ok: false,
      error: error?.name === "AbortError" ? "Permintaan melewati batas waktu." : (error?.message || "Pemeriksaan gagal."),
      durationMs: Date.now() - started
    });
  }
};
