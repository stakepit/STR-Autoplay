const axios = require('axios');

async function scrapeYTS(imdbId) {
    // YTS API: listing_count=20 (Max), sort_by=seeds, quality=1080p, query_term=IMDB_ID
    // Using query_term=imdb_id is very reliable on YTS.
    const url = `https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}&sort_by=seeds&limit=5`;

    try {
        const { data } = await axios.get(url, { timeout: 10000 });
        if (!data || !data.data || !data.data.movies) return [];

        // Map YTS results to uniform "Stream" object
        const streams = data.data.movies.flatMap(movie => {
            // Each movie has multiple torrents (720p, 1080p, 2160p)
            return movie.torrents.map(t => {
                return {
                    title: `[YTS] ${movie.title} ${t.quality} ${t.type}`,
                    infoHash: t.hash,
                    seeds: t.seeds,
                    size: t.size_bytes, // YTS is P2P.
                    source: 'YTS',
                    quality: t.quality
                };
            });
        });

        return streams;

    } catch (e) {
        console.error("YTS Scraper Error:", e.message);
        return [];
    }
}

module.exports = { scrapeYTS };
