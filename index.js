const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { LRUCache } = require("lru-cache");
const axios = require("axios");

const DEFAULT_RESOLUTION = "720p"; // <- ai zis că vrei 720p prioritar
const CACHE_TTL = 60 * 60 * 1000;
const TORRENTIO_BASE_URL = "https://torrentio.strem.fun";

const cache = new LRUCache({
  max: 500,
  ttl: CACHE_TTL,
});

function getResolution(text) {
  if (!text) return "Unknown";
  if (/(2160p|4k)/i.test(text)) return "2160p";
  if (/1080p/i.test(text)) return "1080p";
  if (/720p/i.test(text)) return "720p";
  return "Unknown";
}

function getSeeders(text) {
  if (!text) return 0;
  // Torrentio folosește de multe ori "👤 123" (cu spațiu) sau "👤123"
  const m = text.match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// dacă nu există size în title, doar estimăm grosier după rezoluție
function getEstimatedSize(text) {
  if (!text) return 1 * 1024 * 1024 * 1024;
  if (/2160p|4k/i.test(text)) return 15 * 1024 * 1024 * 1024;
  if (/1080p/i.test(text)) return 4 * 1024 * 1024 * 1024;
  if (/720p/i.test(text)) return 1.5 * 1024 * 1024 * 1024;
  return 1 * 1024 * 1024 * 1024;
}

function selectBestStream(streams, config) {
  const preferredResolution = config.preferredResolution || DEFAULT_RESOLUTION;
  const order = ["2160p", "1080p", "720p", "Unknown"];

  const enriched = streams.map((s) => {
    const text = s.title || s.name || "";
    return {
      ...s,
      _text: text,
      _resolution: getResolution(text),
      _seeders: getSeeders(text),
      _size: getEstimatedSize(text),
    };
  });

  // alege “cea mai bună rezoluție disponibilă” conform preferinței
  let candidates = enriched;

  if (preferredResolution !== "Any") {
    const startIdx = Math.max(order.indexOf(preferredResolution), 0);
    const bestAvail = order.slice(startIdx).find((r) =>
      candidates.some((x) => x._resolution === r)
    );
    if (bestAvail) candidates = candidates.filter((x) => x._resolution === bestAvail);
  }

  // sort by seeders desc
  candidates.sort((a, b) => b._seeders - a._seeders);

  return candidates[0] || null;
}

const manifest = {
  id: "org.alexsdev.smartautoplay",
  version: "1.0.0",
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
      options: ["Any", "720p", "1080p", "2160p"],
      default: DEFAULT_RESOLUTION,
      title: "Preferred Resolution",
      required: true,
    },
  ],
};

const addon = new addonBuilder(manifest);

addon.defineStreamHandler(async ({ type, id, config }) => {
  const cacheKey = JSON.stringify({ type, id, config });

  if (cache.has(cacheKey)) {
    return { streams: cache.get(cacheKey) };
  }

  const torrentioUrl = `${TORRENTIO_BASE_URL}/stream/${type}/${id}.json`;

  let torrentioStreams = [];
  try {
    const r = await axios.get(torrentioUrl, { timeout: 15000 });
    torrentioStreams = r.data?.streams || [];
  } catch (e) {
    console.error("Torrentio fetch error:", e.message);
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  if (!torrentioStreams.length) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  const best = selectBestStream(torrentioStreams, config);

  if (!best) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  // Return ONLY ONE stream => apare o singură opțiune în Sources
  const one = {
    ...best,
    name: "SmarT-Autoplay",
    title: `[BEST PICK] ${best.title || best.name || ""}`,
    behaviorHints: {
      ...(best.behaviorHints || {}),
      immediatePlay: true, // nu garantează, dar poate ajuta în unele clienți
    },
  };

  const result = [one];
  cache.set(cacheKey, result);
  return { streams: result };
});

serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
