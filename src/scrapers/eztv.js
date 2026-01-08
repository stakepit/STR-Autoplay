const axios = require('axios');

async function scrapeEZTV(imdbId) {
    // EZTV API requires numeric ID (e.g. 123456 from tt123456)
    const numericId = imdbId.replace('tt', '');
    const url = `https://eztv.re/api/get-torrents?imdb_id=${numericId}`;

    try {
        const { data } = await axios.get(url, { timeout: 10000 });

        if (!data || !data.torrents) return [];

        return data.torrents.map(t => ({
            title: `[EZTV] ${t.title}`,
            infoHash: t.hash,
            magnet: t.magnet_url,
            seeds: t.seeds,
            size: t.size_bytes,
            source: 'EZTV'
        }));

    } catch (e) {
        console.error("EZTV Scraper Error:", e.message);
        return [];
    }
}

module.exports = { scrapeEZTV };
