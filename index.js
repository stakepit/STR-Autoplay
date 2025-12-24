const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { LRUCache } = require("lru-cache");
const axios = require("axios");

// -------------------- CONSTANTE --------------------
const TORRENTIO_BASE_URL = "https://torrentio.strem.fun";
const CACHE_TTL = 60 * 60 * 1000;

// -------------------- CACHE --------------------
const cache = new LRUCache({
  max: 500,
  ttl: CACHE_TTL,
  allowStale: false,
});

// -------------------- HELPERS --------------------
function getResolution(text = "") {
  const t = text.toLowerCase();
  if (t.includes("2160p") || t.includes("4k")) return "2160p";
  if (t.includes("1080p")) return "1080p";
  if (t.includes("720p")) return "720p";
  return "Unknown";
}

function getSeeders(text = "") {
  // Torrentio pune seeders de obicei în title cu emoji
  const m = text.match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSizeMB(text = "") {
  // Uneori apare în title: "1.4 GB" / "850 MB"
  const m = text.match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (!Number.isFinite(num)) return null;
  return unit === "GB" ? num * 1024 : num;
}

function normalizeConfig(config = {}) {
  // Stremio trimite config ca string-uri uneori
  const out = {};

  out.preferredResolution = config.preferredResolution || "720p";

  out.minSeeders720 = Number(config.minSeeders720 ?? 30);
  out.maxSizeMB720 = Number(config.maxSizeMB720 ?? 800);

  out.minSeeders1080 = Number(config.minSeeders1080 ?? 50);
  out.maxSizeMB1080 = Number(config.maxSizeMB1080 ?? 1500);

  out.onlyOne = (config.onlyOne ?? "true") === "true";
  return out;
}

function pickBestStream(streams, cfg) {
  // IMPORTANT: Torrentio are info în `title` mai mult decât în `name`
  const enriched = streams.map((s) => {
    const title = String(s.title || "");
    return {
      s,
      title,
      resolution: getResolution(title),
      seeders: getSeeders(title),
      sizeMB: parseSizeMB(title), // poate fi null dacă nu există
    };
  });

  // reguli: prefer 720p cu seeders/min și size/max, apoi 1080p, apoi fallback
  const ok720 = enriched
    .filter((x) => x.resolution === "720p")
    .filter((x) => x.seeders >= cfg.minSeeders720)
    .filter((x) => x.sizeMB == null || x.sizeMB <= cfg.maxSizeMB720);

  const ok1080 = enriched
    .filter((x) => x.resolution === "1080p")
    .filter((x) => x.seeders >= cfg.minSeeders1080)
    .filter((x) => x.sizeMB == null || x.sizeMB <= cfg.maxSizeMB1080);

  const sortBySeeders = (arr) =>
    arr.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));

  // Preferred resolution first if possible
  if (cfg.preferredResolution === "720p") {
    if (ok720.length) return sortBySeeders(ok720)[0].s;
    if (ok1080.length) return sortBySeeders(ok1080)[0].s;
  } else if (cfg.preferredResolution === "1080p") {
    if (ok1080.length) return sortBySeeders(ok1080)[0].s;
    if (ok720.length) return sortBySeeders(ok720)[0].s;
  } else if (cfg.preferredResolution === "2160p") {
    // dacă vrei să păstrezi și 2160p, îl poți adăuga similar
    // momentan facem fallback la cele două principale
    if (ok1080.length) return sortBySeeders(ok1080)[0].s;
    if (ok720.length) return sortBySeeders(ok720)[0].s;
  } else {
    // Any
    if (ok720.length) return sortBySeeders(ok720)[0].s;
    if (ok1080.length) return sortBySeeders(ok1080)[0].s;
  }

  // fallback: ia primul cu cei mai mulți seeders din toate
  return sortBySeeders(enriched)[0]?.s || null;
}

// -------------------- MANIFEST (CU ROTIȚA) --------------------
const manifest = {
  id: "org.alexsdev.smartautoplay",
  version: "1.2.2", // IMPORTANT: crește versiunea când schimbi manifestul
  name: "SmarT-Autoplay",
  description: "Finds best source for movies and TV shows",
  logo: "https://raw.githubusercontent.com/stakepit/smart-torrentio-picker/main/logo.png",

  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],

  // ✅ pentru compatibilitate
  configurable: true,

  // ✅ asta face să apară rotița în Stremio
  behaviorHints: {
    configurable: true,
  },

  // ✅ Stremio generează UI de configurare din asta
  config: [
    {
      key: "preferredResolution",
      type: "select",
      title: "Preferred Resolution",
      options: ["720p", "1080p", "Any"],
      default: "720p",
      required: true,
    },
    {
      key: "minSeeders720",
      type: "number",
      title: "Min seeders for 720p",
      default: 30,
      required: true,
    },
    {
      key: "maxSizeMB720",
      type: "number",
      title: "Max size (MB) for 720p",
      default: 800,
      required: true,
    },
    {
      key: "minSeeders1080",
      type: "number",
      title: "Min seeders for 1080p",
      default: 50,
      required: true,
    },
    {
      key: "maxSizeMB1080",
      type: "number",
      title: "Max size (MB) for 1080p",
      default: 1500,
      required: true,
    },
    {
      key: "onlyOne",
      type: "select",
      title: "Show only one stream",
      options: ["true", "false"],
      default: "true",
      required: true,
    },
  ],
};

// -------------------- ADDON --------------------
const addon = new addonBuilder(manifest);

addon.defineStreamHandler(async ({ type, id, config }) => {
  const cfg = normalizeConfig(config);
  const cacheKey = JSON.stringify({ type, id, cfg });

  if (cache.has(cacheKey)) {
    return { streams: cache.get(cacheKey) };
  }

  // call torrentio
  const url = `${TORRENTIO_BASE_URL}/stream/${type}/${id}.json`;

  let torrentioStreams = [];
  try {
    const r = await axios.get(url, { timeout: 15000 });
    torrentioStreams = r.data?.streams || [];
  } catch (e) {
    console.error("Torrentio error:", e.message);
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  if (!torrentioStreams.length) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  const best = pickBestStream(torrentioStreams, cfg);
  if (!best) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  // Returnează 1 singur stream (sau lista completă dacă vrei)
  const streams = cfg.onlyOne
    ? [
        {
          ...best,
          name: "SmarT-Autoplay",
          title: `✅ Best Pick • ${best.title || ""}`,
        },
      ]
    : torrentioStreams;

  cache.set(cacheKey, streams);
  return { streams };
});

// -------------------- SERVER --------------------
serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
