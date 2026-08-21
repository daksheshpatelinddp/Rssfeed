/*
 * MarketFeed RSS Worker - V7 FIXED
 *
 * Endpoints:
 *   /                  health/status
 *   /news?q=TCS        keyword news feed
 *   /rss?url=...       proxy an existing RSS/Atom feed
 *
 * Keyword provider order:
 *   1) GDELT DOC RSS (primary)
 *   2) Bing News RSS
 *   3) Google News RSS
 *
 * The response from /news is JSON:
 *   { ok:true, source:"...", items:[...] }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      ...extra,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function xml(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/rss+xml; charset=utf-8"
    }
  });
}

function cleanText(value) {
  if (value == null) return "";
  return String(value)
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function tagValue(block, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );
  const m = block.match(re);
  return m ? decodeEntities(cleanText(m[1])) : "";
}

function attrValue(block, tag, attr) {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*\\/?>`,
    "i"
  );
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : "";
}

function parseRSS(text, limit = 50) {
  const items = [];
  const rssBlocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const atomBlocks = text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const blocks = rssBlocks.length ? rssBlocks : atomBlocks;

  for (const block of blocks.slice(0, limit)) {
    const title = tagValue(block, "title");
    let link = tagValue(block, "link");
    if (!link) link = attrValue(block, "link", "href");

    const description =
      tagValue(block, "description") ||
      tagValue(block, "summary") ||
      tagValue(block, "content");

    const published =
      tagValue(block, "pubDate") ||
      tagValue(block, "published") ||
      tagValue(block, "updated") ||
      tagValue(block, "dc:date");

    if (title || link) {
      items.push({
        title,
        link,
        description,
        published
      });
    }
  }
  return items;
}

function normalizeGDELT(data, limit = 50) {
  const rows = Array.isArray(data?.articles) ? data.articles : [];
  return rows.slice(0, limit).map(a => ({
    title: a.title || "",
    link: a.url || a.url_mobile || "",
    description: a.seendate || "",
    published: a.seendate || "",
    source: a.domain || ""
  })).filter(x => x.title || x.link);
}

async function fetchRSS(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "MarketFeed/7.0 (+RSS reader)",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
    },
    redirect: "follow"
  });

  const text = await response.text();
  return { response, text };
}

function gdeltUrl(keyword) {
  return "https://api.gdeltproject.org/api/v2/doc/doc?" +
    "query=" + encodeURIComponent(keyword) +
    "&mode=artlist" +
    "&maxrecords=50" +
    "&timespan=1week" +
    "&sort=datedesc" +
    "&format=rssarchive";
}

function bingUrl(keyword) {
  return "https://www.bing.com/news/search?q=" +
    encodeURIComponent(keyword) + "&format=rss";
}

function googleUrl(keyword) {
  return "https://news.google.com/rss/search?q=" +
    encodeURIComponent(keyword) + "&hl=en-IN&gl=IN&ceid=IN:en";
}

async function keywordNews(keyword) {
  const providers = [
    { provider: "GDELT News RSS", url: gdeltUrl(keyword) },
    { provider: "Bing News RSS", url: bingUrl(keyword) },
    { provider: "Google News RSS", url: googleUrl(keyword) }
  ];

  const attempts = [];

  for (const p of providers) {
    try {
      const { response, text } = await fetchRSS(p.url);
      const contentType = response.headers.get("content-type") || "";
      const items = parseRSS(text, 50);

      attempts.push({
        provider: p.provider,
        url: p.url,
        status: response.status,
        detail: response.ok
          ? (items.length ? `RSS parsed: ${items.length} items` : `HTTP succeeded but no RSS/Atom items found`)
          : `HTTP ${response.status}`
      });

      if (response.ok && items.length) {
        return {
          ok: true,
          source: p.provider,
          keyword,
          count: items.length,
          items,
          attempts
        };
      }

      // GDELT sometimes responds with JSON despite the requested RSS format.
      if (response.ok && contentType.includes("json")) {
        try {
          const data = JSON.parse(text);
          const jsonItems = normalizeGDELT(data, 50);
          if (jsonItems.length) {
            return {
              ok: true,
              source: "GDELT News API",
              keyword,
              count: jsonItems.length,
              items: jsonItems,
              attempts
            };
          }
        } catch (_) {}
      }
    } catch (err) {
      attempts.push({
        provider: p.provider,
        url: p.url,
        status: 0,
        detail: String(err?.message || err)
      });
    }
  }

  return {
    ok: false,
    error: "No news RSS provider could be fetched",
    keyword,
    attempts
  };
}

async function handle(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/" || path === "") {
    return json({
      ok: true,
      service: "MarketFeed RSS Proxy",
      version: "7-fixed-gdelt",
      endpoints: [
        "/rss?url=RSS_URL",
        "/news?q=KEYWORD"
      ],
      keywordProvider: "GDELT -> Bing News -> Google News"
    });
  }

  if (path === "/news") {
    const keyword = (url.searchParams.get("q") || "").trim();
    if (!keyword) {
      return json({ ok: false, error: "Missing q parameter" }, 400);
    }
    return json(await keywordNews(keyword));
  }

  if (path === "/rss") {
    const target = (url.searchParams.get("url") || "").trim();
    if (!target) {
      return json({ ok: false, error: "Missing url parameter" }, 400);
    }

    let targetURL;
    try {
      targetURL = new URL(target);
      if (!["http:", "https:"].includes(targetURL.protocol)) {
        throw new Error("Only HTTP/HTTPS URLs are allowed");
      }
    } catch (_) {
      return json({ ok: false, error: "Invalid RSS URL" }, 400);
    }

    try {
      const { response, text } = await fetchRSS(targetURL.toString());
      if (!response.ok) {
        return json({
          ok: false,
          error: "RSS source returned HTTP " + response.status,
          status: response.status,
          url: targetURL.toString()
        }, 502);
      }

      return xml(text, 200);
    } catch (err) {
      return json({
        ok: false,
        error: "RSS fetch failed",
        detail: String(err?.message || err),
        url: targetURL.toString()
      }, 502);
    }
  }

  return json({ ok: false, error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    return handle(request);
  }
};
