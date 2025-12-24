const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { LRUCache } = require('lru-cache');
const axios = require('axios');

// --- Configuration and Constants ---

const DEFAULT_RESOLUTION = '1080p';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
const TORRENTIO_BASE_URL = 'https://torrentio.strem.fun'; // Base Torrentio URL

// --- Caching Setup ---

const cache = new LRUCache({
    max: 500, // Max 500 entries
    ttl: CACHE_TTL,
    allowStale: false,
    updateAgeOnGet: true,
    updateAgeOnHas: true,
});

// --- Helper Functions ---

/**
 * Parses the torrent name to estimate resolution.
 * @param {string} name - The torrent name.
 * @returns {string} The estimated resolution (e.g., '1080p', '720p', '2160p', 'Unknown').
 */
function getResolution(name) {
    if (/(2160p|4k)/i.test(name)) return '2160p';
    if (/1080p/i.test(name)) return '1080p';
    if (/720p/i.test(name)) return '720p';
    return 'Unknown';
}

/**
 * Parses the torrent name to estimate file size in bytes (Torrentio streams don't provide size directly).
 * This is a mock function based on common naming conventions.
 * @param {string} name - The torrent name.
 * @returns {number} The estimated size in bytes.
 */
function getEstimatedSize(name) {
    // This is a highly simplified mock based on common torrent names
    if (/2160p|4k/i.test(name)) return 15 * 1024 * 1024 * 1024; // 15 GB
    if (/1080p/i.test(name)) return 4 * 1024 * 1024 * 1024; // 4 GB
    if (/720p/i.test(name)) return 1.5 * 1024 * 1024 * 1024; // 1.5 GB
    return 1 * 1024 * 1024 * 1024; // 1 GB (default)
}

/**
 * Extracts seeders from the Torrentio stream name.
 * @param {string} name - The stream name from Torrentio.
 * @returns {number} The number of seeders.
 */
function getSeeders(name) {
    const match = name.match(/👤(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Selects the best stream from a list based on custom criteria.
 * @param {Array<Object>} streams - List of streams from Torrentio.
 * @param {Object} config - User configuration.
 * @returns {Object|null} The best stream object.
 */
function selectBestStream(streams, config) {
    const preferredResolution = config.preferredResolution || DEFAULT_RESOLUTION;
    const resolutionOrder = ['2160p', '1080p', '720p', 'Unknown'];
    const preferredIndex = resolutionOrder.indexOf(preferredResolution);

    // 1. Enrich streams with parsed data
    const enrichedStreams = streams.map(stream => ({
        ...stream,
        resolution: getResolution(stream.name),
        seeders: getSeeders(stream.name),
        size: getEstimatedSize(stream.name),
    }));

    let bestStreams = [...enrichedStreams];

    // 2. Filter and sort by resolution preference
    if (preferredResolution !== 'Any') {
        // Find the best resolution available based on preference
        const bestAvailableResolution = resolutionOrder
            .slice(preferredIndex)
            .find(res => bestStreams.some(t => t.resolution === res));

        if (bestAvailableResolution) {
            bestStreams = bestStreams.filter(t => t.resolution === bestAvailableResolution);
        } else {
            // Fallback to the next best available resolution if preferred is not found
            const nextBestAvailable = resolutionOrder
                .slice(preferredIndex + 1)
                .find(res => enrichedStreams.some(t => t.resolution === res));
            
            if (nextBestAvailable) {
                bestStreams = enrichedStreams.filter(t => t.resolution === nextBestAvailable);
            }
        }
    }

    // 3. Filter by "medium" file size (e.g., 1GB to 10GB)
    const MIN_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
    const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
    
    let mediumSizeStreams = bestStreams.filter(t => t.size >= MIN_SIZE && t.size <= MAX_SIZE);

    // If no medium size streams, fall back to all streams in the best resolution
    if (mediumSizeStreams.length === 0) {
        mediumSizeStreams = bestStreams;
    }

    // 4. Sort by seeders (descending)
    mediumSizeStreams.sort((a, b) => b.seeders - a.seeders);

    // 5. Select the top result
    return mediumSizeStreams[0];
}

// --- Addon Manifest ---

const manifest = {
    id: 'com.manus.torrentio.wrapper',
    version: '1.0.0',
    name: 'Torrentio Auto-Select Wrapper',
    description: 'Wraps Torrentio to automatically select the best stream based on resolution and seeders.',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    // Configuration setup
    configurable: true,
    config: [
        {
            key: 'preferredResolution',
            type: 'select',
            options: ['Any', '720p', '1080p', '2160p'],
            default: DEFAULT_RESOLUTION,
            title: 'Preferred Resolution',
            required: true
        },
        {
            key: 'enableNextEpisode',
            type: 'checkbox',
            default: true,
            title: 'Enable Next Episode Auto-Play (Not implemented in this wrapper)',
            required: false
        }
    ]
};

// --- Addon Handlers ---

const addon = new addonBuilder(manifest);

addon.defineStreamHandler(async ({ type, id, config }) => {
    const cacheKey = JSON.stringify({ type, id, config });

    // 1. Check Cache
    if (cache.has(cacheKey)) {
        console.log(`Cache hit for ${cacheKey}`);
        return { streams: cache.get(cacheKey) };
    }

    // 2. Call Torrentio API
    const torrentioUrl = `${TORRENTIO_BASE_URL}/stream/${type}/${id}.json`;
    let torrentioResponse;
    try {
        torrentioResponse = await axios.get(torrentioUrl);
    } catch (error) {
        console.error('Error fetching streams from Torrentio:', error.message);
        return { streams: [] };
    }

    const torrentioStreams = torrentioResponse.data.streams || [];

    if (torrentioStreams.length === 0) {
        cache.set(cacheKey, []);
        return { streams: [] };
    }

    // 3. Select Best Stream
    const bestStream = selectBestStream(torrentioStreams, config);

    let streams = torrentioStreams;

    if (bestStream) {
        // Find the index of the best stream in the original list
        const bestStreamIndex = torrentioStreams.findIndex(s => s.name === bestStream.name && s.url === bestStream.url);

        // Remove the best stream from its original position
        if (bestStreamIndex > -1) {
            streams.splice(bestStreamIndex, 1);
        }

        // Prepend the best stream to the list and rename it for clarity
        streams.unshift({
            ...bestStream,
            name: `[AUTO-SELECT] ${bestStream.name}`,
        });
    }

    // 4. Cache and Return
    // Stremio will attempt to play the first stream in the list automatically.
    // If it fails, the user can select another stream from the full list.
    cache.set(cacheKey, streams);
    return { streams };
});

// --- Server Setup ---
serveHTTP(addon.getInterface(), { port: process.env.PORT || 7000 });


