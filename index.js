const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { LRUCache } = require("lru-cache");
const axios = require("axios");

// -------------------- CONFIG --------------------
const TORRENTIO_BASE_URL = "https://torrentio.strem.fun";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

const cache = new LRUCache({
  max: 500,
  ttl: CACHE_TTL_MS,
});

// -------------------- HELPERS --------------------
function getResolution(text = "") {
  const t = String(text).toLowerCase();
  if (t.includes("2160p") || t.includes("4k")) return "2160p";
  if (t.includes("1080p")) return "1080p";
  if (t.includes("720p")) return "720p";
  return "Unknown";
}

function getSeeders(text = "") {
  // Torrentio de obicei pune: "👤123"
  const m = String(text).match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSizeMB(text = "") {
  // Unele stream-uri au în title/desc: "💾 1.4 GB" / "700 MB"
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (!Number.isFinite(num)) return null;
  return unit === "GB" ? num * 1024 : num;
}

function pickBestStream(streams, cfg) {
  const preferredResolution = cfg.preferredResolution || "720p";

  const minSeeders720 = Number(cfg.minSeeders720 ?? 30);
  const maxSizeMB720 = Number(cfg.maxSizeMB720 ?? 800);

  const minSeeders1080 = Number(cfg.minSeeders1080 ?? 50);
  const maxSizeMB1080 = Number(cfg.maxSizeMB1080 ?? 1500);

  const enriched = (streams || []).map((s) => {
    const title = `${s.name || ""} ${s.title || ""} ${s.description || ""}`;
    return {
      raw: s,
      title,
      res: getResolution(title),
      seeders: getSeeders(title),
      sizeMB: parseSizeMB(title), // can be null
    };
  });

  // Preferință: 720p OK -> 1080p OK -> fallback pe rezoluția preferată -> orice
  const ok720 = enriched.filter((x) => {
    if (x.res !== "720p") return false;
    if (x.seeders < minSeeders720) return false;
    // dacă nu avem size, nu-l descalificăm; îl punem mai jos ca scor
    if (x.sizeMB != null && x.sizeMB > maxSizeMB720) return false;
    return true;
  });

  const ok1080 = enriched.filter((x) => {
    if (x.res !== "1080p") return false;
    if (x.seeders < minSeeders1080) return false;
    if (x.sizeMB != null && x.sizeMB > maxSizeMB1080) return false;
    return true;
  });

  function score(x) {
    // seeders mult = bine
    // size mai mic (dacă există) = puțin mai bine
    const seedScore = x.seeders;
    const sizePenalty = x.sizeMB == null ? 0 : Math.min(200, x.sizeMB / 10);
    // preferăm să avem size cunoscut (mic bonus)
    const knownSizeBonus = x.sizeMB == null ? 0 : 10;
    return seedScore + knownSizeBonus - sizePenalty;
  }

  function bestOf(arr) {
    return arr.sort((a, b) => score(b) - score(a))[0] || null;
  }

  let chosen = null;

  if (preferredResolution === "720p") {
    chosen = bestOf(ok720) || bestOf(ok1080);
  } else if (preferredResolution === "1080p") {
    chosen = bestOf(ok1080) || bestOf(ok720);
  } else if (preferredResolution === "2160p") {
    const ok2160 = enriched.filter((x) => x.res === "2160p");
    chosen = bestOf(ok2160) || bestOf(ok1080) || bestOf(ok720);
  } else {
    // Any
    chosen = bestOf(ok720) || bestOf(ok1080) || bestOf(enriched);
  }

  return chosen ? chosen.raw : null;
}

// -------------------- MANIFEST (CONFIG IN STREMIO UI) --------------------
const manifest = {
  id: "org.alexsdev.smartautoplay",
  version: "1.2.4",
  name: "SmarT-Autoplay",
  description: "Finds best source for movies and TV shows",
  logo: "https://raw.githubusercontent.com/stakepit/smart-torrentio-picker/main/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],

  behaviorHints: {
    configurable: true,
  },

  // Asta e meniul din Stremio (gear)
  config: [
    {
      key: "preferredResolution",
      type: "select",
      title: "Preferred resolution",
      options: ["720p", "1080p", "2160p", "Any"],
      default: "720p",
      required: true,
    },
    { key: "minSeeders720", type: "number", title: "Min seeders (720p)", default: 30, required: true },
    { key: "maxSizeMB720", type: "number", title: "Max size MB (720p)", default: 800, required: true },

    { key: "minSeeders1080", type: "number", title: "Min seeders (1080p)", default: 50, required: true },
    { key: "maxSizeMB1080", type: "number", title: "Max size MB (1080p)", default: 1500, required: true },
  ],
};

const addon = new addonBuilder(manifest);

// -------------------- STREAM HANDLER --------------------
addon.defineStreamHandler(async ({ type, id, config }) => {
  const cacheKey = JSON.stringify({ type, id, config: config || {} });

  if (cache.has(cacheKey)) {
    return { streams: cache.get(cacheKey) };
  }

  let torrentioStreams = [];
  try {
    const url = `${TORRENTIO_BASE_URL}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    const resp = await axios.get(url, { timeout: 15000 });
    torrentioStreams = resp.data?.streams || [];
  } catch (e) {
    console.error("Torrentio fetch error:", e.message);
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  if (!torrentioStreams.length) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  const best = pickBestStream(torrentioStreams, config || {});
  if (!best) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  // IMPORTANT:
  // 1) Returnăm UN SINGUR stream => doar o opțiune în Sources
  // 2) immediatePlay e doar “hint”. Unele clients NU autoplay 100%.
  const one = [{
    ...best,
    name: `SmarT-Autoplay • ${best.name || best.title || ""}`,
    behaviorHints: {
      ...(best.behaviorHints || {}),
      immediatePlay: true,
    }
  }];

  cache.set(cacheKey, one);
  return { streams: one };
});

// -------------------- SERVER --------------------
serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
