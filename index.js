const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { LRUCache } = require("lru-cache");
const axios = require("axios");

const TORRENTIO_BASE_URL = "https://torrentio.strem.fun";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const DEFAULT_RESOLUTION = "720p";

const cache = new LRUCache({ max: 500, ttl: CACHE_TTL });

// ----------------- Helpers -----------------

function getResolution(text = "") {
  if (/(2160p|4k)/i.test(text)) return "2160p";
  if (/1080p/i.test(text)) return "1080p";
  if (/720p/i.test(text)) return "720p";
  return "Unknown";
}

function getSeeders(text = "") {
  const m = text.match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function getEstimatedSize(text = "") {
  if (/2160p|4k/i.test(text)) return 15 * 1024 ** 3;
  if (/1080p/i.test(text)) return 4 * 1024 ** 3;
  if (/720p/i.test(text)) return 1.5 * 1024 ** 3;
  return 1 * 1024 ** 3;
}

function selectBestStream(streams, config) {
  const preferred = config.preferredResolution || DEFAULT_RESOLUTION;
  const order = ["2160p", "1080p", "720p", "Unknown"];

  const enriched = streams
    .filter(s => s.url || s.infoHash)
    .map(s => {
      const text = s.title || s.name || "";
      return {
        ...s,
        _resolution: getResolution(text),
        _seeders: getSeeders(text),
        _size: getEstimatedSize(text),
      };
    });

  if (!enriched.length) return null;

  let candidates = enriched;

  if (preferred !== "Any") {
    const start = Math.max(order.indexOf(preferred), 0);
    const bestRes = order.slice(start).find(r =>
      candidates.some(s => s._resolution === r)
    );
    if (bestRes) {
      candidates = candidates.filter(s => s._resolution === bestRes);
    }
  }

  candidates.sort((a, b) => b._seeders - a._seeders);
  return candidates[0] || null;
}

// ----------------- Manifest -----------------

const manifest = {
  id: "org.alexsdev.smartautoplay",
  version: "1.0.0",
  name: "SmarT-Autoplay",
  description: "Finds best source for movies and TV shows",
  logo: "https://raw.githubusercontent.com/stakepit/smart-torrentio-picker/main/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
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

// ----------------- Addon -----------------

const addon = new addonBuilder(manifest);

addon.defineStreamHandler(async ({ type, id, config }) => {
  const cacheKey = JSON.stringify({ type, id, config });
  if (cache.has(cacheKey)) {
    return { streams: cache.get(cacheKey) };
  }

  let torrentioStreams = [];
  try {
    const r = await axios.get(
      `${TORRENTIO_BASE_URL}/stream/${type}/${id}.json`,
      { timeout: 15000 }
    );
    torrentioStreams = r.data?.streams || [];
  } catch (e) {
    console.error("Torrentio error:", e.message);
    return { streams: [] };
  }

  const best = selectBestStream(torrentioStreams, config);
  if (!best) {
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  // 🔥 THE FIX: return ONLY ONE STREAM
  const singleStream = {
    ...best,
    name: "SmarT-Autoplay",
    title: `[BEST PICK] ${best.title || best.name || ""}`,
    behaviorHints: {
      ...(best.behaviorHints || {}),
      immediatePlay: true,
      bingeGroup: id, // helps next-episode flow
    },
  };

  const result = [singleStream];
  cache.set(cacheKey, result);
  return { streams: result };
});

// ----------------- Server -----------------

serveHTTP(addon.getInterface(), {
  port: process.env.PORT || 7000,
});
