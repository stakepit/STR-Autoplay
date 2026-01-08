const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const manifest = {
  id: "org.alexsdev.torrentnavigator",
  version: "2.3.0",
  name: "TorrentNavigator",
  description: "Aggregates YTS, TPB, EZTV, 1337x with Smart Autoplay",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
  config: [
    {
      key: "resolution",
      type: "select",
      title: "Preferred Resolution",
      options: ["2160p", "1080p", "720p"],
      default: "1080p",
      required: false
    }
  ],
  behaviorHints: { configurable: true }
};

const addon = new addonBuilder(manifest);

// --- SCRAPER HELPERS ---
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

async function fetchWithFailover(urls, scraperName) {
  for (const url of urls) {
    try {
      console.log(`[${scraperName}] Trying ${url}...`);
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
      return data; // Success
    } catch (e) {
      console.warn(`[${scraperName}] Failed ${url}: ${e.message}`);
    }
  }
  throw new Error(`All mirrors failed for ${scraperName}`);
}

async function scrapeYTS_Fixed(imdbId) {
  const mirrors = [
    `https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}&sort_by=seeds`,
    `https://yts.pm/api/v2/list_movies.json?query_term=${imdbId}&sort_by=seeds`,
    `https://yts.am/api/v2/list_movies.json?query_term=${imdbId}&sort_by=seeds`
  ];

  try {
    const data = await fetchWithFailover(mirrors, "YTS");
    if (!data.data || !data.data.movies) return [];

    return data.data.movies.flatMap(m => m.torrents.map(t => ({
      title: `[YTS] ${m.title} ${t.quality} ${t.type}`,
      magnet: `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(m.title)}+${t.quality}&tr=udp://open.demonii.com:1337/announce`,
      seeds: t.seeds,
      size: t.size_bytes,
      source: "YTS",
      resolution: t.quality
    })));
  } catch (e) {
    console.error("YTS-All-Fail:", e.message);
    return [];
  }
}

async function scrapeEZTV_Fixed(imdbId) {
  const numId = parseInt(imdbId.replace("tt", ""), 10);
  const mirrors = [
    `https://eztv.re/api/get-torrents?imdb_id=${numId}`,
    `https://eztv.wf/api/get-torrents?imdb_id=${numId}`,
    `https://eztv1.xyz/api/get-torrents?imdb_id=${numId}`
  ];

  try {
    const data = await fetchWithFailover(mirrors, "EZTV");
    if (!data.torrents) return [];
    return data.torrents.map(t => ({
      title: `[EZTV] ${t.title}`,
      magnet: t.magnet_url,
      seeds: t.seeds,
      size: parseInt(t.size_bytes, 10),
      source: "EZTV",
      resolution: t.title.includes("1080p") ? "1080p" : t.title.includes("720p") ? "720p" : "480p"
    }));
  } catch (e) {
    console.error("EZTV-All-Fail:", e.message);
    return [];
  }
}

async function scrapeTPB_Html(query) {
  const q = encodeURIComponent(query);
  const mirrors = [
    `https://tpb.party/search/${q}/1/99/200`,
    `https://thepiratebay10.org/search/${q}/1/99/200`,
    `https://piratebayproxy.live/search/${q}/1/99/200`
  ];

  try {
    const data = await fetchWithFailover(mirrors, "TPB");
    const $ = cheerio.load(data);
    const results = [];

    $('tr').each((i, el) => {
      if (i === 0) return;
      const name = $(el).find('.detName a').text();
      const magnet = $(el).find('a[href^="magnet:"]').attr('href');
      let seedsText = $(el).find('td[align="right"]').first().text();
      if (!seedsText) seedsText = $(el).find('td').eq(2).text();
      const seeds = parseInt(seedsText) || 0;

      if (name && magnet) {
        results.push({
          title: `[TPB] ${name}`,
          magnet,
          seeds,
          source: "TPB",
          resolution: name.includes("2160p") ? "2160p" : name.includes("1080p") ? "1080p" : "SD"
        });
      }
    });
    return results;
  } catch (e) {
    console.error("TPB-All-Fail:", e.message);
    return [];
  }
}

// --- UTILS ---
async function getMeta(imdbId) {
  try {
    const { data } = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`);
    return data.meta ? data.meta : null;
  } catch (e) { return null; }
}

// --- SELECTION LOGIC ---
function scoreStream(s, prefRes) {
  let score = 0;

  // 1. Resolution Match (2000 pts)
  if (s.resolution === prefRes) score += 2000;
  else if (prefRes === "1080p" && s.resolution === "2160p") score += 1500;
  else if (prefRes === "1080p" && s.resolution === "720p") score += 1000;

  // 2. Seeders (Up to 500 pts)
  score += Math.min(s.seeds, 500);

  // 3. Negative: No Seeds
  if (s.seeds < 1) score -= 10000;

  // 4. Negative: CAM/TS
  if (/CAM|HDCAM|TS|HDTS|SCR/i.test(s.title)) score -= 5000;

  return score;
}

addon.defineStreamHandler(async ({ type, id, config }) => {
  const prefRes = config?.resolution || "1080p";
  console.log(`Req: ${type} ${id} (Pref: ${prefRes})`);

  let meta = await getMeta(id.split(":")[0]); // Handle tt:s:e format for name fetch
  let query = meta ? meta.name : "";
  if (meta && meta.year) query += ` ${meta.year}`;

  const tasks = [];

  if (type === 'movie') {
    tasks.push(scrapeYTS_Fixed(id));
    if (query) tasks.push(scrapeTPB_Html(query));
  } else if (type === 'series') {
    // ID format: "tt123456:1:2"
    const parts = id.split(":");
    const imdbId = parts[0];
    const sea = parseInt(parts[1], 10);
    const ep = parseInt(parts[2], 10);

    if (imdbId && sea && ep) {
      // EZTV (Primary)
      tasks.push(scrapeEZTV_Fixed(imdbId).then(res => {
        const sZero = sea < 10 ? `0${sea}` : sea;
        const eZero = ep < 10 ? `0${ep}` : ep;
        const pattern = new RegExp(`S${sZero}E${eZero}|${sea}x${eZero}`, "i");
        return res.filter(r => pattern.test(r.title));
      }));

      // TPB (Secondary)
      if (query) {
        const sZero = sea < 10 ? `0${sea}` : sea;
        const eZero = ep < 10 ? `0${ep}` : ep;
        const epQuery = `${query} S${sZero}E${eZero}`;
        tasks.push(scrapeTPB_Html(epQuery));
      }
    }
  }

  const results = await Promise.allSettled(tasks);
  const raw = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  console.log(`Found ${raw.length} total streams`);

  if (!raw.length) return { streams: [] };

  // Score & Sort
  const scored = raw.map(s => ({ ...s, score: scoreStream(s, prefRes) }));
  scored.sort((a, b) => b.score - a.score);

  // Autoplay Winner
  const best = scored[0];
  if (best.score < -4000) return { streams: [] };

  const stream = {
    name: `⚡ ${best.source} ${best.resolution}\n👤${best.seeds}`,
    title: best.title,
    url: best.magnet,
    behaviorHints: {
      bingeGroup: "autoplay-wrapper-v2",
      immediatePlay: true // FORCE AUTOPLAY
    }
  };

  return { streams: [stream] };
});

if (require.main === module) serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
module.exports = { addon };
