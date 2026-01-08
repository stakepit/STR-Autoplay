const { addon } = require('./index');

// Mock SDK handler call
async function run() {
    console.log("=== Testing v2.2 Logic ===");

    // 1. Test Movie (The Matrix)
    console.log("\nSearching Movie: The Matrix (tt0133093)...");
    const resMovie = await addon.getInterface().streamHandler({
        type: 'movie',
        id: 'tt0133093',
        config: { resolution: '1080p' }
    });
    console.log("Result:", JSON.stringify(resMovie, null, 2));

    // 2. Test Series (Breaking Bad S01E01 - tt0903747)
    // Note: Stremio passes id as "tt0903747:1:1" for series usually, but our scraper handles ID basically.
    // Actually EZTV scraper expects the SHOW ID (tt0903747).
    // If Stremio passes "tt...:1:1", we need to split it! 
    // Wait, my index.js code uses `id` directly. `scrapeEZTV_Fixed` uses it.
    // EZTV API takes imdb_id of the SHOW and returns ALL torrents.
    // We need to Filter by S01E01!
    // My current logic creates a magnet for EVERYTHING returned.
    // I need to add filtering for Series in index.js!
    // I will detect this failure in this test.

    console.log("\nSearching Series: Breaking Bad (tt0903747)...");
    const resSeries = await addon.getInterface().streamHandler({
        type: 'series',
        id: 'tt0903747', // Pass raw ID for now to see what we get
        config: { resolution: '1080p' }
    });
    console.log("Series Result Count:", resSeries.streams.length);
}

run();
