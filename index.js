const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { LRUCache } = require("lru-cache");
const axios = require("axios");

// ====== CONFIG DEFAULTS ======
const DEFAULTS = {
  preferredResolution: "720p", // 720p before 1080p
  minSeeders720: 30,
  maxSizeMB720: 800,
  minSeeders1080: 50,
  maxSizeMB1080: 1500,
};

const TORRENTIO_BASE_URL = "https://torrentio.strem.fun";
const CACHE_TTL = 60 * 60 * 1000;

// ====== CACHE ======
const cache = new LRUCache({
  max: 500,
  ttl: CACHE_TTL,
  allowStale: false,
});

// ====== HELPERS ======
function getResolution(text = "") {
  const t = text.toLowerCase();
  if (t.includes("2160p") || t.includes("4k")) return "2160p";
  if (t.includes("1080p")) return "1080p";
  if (t.includes("720p")) return "720p";
  return "Unknown";
}

function getSeeders(text = "") {
  // Torrentio often has "👤123" in the title/name
  const m = text.match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSizeMB(text = "") {
  // Many streams include size like "1.4 GB" or "700 MB" in title
  const m = text.match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (!Number.isFinite(num)) return null;
  return unit === "GB" ? num * 1024 : num;
}

function normalizeConfig(cfg = {}) {
  return {
    preferredResolution: cfg.preferredResolution || DEFAULTS.preferredResolution,
    minSeeders720: Number(cfg.minSeeders720 ?? DEFAULTS.minSeeders720),
    maxSizeMB720: Number(cfg.maxSizeMB720 ?? DEFAULTS.maxSizeMB720),
    minSeeders1080: Number(cfg.minSeeders1080 ?? DEFAULTS.minSeeders1080),
    maxSizeMB1080: Number(cfg.maxSizeMB1080 ?? DEFAULTS.maxSizeMB1080),
  };
}

function pickBestStream(streams, cfg) {
  const c = normalizeConfig(cfg);

  const enriched = streams.map((s) => {
    const title = String(s.title || s.name || "");
    return {
      raw: s,
      title,
      res: getResolution(title),
      seeders: getSeeders(title),
      sizeMB: parseSizeMB(title), // may be null
    };
  });

  // helper: accept size only if known OR unknown (unknown = allowed but ranked lower)
  const okSize = (x, maxMB) => x.sizeMB == null ? true : x.sizeMB <= maxMB;

  // 1) strict 720p rule
  const candidates720 = enriched
    .filter(x =>
      x.res === "720p" &&
      x.seeders >= c.minSeeders720 &&
      okSize(x, c.maxSizeMB720)
    )
    .sort((a, b) => (b.seeders - a.seeders) || ((a.sizeMB ?? 1e9) - (b.sizeMB ?? 1e9)));

  if (candidates720.length) return candidates720[0].raw;

  // 2) strict 1080p rule
  const candidates1080 = enriched
    .filter(x =>
      x.res === "1080p" &&
      x.seeders >= c.minSeeders1080 &&
      okSize(x, c.maxSizeMB1080)
    )
    .sort((a, b) => (b.seeders - a.seeders) || ((a.sizeMB ?? 1e9) - (b.sizeMB ?? 1e9)));

  if (candidates1080.length) return candidates1080[0].raw;

  // 3) fallback: best by resolution preference then seeders
  const order = c.preferredResolution === "1080p"
    ? ["1080p", "720p", "2160p", "Unknown"]
    : ["720p", "1080p", "2160p", "Unknown"];

  for (const r of order) {
    const group = enriched.filter(x => x.res === r).sort((a, b) => b.seeders - a.seeders);
    if (group.length) return group[0].raw;
  }

  return streams[0] || null;
}

// ====== MANIFEST ======
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
    configurable: true,          // <-- this makes the gear appear (clients that support it)
    configurationRequired: false
  },
};

// Stremio config page fields (opens /configure on your domain)
manifest.config = [
  {
    key: "preferredResolution",
    type: "select",
    title: "Preferred resolution",
    options: ["720p", "1080p"],
    default: DEFAULTS.preferredResolution,
    required: true,
  },
  {
    key: "minSeeders720",
    type: "number",
    title: "Min seeders for 720p",
    default: DEFAULTS.minSeeders720,
    required: true,
  },
  {
    key: "maxSizeMB720",
    type: "number",
    title: "Max size (MB) for 720p",
    default: DEFAULTS.maxSizeMB720,
    required: true,
  },
  {
    key: "minSeeders1080",
    type: "number",
    title: "Min seeders for 1080p",
    default: DEFAULTS.minSeeders1080,
    required: true,
  },
  {
    key: "maxSizeMB1080",
    type: "number",
    title: "Max size (MB) for 1080p",
    default: DEFAULTS.maxSizeMB1080,
    required: true,
  },
];

const addon = new addonBuilder(manifest);

addon.defineStreamHandler(async ({ type, id, config }) => {
  const cfg = normalizeConfig(config);
  const cacheKey = JSON.stringify({ type, id, cfg });

  if (cache.has(cacheKey)) {
    return { streams: cache.get(cacheKey) };
  }

  try {
    const url = `${TORRENTIO_BASE_URL}/stream/${type}/${id}.json`;
    const resp = await axios.get(url, { timeout: 15000 });
    const streams = resp.data?.streams || [];

    if (!streams.length) {
      cache.set(cacheKey, []);
      return { streams: [] };
    }

    const best = pickBestStream(streams, cfg);
    if (!best) {
      cache.set(cacheKey, []);
      return { streams: [] };
    }

    // IMPORTANT: return ONLY ONE stream => single option in Sources
    // behaviorHints are optional; bingeGroup helps episodes
    const one = [{
  ...best,
  name: "SmarT-Autoplay",
  title: best.title || best.name || "Best pick",
  behaviorHints: {
    ...(best.behaviorHints || {}),
    immediatePlay: true,     // 🔥 AUTOPLAY HINT
    bingeGroup: `${id}`,     // ajută pentru episoade
  }
  }];

serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
