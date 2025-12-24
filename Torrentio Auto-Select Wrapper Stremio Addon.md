# Torrentio Auto-Select Wrapper Stremio Addon

This addon acts as a wrapper around the official Torrentio addon, allowing you to apply custom filtering and automatic selection logic to the streams provided by Torrentio. This is the easiest way to get the functionality you seek without building a complex torrent-to-stream service.

## Features

- **Leverages Torrentio:** Uses the reliable stream sources provided by the official Torrentio addon.
- **Automatic Selection & Fail-Safe:** Implements custom logic to select the single best stream and prioritizes it at the top of the stream list. Stremio auto-plays the first stream, and if it fails, the user can select another from the full list (the fail-safe).
- **Filtering Logic:** Selects the best stream based on:
    1.  User's `preferredResolution` (with smart fallback).
    2.  Estimated "medium" file size (1GB-10GB).
    3.  Highest number of seeders.
- **Configurable:** Allows users to set a preferred resolution via a configuration page.
- **In-Memory Caching:** Uses an LRU cache with a 1-hour TTL to speed up stream responses.

## Project Structure

```
.
├── src/
│   └── index.js  # Main addon logic
├── package.json  # Dependencies and scripts
└── README.md     # This file
```

## Local Development

### Prerequisites

- Node.js (v18+)
- npm

### Steps

1.  **Clone the repository (or create the files):**
    ```bash
    # Assuming you have the files in a directory
    cd torrentio-wrapper-addon
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run in development mode:**
    ```bash
    npm run dev
    ```
    The server will start on port `7000` (or the port specified by the `PORT` environment variable).

## Free Deployment via GitHub (Render)

Since Vercel proved incompatible with the addon's routing, we will use **Render**, a reliable free hosting service that supports Node.js web services.

### 1. Prepare and Push to GitHub

You need to create an empty repository on GitHub first. Let's assume your repository URL is `https://github.com/YOUR_USERNAME/torrentio-wrapper-addon.git`.

Use the following commands in your project directory to prepare and push the code:

```bash
# 1. Initialize Git (if not already done)
git init

# 2. Add all files
git add .

# 3. Commit the files
git commit -m "Initial commit: Torrentio Auto-Select Wrapper Addon with Render Config"

# 4. Rename the default branch to 'main'
git branch -M main

# 5. Add your GitHub repository as the remote
# REPLACE THE URL BELOW WITH YOUR ACTUAL GITHUB REPO URL
git remote add origin https://github.com/YOUR_USERNAME/torrentio-wrapper-addon.git

# 6. Push the code to GitHub
git push -u origin main
```

### 2. Deploy to Render (Recommended Free Option)

Render is a robust platform that is much more compatible with Node.js web services like Stremio addons.

1.  **Go to Render:** Navigate to [https://render.com/](https://render.com/) and sign up with your GitHub account.
2.  **New Web Service:** Click "New" -> "Web Service".
3.  **Connect Repository:** Select your `torrentio-wrapper-addon` repository.
4.  **Configure Service:**
    *   **Name:** Choose a unique name (e.g., `stremio-autoplay-wrapper`).
    *   **Region:** Choose a region close to you.
    *   **Branch:** `main`
    *   **Root Directory:** `/`
    *   **Runtime:** `Node`
    *   **Build Command:** `npm install`
    *   **Start Command:** `npm start`
    *   **Instance Type:** Select **Free**.
5.  **Create Web Service:** Click "Create Web Service". Render will automatically deploy your addon and provide a public URL.

### 3. Install in Stremio

1.  **Get your Manifest URL:**
    Use the public domain URL from your Vercel deployment and append `/manifest.json`.
    **Example Manifest URL:** `https://torrentio-wrapper-addon-xyz.vercel.app/manifest.json`

2.  **Open Stremio:**
    - Go to the **Addons** section.
    - At the top, click on **"Install Addon"** (or the equivalent option to install from URL).
    - Paste your **Manifest URL** and click **Install**.

**IMPORTANT NOTE:** For this wrapper to work, you must also have the **official Torrentio addon installed** in Stremio. This wrapper simply filters the results that Torrentio provides.
