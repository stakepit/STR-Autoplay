const { scrapeYTS } = require('./src/scrapers/yts');
const { scrapeEZTV } = require('./src/scrapers/eztv');
const { scrapeTPB } = require('./src/scrapers/tpb');
const { scrape1337x } = require('./src/scrapers/1337x');

async function debug() {
    console.log("=== Debugging Scrapers (Live) ===");
    const testID = "tt0133093"; // The Matrix
    const testQuery = "The Matrix 1999";

    console.log(`\n1. Testing YTS (${testID})...`);
    try {
        const yts = await scrapeYTS(testID);
        console.log(`   Result: Found ${yts.length} streams.`);
        if (yts.length > 0) console.log(`   Sample: ${yts[0].title}`);
    } catch (e) { console.error("   YTS Failed:", e.message); }

    console.log(`\n2. Testing EZTV (${testID})...`);
    try {
        const eztv = await scrapeEZTV(testID);
        console.log(`   Result: Found ${eztv.length} streams.`);
        if (eztv.length > 0) console.log(`   Sample: ${eztv[0].title}`);
    } catch (e) { console.error("   EZTV Failed:", e.message); }

    console.log(`\n3. Testing TPB ('${testQuery}')...`);
    try {
        const tpb = await scrapeTPB(testQuery);
        console.log(`   Result: Found ${tpb.length} streams.`);
        if (tpb.length > 0) console.log(`   Sample: ${tpb[0].title}`);
    } catch (e) { console.error("   TPB Failed:", e.message); }

    console.log(`\n4. Testing 1337x ('${testQuery}')...`);
    try {
        const x1337 = await scrape1337x(testQuery);
        console.log(`   Result: Found ${x1337.length} streams.`);
        if (x1337.length > 0) console.log(`   Sample: ${x1337[0].title}`);
    } catch (e) { console.error("   1337x Failed:", e.message); }
}

debug();
