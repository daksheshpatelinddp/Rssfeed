const MAX_ARTICLES = 100;
const MAX_FEED_SIZE = 5 * 1024 * 1024;
const CACHE_TTL = 600;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "Only GET is supported." }, 405);
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "MarketFeed RSS Generator",
        version: "2.0.0",
        time: new Date().toISOString()
      });
    }

    if (url.pathname !== "/rss" && url.pathname !== "/generate") {
      return json({
        ok: false,
        error: "Unknown endpoint.",
        usage: "/rss?url=kfintech OR /rss?url=https://example.com/feed.xml"
      }, 404);
    }

    const queryInput = url.searchParams.get("url") || url.searchParams.get("q");

    if (!queryInput) {
      return json({
        ok: false,
        error: "Missing search keyword or URL parameter.",
        usage: "/rss?url=kfintech"
      }, 400);
    }

    let target;
    const cleanQuery = queryInput.trim();

    if (!cleanQuery.startsWith("http://") && !cleanQuery.startsWith("https://")) {
      target = new URL(`https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en-IN&gl=IN&ceid=IN:en`);
    } else {
      try {
        target = new URL(cleanQuery);
      } catch {
        return json({ ok: false, error: "Invalid URL provided." }, 400);
      }
    }

    if (isBlockedHostname(target.hostname)) {
      return json({ ok: false, error: "Private/local hostnames are not allowed." }, 403);
    }

    return fetchFeed(target, ctx);
  }
};

async function fetchFeed(target, ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://marketfeed-cache.invalid/rss/" + encodeURIComponent(target.toString()));

  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCors(cached);
  }

  let response;
  try {
    response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MarketFeed/2.0",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain, */*"
      }
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Could not fetch news feed.",
      message: String(error?.message || error)
    }, 502);
  }

  if (!response.ok) {
    return json({ ok: false, error: `Feed source returned HTTP ${response.status}` }, 502);
  }

  const xml = await response.text();
  if (xml.length > MAX_FEED_SIZE) {
    return json({ ok: false, error: "Feed size exceeds limit." }, 413);
  }

  const items = removeDuplicates(parseFeed(xml)).slice(0, MAX_ARTICLES);

  const output = json({
    ok: true,
    source: target.toString(),
    fetchedAt: new Date().toISOString(),
    count: items.length,
    items
  });

  ctx.waitUntil(cache.put(cacheKey, output.clone()));
  return output;
}

function parseFeed(xml) {
  const results = [];

  const rssItems = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of rssItems) {
    const title = clean(firstTag(block, "title"));
    const link = getRssLink(block);
    const description = clean(firstTag(block, "description") || firstTag(block, "content:encoded"));
    const date = firstTag(block, "pubDate") || firstTag(block, "dc:date");
    const guid = clean(firstTag(block, "guid")) || link || title;

    if (title) {
      results.push({
        id: hash(guid),
        title,
        url: link,
        description: truncate(description, 300),
        date: normalizeDate(date),
        type: "rss"
      });
    }
  }

  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const block of entries) {
    const title = clean(firstTag(block, "title"));
    const link = getAtomLink(block);
    const description = clean(firstTag(block, "summary") || firstTag(block, "content"));
    const date = firstTag(block, "updated") || firstTag(block, "published");
    const entryId = clean(firstTag(block, "id")) || link || title;

    if (title) {
      results.push({
        id: hash(entryId),
        title,
        url: link,
        description: truncate(description, 300),
        date: normalizeDate(date),
        type: "atom"
      });
    }
  }

  return results;
}

function firstTag(xml, tag) {
  const safe = tag.replace(":", "\\:");
  const match = xml.match(new RegExp(`<${safe}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${safe}>`, "i"));
  return match ? match[1] : "";
}

function getRssLink(block) {
  let link = clean(firstTag(block, "link"));
  if (link) return link;
  const match = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return match ? decodeXml(match[1]) : "";
}

function getAtomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)>/gi)];
  for (const match of links) {
    const rel = getAttr(match[1], "rel") || "alternate";
    const href = getAttr(match[1], "href");
    if (href && (rel === "alternate" || rel === "")) {
      return decodeXml(href);
    }
  }
  return "";
}

function getAttr(text, name) {
  const match = text.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? match[1] : "";
}

function clean(value) {
  if (!value) return "";
  return decodeXml(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function truncate(value, length) {
  if (value && value.length > length) {
    return value.slice(0, length) + "…";
  }
  return value || "";
}

function removeDuplicates(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = (item.url || item.title).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function isBlockedHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h === "::1") return true;
  const parts = h.split(".").map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [a, b] = parts;
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) {
      return true;
    }
  }
  return false;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      ...corsHeaders(),
      "Cache-Control": `public, max-age=${CACHE_TTL}`
    }
  });
}