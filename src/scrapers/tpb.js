const PirateBay = require('piratebay-scraper');

async function scrapeTPB(query) {
    // query: "Movie Name Year"
    try {
        const results = await PirateBay.search(query, {
            category: 'video' // Filter by video
        });

        // PirateBay results usually have: name, magnetLink, seeders, leechers, size
        if (!results || !Array.isArray(results)) return [];

        return results.map(t => ({
            title: `[TPB] ${t.name}`,
            infoHash: null, // TPB scraper might not give hash directly, might give magnet
            magnet: t.magnetLink,
            seeds: parseInt(t.seeders || '0', 10),
            size: t.size, // This is often a string like "1.4 GiB". We might need parsing but our logic handles rough values.
            source: 'TPB'
        }));

    } catch (e) {
        console.error("TPB Scraper Error:", e.message);
        return [];
    }
}

module.exports = { scrapeTPB };
