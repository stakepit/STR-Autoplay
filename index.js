const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const { scrapeYTS } = require("./src/scrapers/yts");
const { scrapeTPB } = require("./src/scrapers/tpb");
const { scrape1337x } = require("./src/scrapers/1337x");
const { scrapeEZTV } = require("./src/scrapers/eztv");

const manifest = {
  id: "org.alexsdev.torrentnavigator",
  version: "2.1.0",
  name: "TorrentNavigator",
  description: "Aggregates YTS, TPB, 1337x, EZTV (Autoplay)",
  resources: ["stream"],
  types: ["movie", "series"], // Enabled Series for EZTV
  idPrefixes: ["tt"],
  catalogs: [],
  behaviorHints: { configurable: false }
};

const addon = new addonBuilder(manifest);

// --- Helpers ---

async function getMovieName(imdbId) {
  try {
    const url = `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`;
    const { data } = await axios.get(url, { timeout: 5000 });
    if (data && data.meta && data.meta.name) {
      const year = data.meta.year ? ` ${data.meta.year}` : "";
      return `${data.meta.name}${year}`;
    }
    return null;
  } catch (e) {
    // Might be series?
    return null;
  }
}

function sortStreams(streams) {
  return streams.sort((a, b) => {
    // 1. Seeders
    const seedDiff = (b.seeds || 0) - (a.seeds || 0);
    if (seedDiff !== 0) return seedDiff;
    return 0;
  });
}

addon.defineStreamHandler(async ({ type, id }) => {
  console.log(`Looking up: ${id} (${type})`);

  let queries = [];

  // Basic query logic
  if (type === "movie") {
    const name = await getMovieName(id);
    if (name) queries.push(name);
  }

  const query = queries[0] || "";

  // Launch Scrapers Parallel
  const [yts, tpb, x1337, eztv] = await Promise.allSettled([
    type === 'movie' ? scrapeYTS(id) : Promise.resolve([]),
    query ? scrapeTPB(query) : Promise.resolve([]),
    query ? scrape1337x(query) : Promise.resolve([]),
    scrapeEZTV(id) // Works for both, but main source for Series
  ]);

  const rawStreams = [
    ...(yts.status === 'fulfilled' ? yts.value : []),
    ...(tpb.status === 'fulfilled' ? tpb.value : []),
    ...(x1337.status === 'fulfilled' ? x1337.value : []),
    ...(eztv.status === 'fulfilled' ? eztv.value : [])
  ];

  console.log(`Found ${rawStreams.length} raw streams`);

  // Normalize
  const streams = rawStreams.map(s => {
    return {
      name: `[${s.source}] ${s.seeds}👤`,
      title: s.title || "Unknown",
      infoHash: s.infoHash,
      url: s.magnet,
      seeds: s.seeds,
      behaviorHints: {
        bingeGroup: "torrent-navigator-auto"
      }
    };
  });

  // Sort by Seeders
  const sorted = sortStreams(streams);

  // STRICT AUTOPLAY: Return ONLY the Best Result
  if (sorted.length > 0) {
    const best = sorted[0];
    best.behaviorHints = { ...best.behaviorHints, immediatePlay: true };
    return { streams: [best] };
  }

  return { streams: [] };
});

if (require.main === module) {
  serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });
}

module.exports = { addon };
