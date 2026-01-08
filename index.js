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
  if (t.includes("480p")) return "480p";
  return "Unknown";
}

function getSeeders(text = "") {
  const m = String(text).match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSizeMB(text = "") {
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (!Number.isFinite(num)) return null;
  return unit === "GB" ? num * 1024 : num;
}

function getDebridStatus(title = "") {
  // Common Torrentio Debrid tags
  // [RD+] RealDebrid cached
  // [AD+] AllDebrid cached
  // [PM+] Premiumize cached
  // [D+] DebridLink cached
  const t = title.toUpperCase();
  if (t.includes("[RD+]") || t.includes("[AD+]") || t.includes("[PM+]") || t.includes("[D+]")) {
    return true;
  }
  return false;
}

function isCamOrLowQuality(title = "") {
  const t = title.toUpperCase();
  // CAM, TS (Telesync), SCR (Screener), TC (Telecine)
  // We use regex to avoid partial matches like "SCR" in "DESCRIPTION" (unlikely but safe)
  if (/\b(CAM|HDCAM|TS|HDTS|TELESYNC|SCR|SCREENER|DVDPROMO|TC|HDTC)\b/.test(t)) {
    return true;
  }
  return false;
}

function pickBestStream(streams, cfg) {
  const preferredResolution = cfg.preferredResolution || "1080p";
  const priorizeDebrid = cfg.prioritizeDebrid !== "false"; // Default true
  const excludeCam = cfg.excludeCam !== "false"; // Default true

  // P2P Specific Config
  const p2pMinSeeders = parseInt(cfg.p2pMinSeeders || "20", 10);
  const p2pMaxFileSizeGB = parseFloat(cfg.p2pMaxFileSizeGB || "3");

  // Pre-process all streams
  let candidates = (streams || []).map((s) => {
    const title = `${s.name || ""} ${s.title || ""} ${s.description || ""}`;
    return {
      raw: s,
      title,
      res: getResolution(title),
      seeders: getSeeders(title),
      sizeMB: parseSizeMB(title),
      isCached: getDebridStatus(title),
      isCam: isCamOrLowQuality(title),
    };
  });

  // 1. Garbage Filter
  if (excludeCam) {
    candidates = candidates.filter(x => !x.isCam);
  }

  // 2. Strict P2P Filters (Only apply if NOT cached)
  // If a stream is NOT cached (Debrid), it must meet P2P standards to be considered "Auto-Playable"
  candidates = candidates.filter(x => {
    if (x.isCached) return true; // Cached = Always OK

    // Filters for P2P
    if (x.seeders < p2pMinSeeders) return false; // Too few peers
    if (x.sizeMB && (x.sizeMB / 1024) > p2pMaxFileSizeGB) return false; // Too big for P2P streaming

    return true;
  });

  // 3. Score candidates
  candidates.forEach(c => {
    let score = 0;

    // --- TIER 1: RELIABILITY ---
    if (priorizeDebrid && c.isCached) {
      score += 10000;
    } else {
      // P2P Scoring
      // Seeders are king. 100 seeders = 100 points.
      score += Math.min(c.seeders, 500);

      // Penalty for unknown size (risky)
      if (!c.sizeMB) score -= 50;

      // Bonus for efficient size (High seeds + Low Size = Fast)
      if (c.sizeMB) {
        // Density: Seeders per GB. 
        // 100 seeds / 1GB = 100. 100 seeds / 10GB = 10.
        const density = c.seeders / (c.sizeMB / 1024);
        score += Math.min(density, 100);
      }
    }

    // --- TIER 2: RESOLUTION ---
    if (c.res === preferredResolution) {
      score += 2000;
    } else {
      if (preferredResolution === "1080p") {
        if (c.res === "2160p") score += 1500;
        if (c.res === "720p") score += 1000;
      } else if (preferredResolution === "720p") {
        if (c.res === "1080p") score += 1500;
        if (c.res === "480p") score += 500;
      } else if (preferredResolution === "2160p") {
        if (c.res === "1080p") score += 1000;
      }
    }

    // --- TIER 3: QUALITY EXTRAS ---
    if (c.title.includes("HDR") || c.title.includes("Dolby Vision") || c.title.includes("DV")) {
      score += 100;
    }

    c.score = score;
  });

  // 4. Sort
  candidates.sort((a, b) => b.score - a.score);

  return candidates[0] ? candidates[0].raw : null;
}

// -------------------- MANIFEST --------------------
const manifest = {
  id: "org.alexsdev.smartautoplay",
  version: "1.3.2",
  name: "SmarT-Autoplay",
  description: "Seamlessly auto-selects the best stream (Optimized for both Debrid & P2P)",
  logo: "https://raw.githubusercontent.com/stakepit/smart-torrentio-picker/main/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],

  behaviorHints: {
    configurable: true,
  },

  config: [
    {
      key: "preferredResolution",
      type: "select",
      title: "Preferred resolution",
      options: ["720p", "1080p", "2160p", "Any"],
      default: "1080p",
      required: true,
    },
    {
      key: "prioritizeDebrid",
      type: "select",
      title: "Prioritize Cached (Debrid)",
      options: ["true", "false"],
      default: "true",
      required: true,
    },
    {
      key: "excludeCam",
      type: "select",
      title: "Exclude CAM/Screener",
      options: ["true", "false"],
      default: "true",
      required: true,
    },
    {
      key: "p2pMinSeeders",
      type: "number",
      title: "P2P Only: Min Seeders",
      default: 20,
      required: false,
    },
    {
      key: "p2pMaxFileSizeGB",
      type: "number",
      title: "P2P Only: Max File Size (GB)",
      default: 3,
      required: false,
    },
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
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    torrentioStreams = resp.data?.streams || [];
  } catch (e) {
    console.error("Torrentio fetch error:", e.message);
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  if (!torrentioStreams.length) {
    // If no streams, we just return empty
    cache.set(cacheKey, []);
    return { streams: [] };
  }

  const best = pickBestStream(torrentioStreams, config || {});

  // FAILSAFE:
  // If we found a "best", we put it FIRST with immediatePlay.
  // BUT we also append the rest of the streams below it, 
  // so if the autoplay fails, the user isn't stuck with nothing.
  // Actually, Stremio behavior with 'immediatePlay' might ignore the rest if the first one works?
  // User requested "Seamless". Usually that means "Just work".
  // Returning ONLY one stream is risky if that link is dead.
  // Compromise: Return [Best (Auto), ...Others].
  // However, `immediatePlay: true` usually triggers the player immediately.
  // If the user backs out, they see the list.

  if (!best) {
    // No candidate passed filter? Return original list (fallback)
    // or return empty?
    // Better to return original list without autoplay trigger if we filtered everything out (unlikely)
    return { streams: torrentioStreams };
  }

  const behaviorHints = {
    ...(best.behaviorHints || {}),
    immediatePlay: true,
  };

  if (type === "series") {
    behaviorHints.bingeGroup = "smart-autoplay-series";
  }

  const autoStream = {
    ...best,
    name: `⚡ AutoPlay • ${best.name || best.title || ""}`,
    behaviorHints,
  };

  // We place the Best stream first, then the rest of the original streams (excluding the chosen one to avoid dupe)
  // This serves as the "Fail-Safe".
  const others = torrentioStreams.filter(s => s !== best);
  const result = [autoStream, ...others];

  cache.set(cacheKey, result);
  return { streams: result };
});

// -------------------- SERVER --------------------
if (require.main === module) {
  serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
}




