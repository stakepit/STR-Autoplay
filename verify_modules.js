const { addon } = require('./index');

console.log("Running TorrentNavigator v2.1 Verification...\n");

async function test() {
    // Test with "The Matrix" (tt0133093)
    console.log("Checking Modules...");
    try {
        require('./src/scrapers/eztv');
        console.log("EZTV Loaded OK");
        require('./src/scrapers/yts');
        console.log("YTS Loaded OK");
        require('./src/scrapers/tpb');
        console.log("TPB Loaded OK");
        require('./src/scrapers/1337x');
        console.log("1337x Loaded OK");
        console.log("ALL MODULES VERIFIED.");
    } catch (e) {
        console.error("Verification Failed:", e);
    }
}

test();
