const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

const VERSION = "7-news-fallback-fixed";

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

function decodeXml(str = "") {
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch (_) { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch (_) { return ""; }
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanText(str = "") {
  return decodeXml(str)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(block, tag) {
  const escaped = tag.replace(/:/g, "\\:");
  const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i");
  const match = block.match(re);
  return match ? match[1].trim() : "";
}

function getAttribute(block, tag, attribute) {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = block.match(re);
  return match ? decodeXml(match[1]) : "";
}

function parseRSS(xml) {
  const items = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  for (const block of itemMatches) {
    const title = cleanText(getTag(block, "title"));
    const description = cleanText(
      getTag(block, "description") || getTag(block, "content:encoded")
    );

    let link = decodeXml(getTag(block, "link"));
    if (!link) link = getAttribute(block, "link", "href");
    if (!link) link = cleanText(getTag(block, "guid"));

    // Bing News may return a redirect URL. Extract the real article URL.
    try {
      const u = new URL(link);
      if (u.hostname === "www.bing.com" && u.pathname === "/news/apiclick.aspx") {
        const real = u.searchParams.get("url");
        if (real) link = real;
      }
    } catch (_) {}

    const date =
      getTag(block, "pubDate") ||
      getTag(block, "dc:date") ||
      getTag(block, "date");

    const guid =
      cleanText(getTag(block, "guid")) ||
      link ||
      `${title}-${date}`;

    if (title || link) {
      items.push({
        id: guid,
        title,
        description,
        url: link,
        date: date || new Date().toISOString()
      });
    }
  }

  return items;
}

function parseAtom(xml) {
  const items = [];
  const entryMatches = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  for (const block of entryMatches) {
    const title = cleanText(getTag(block, "title"));
    const description = cleanText(
      getTag(block, "summary") || getTag(block, "content")
    );

    let link = getAttribute(block, "link", "href");
    if (!link) link = decodeXml(getTag(block, "link"));

    const date = getTag(block, "published") || getTag(block, "updated");
    const id = cleanText(getTag(block, "id")) || link || `${title}-${date}`;

    if (title || link) {
      items.push({
        id,
        title,
        description,
        url: link,
        date: date || new Date().toISOString()
      });
    }
  }

  return items;
}

function parseFeed(xml) {
  if (/<item\b/i.test(xml)) return parseRSS(xml);
  if (/<entry\b/i.test(xml)) return parseAtom(xml);
  return [];
}

function requestHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/151.0 Mobile Safari/537.36",
    "Accept":
      "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-IN,en;q=0.9"
  };
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: requestHeaders(),
      signal: controller.signal
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || url,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText:
        error?.name === "AbortError"
          ? "Request timed out"
          : (error?.message || "Network request failed"),
      finalUrl: url,
      text: ""
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOnce(url) {
  return await fetchText(url, 15000);
}

function newsUrls(query) {
  const encoded = encodeURIComponent(query);

  // Bing News RSS is used first because Google News currently returns
  // HTTP 503 from the Cloudflare Worker edge for this deployment.
  const bing = new URL("https://www.bing.com/news/search");
  bing.searchParams.set("q", query);
  bing.searchParams.set("format", "RSS");
  bing.searchParams.set("setmkt", "en-IN");
  bing.searchParams.set("cc", "IN");

  // Keep Google News as a fallback if Google becomes reachable again.
  const google = new URL("https://news.google.com/rss/search");
  google.searchParams.set("q", query);
  google.searchParams.set("hl", "en-IN");
  google.searchParams.set("gl", "IN");
  google.searchParams.set("ceid", "IN:en");

  return [
    { provider: "Bing News RSS", url: bing.toString() },
    { provider: "Google News RSS", url: google.toString() }
  ];
}

async function fetchNews(query) {
  const attempts = [];

  for (const candidate of newsUrls(query)) {
    const result = await fetchOnce(candidate.url);

    if (result.ok) {
      const items = parseFeed(result.text);

      if (items.length) {
        return {
          ok: true,
          source: candidate.provider,
          sourceUrl: result.finalUrl,
          items: items.slice(0, 100),
          attempts
        };
      }

      attempts.push({
        provider: candidate.provider,
        url: candidate.url,
        status: result.status,
        detail: "HTTP succeeded but no RSS/Atom items were found"
      });
    } else {
      attempts.push({
        provider: candidate.provider,
        url: candidate.url,
        status: result.status,
        detail: result.statusText
      });
    }
  }

  return {
    ok: false,
    error: "No news RSS provider could be fetched",
    attempts
  };
}

function sanitizeItems(items) {
  return items
    .map((x, i) => ({
      id: String(x.id || x.url || `${x.title || "story"}-${i}`),
      title: cleanText(x.title || ""),
      description: cleanText(x.description || ""),
      url: x.url || "",
      date: x.date || new Date().toISOString()
    }))
    .filter(x => x.title || x.url);
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "GET requests only" }, 405);
    }

    if (requestUrl.pathname === "/") {
      return json({
        ok: true,
        service: "MarketFeed RSS Proxy",
        version: VERSION,
        keywordMode: "Bing News RSS with Google News fallback",
        endpoints: ["/rss?url=RSS_URL", "/news?q=KEYWORD"]
      });
    }

    if (requestUrl.pathname === "/news") {
      const query = (requestUrl.searchParams.get("q") || "").trim();

      if (!query) {
        return json({ ok: false, error: "Missing q parameter" }, 400);
      }

      if (query.length > 100) {
        return json(
          { ok: false, error: "Keyword search is limited to 100 characters" },
          400
        );
      }

      const result = await fetchNews(query);

      if (!result.ok) {
        return json(
          {
            ok: false,
            error: result.error,
            attempts: result.attempts
          },
          502
        );
      }

      const items = sanitizeItems(result.items);

      return json({
        ok: true,
        source: result.source,
        sourceUrl: result.sourceUrl,
        count: items.length,
        items
      });
    }

    if (requestUrl.pathname !== "/rss") {
      return json({ ok: false, error: "Endpoint not found" }, 404);
    }

    const source = requestUrl.searchParams.get("url");

    if (!source) {
      return json({ ok: false, error: "Missing url parameter" }, 400);
    }

    let feedUrl;

    try {
      feedUrl = new URL(source);
    } catch (_) {
      return json({ ok: false, error: "Invalid RSS URL" }, 400);
    }

    if (!["http:", "https:"].includes(feedUrl.protocol)) {
      return json(
        { ok: false, error: "Only HTTP and HTTPS URLs are allowed" },
        400
      );
    }

    const result = await fetchText(feedUrl.toString(), 20000);

    if (!result.ok) {
      return json(
        {
          ok: false,
          error: `RSS source returned HTTP ${result.status || "network error"}`,
          detail: result.statusText,
          source: feedUrl.hostname
        },
        502
      );
    }

    if (!result.text || result.text.length < 20) {
      return json(
        {
          ok: false,
          error: "RSS source returned an empty response",
          source: feedUrl.hostname
        },
        502
      );
    }

    const items = sanitizeItems(parseFeed(result.text));

    if (!items.length) {
      return json(
        {
          ok: false,
          error: "The URL did not contain a readable RSS or Atom feed",
          source: feedUrl.hostname
        },
        422
      );
    }

    return json({
      ok: true,
      source: feedUrl.toString(),
      count: items.length,
      items: items.slice(0, 100)
    });
  }
};
