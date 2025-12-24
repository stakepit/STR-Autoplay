const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { LRUCache } = require("lru-cache");
const axios = require("axios");

// =======================
// Config
// =======================
const TORRENTIO_BASE_URL = "https://torrentio.strem.fun";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

  // IMPORTANT: asta face sa apara rotița Configure
  configurable: true,
  config: [
    {
      key: "preferredResolution",
      type: "select",
      title: "Preferred resolution",
      options: ["Any", "720p", "1080p", "2160p"],
      default: "720p",
      required: true
    },
    {
      key: "maxSizeMB",
      type: "number",
      title: "Max file size (MB)",
      default: 800,
      required: true
    },
    {
      key: "minSeeders",
      type: "number",
      title: "Min seeders",
      default: 30,
      required: true
    }
  ]
};

const addon = new addonBuilder(manifest);

// Defaults (used if user doesn't configure)
const DEFAULTS = {
  preferredResolution: "720p", // your preference
  minSeeders720: 30,
  maxSizeMB720: 800,
  minSeeders1080: 50,
  maxSizeMB1080: 1500,
  showAll: false, // IMPORTANT: autoplay works best when false
};

// =======================
// Cache
// =======================
const cache = new LRUCache({
  max: 500,
  ttl: CACHE_TTL,
  allowStale: false,
});

// =======================
// Helpers
// =======================
function getResolution(text = "") {
  const t = String(text).toLowerCase();
  if (t.includes("2160p") || t.includes("4k")) return "2160p";
  if (t.includes("1080p")) return "1080p";
  if (t.includes("720p")) return "720p";
  return "Unknown";
}

function getSeeders(text = "") {
  const s = String(text);
  // Torrentio often has "👤123" in name
  const m = s.match(/👤\s*(\d+)/);
  if (m) return parseInt(m[1], 10) || 0;

  // fallback patterns
  const m2 = s.match(/seeders?\s*[:\-]?\s*(\d+)/i);
  if (m2) return parseInt(m2[1], 10) || 0;

  return 0;
}

function parseSizeMB(text = "") {
  const s = String(text);
  const m = s.match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  const unit = m[2].toUpperCase();
  return unit === "GB" ? num * 1024 : num;
}

function normalizeConfig(config = {}) {
  // Stremio config values can be strings; normalize them
  const c = { ...DEFAULTS, ...config };

  // Convert to numbers safely
  const toInt = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };

  const toFloat = (v, d) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
  };

  return {
    preferredResolution: c.preferredResolution || DEFAULTS.preferredResolution,
    minSeeders720: toInt(c.minSeeders720, DEFAULTS.minSeeders720),
    maxSizeMB720: toFloat(c.maxSizeMB720, DEFAULTS.maxSizeMB720),
    minSeeders1080: toInt(c.minSeeders1080, DEFAULTS.minSeeders1080),
    maxSizeMB1080: toFloat(c.maxSizeMB1080, DEFAULTS.maxSizeMB1080),
    showAll: c.showAll === true || c.showAll === "true",
  };
}

function scoreStream(enriched, cfg) {
  // Higher score = better
  const { resolution, seeders, sizeMB } = enriched;

  const hasSize = sizeMB !== null;
  const sizePenalty = hasSize ? Math.min(sizeMB / 2000, 1) : 0.3; // unknown size slight penalty

  // priority: 720p rule, then 1080p rule, then fallback by seeders
  let base = 0;

  if (resolution === "720p") {
    // must pass thresholds to get strong score
    if (seeders >= cfg.minSeeders720 && (sizeMB === null || sizeMB <= cfg.maxSizeMB720)) {
      base = 100000;
    } else {
      base = 20000;
    }
  } else if (resolution === "1080p") {
    if (seeders >= cfg.minSeeders1080 && (sizeMB === null || sizeMB <= cfg.maxSizeMB1080)) {
      base = 80000;
    } else {
      base = 15000;
    }
  } else if (resolution === "2160p") {
    base = 10000;
  } else {
    base = 5000;
  }

  // prefer configured resolution slightly
  if (cfg.preferredResolution !== "Any" && resolution === cfg.preferredResolution) base += 5000;

  // seeders is very important
  base += seeders * 50;

  // smaller is slightly better (when we know size)
  base -= Math.floor(sizePenalty * 2000);

  return base;
}

function pickBest(streams, cfg) {
  const enriched = streams.map((s) => {
    const title = String(s.title || "");
    const name = String(s.name || "");
    const text = `${name} ${title}`;
    return {
      s,
      resolution: getResolution(text),
      seeders: getSeeders(text),
      sizeMB: parseSizeMB(text),
    };
  });

  enriched.sort((a, b) => scoreStream(b, cfg) - scoreStream(a, cfg));
  return enriched[0]?.s || null;
}

// =======================
// Manifest (with Configure menu)
// =======================
const manifest = {
  id: "org.alexsdev.smartautoplay",
  version: "1.2.1",
  name: "SmarT-Autoplay",
  description: "Finds best source for movies and TV shows",
  logo: "https://raw.githubusercontent.com/stakepit/smart-torrentio-picker/main/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],

  configurable: true,
  config: [
    {
      key: "preferredResolution",
      type: "select",
      title: "Preferred Resolution",
      options: ["Any", "720p", "1080p", "2160p"],
      default: DEFAULTS.preferredResolution,
      required: true,
    },

    // 720p rules
    { key: "minSeeders720", type: "number", title: "Min Seeders (720p)", default: DEFAULTS.minSeeders720 },
    { key: "maxSizeMB720", type: "number", title: "Max Size MB (720p)", default: DEFAULTS.maxSizeMB720 },

    // 1080p rules
    { key: "minSeeders1080", type: "number", title: "Min Seeders (1080p)", default: DEFAULTS.minSeeders1080 },
    { key: "maxSizeMB1080", type: "number", title: "Max Size MB (1080p)", default: DEFAULTS.maxSizeMB1080 },

    // IMPORTANT for autoplay feel
    {
      key: "showAll",
      type: "checkbox",
      title: "Show all streams (disable for best autoplay behavior)",
      default: DEFAULTS.showAll,
      required: false,
    },
  ],
};

const addon = new addonBuilder(manifest);

// =======================
// Stream handler
// =======================
addon.defineStreamHandler(async ({ type, id, config }) => {
  const cfg = normalizeConfig(config);
  const cacheKey = JSON.stringify({ type, id, cfg });

  if (cache.has(cacheKey)) {
    return { streams: cache.get(cacheKey) };
  }

  // Pull streams from Torrentio engine (you can later replace with your own indexers)
  const torrentioUrl = `${TORRENTIO_BASE_URL}/stream/${type}/${id}.json`;

  let torrentioData;
  try {
    const resp = await axios.get(torrentioUrl, { timeout: 15000 });
    torrentioData = resp.data;
  } catch (e) {
    console.error("Torrentio fetch error:", e?.message || e);
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  const upstreamStreams = Array.isArray(torrentioData?.streams) ? torrentioData.streams : [];
  if (!upstreamStreams.length) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  const best = pickBest(upstreamStreams, cfg);
  if (!best) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  // --- THE “AUTOPLAY FIX” ---
  // Return ONLY ONE stream for best autoplay experience
  // + immediatePlay hint (not all clients respect it, but helps)
  const bestOnly = {
    ...best,
    name: `SmarT-Autoplay | ${best.name || ""}`.trim(),
    behaviorHints: {
      ...(best.behaviorHints || {}),
      immediatePlay: true,
      // bingeGroup helps “next episode” grouping for series clients that support it
      bingeGroup: type === "series" ? id.split(":")[0] || id : undefined,
    },
  };

  const resultStreams = cfg.showAll ? [bestOnly] : [bestOnly];

  cache.set(cacheKey, resultStreams);
  return { streams: resultStreams };
});

// =======================
// Server
// =======================
serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
