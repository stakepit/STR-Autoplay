const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://1337x.to';

async function scrape1337x(query) {
    const searchUrl = `${BASE_URL}/sort-search/${encodeURIComponent(query)}/seeders/desc/1/`;

    try {
        const { data } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        const results = [];

        // 1337x table rows
        $('table.table-list tbody tr').each((i, el) => {
            if (i >= 5) return; // Limit to top 5

            const nameLink = $(el).find('td.name a').last(); // Second link is usually the details page
            const name = nameLink.text().trim();
            const detailPath = nameLink.attr('href');
            const seeds = parseInt($(el).find('td.seeds').text().trim(), 10);
            const sizeStr = $(el).find('td.size').text().replace(/([0-9.]+ [A-Z]+).*/, '$1').trim(); // "2.1 GB"

            if (name && detailPath) {
                results.push({
                    title: `[1337x] ${name}`,
                    detailUrl: `${BASE_URL}${detailPath}`,
                    magnet: null, // Need second fetch for magnet
                    seeds,
                    sizeStr,
                    source: '1337x'
                });
            }
        });

        // Resolve Magnets (Parallel)
        const detailedResults = await Promise.all(results.map(async (r) => {
            try {
                const { data: detailHtml } = await axios.get(r.detailUrl, {
                    timeout: 5000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const $$ = cheerio.load(detailHtml);
                const magnet = $$('a[href^="magnet:"]').first().attr('href');
                if (magnet) {
                    r.magnet = magnet;
                    return r;
                }
            } catch (e) {
                return null; // Failed to get magnet
            }
            return null;
        }));

        return detailedResults.filter(r => r !== null);

    } catch (e) {
        console.error("1337x Scraper Error:", e.message);
        return [];
    }
}

module.exports = { scrape1337x };
