# Rssfeed

Upload the contents of this folder to your `Rssfeed` GitHub repository.

Files:
- worker.js
- wrangler.json

This Worker provides:
GET /
GET /rss?url=RSS_URL

It fetches RSS/Atom feeds server-side and returns JSON with CORS headers.
After uploading `worker.js`, deploy the new Worker version in Cloudflare and give it 100% traffic.
