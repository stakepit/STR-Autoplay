const axios = require('axios');
const { spawn } = require('child_process');

console.log("=== Integration Test (v2.3) ===");

// Start Server
const server = spawn('node', ['index.js'], { stdio: 'pipe' });
let serverOutput = "";

server.stdout.on('data', (data) => {
    const str = data.toString();
    serverOutput += str;
    if (str.includes('HTTP addon accessible')) {
        console.log("Server Started. Running tests...");
        runTests();
    }
});

server.stderr.on('data', (data) => console.error(`Server Err: ${data}`));

async function runTests() {
    try {
        // 1. Movie Test
        console.log("\n--- Testing MOVIE (The Matrix) ---");
        const movieUrl = 'http://localhost:7000/stream/movie/tt0133093.json';
        const { data: movieData } = await axios.get(movieUrl);
        console.log(`Response: Found ${movieData.streams.length} streams.`);
        if (movieData.streams.length) {
            console.log(`Winner: ${movieData.streams[0].name}`);
            console.log(`URL: ${movieData.streams[0].url}`);
        }

        // 2. Series Test (Breaking Bad S01E01)
        console.log("\n--- Testing SERIES (Breaking Bad S01E01) ---");
        const seriesUrl = 'http://localhost:7000/stream/series/tt0903747%3A1%3A1.json';
        const { data: seriesData } = await axios.get(seriesUrl);
        console.log(`Response: Found ${seriesData.streams.length} streams.`);
        if (seriesData.streams.length) {
            console.log(`Winner: ${seriesData.streams[0].name}`);
        }

    } catch (e) {
        console.error("Test Failed:", e.message);
    } finally {
        server.kill();
        process.exit(0);
    }
}

// Timeout
setTimeout(() => {
    console.error("Timeout waiting for server.");
    console.log("Output so far:", serverOutput);
    server.kill();
    process.exit(1);
}, 15000);
