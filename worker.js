const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

async function fetchText(url, timeoutMs = 20000) {
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
      statusText: error?.name === "AbortError"
        ? "Request timed out"
        : (error?.message || "Network request failed"),
      finalUrl: url,
      text: ""
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, attempts = 3) {
  let last = null;

  for (let i = 0; i < attempts; i++) {
    last = await fetchText(url);

    if (last.ok) return last;

    // Retry transient failures only.
    if (![0, 408, 425, 429, 500, 502, 503, 504].includes(last.status)) {
      return last;
    }

    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 800 * (i + 1)));
    }
  }

  return last;
}

function googleNewsUrls(query) {
  const encoded = encodeURIComponent(query);

  // Primary current Google News RSS search endpoint.
  const primary = new URL("https://news.google.com/rss/search");
  primary.searchParams.set("q", query);
  primary.searchParams.set("hl", "en-IN");
  primary.searchParams.set("gl", "IN");
  primary.searchParams.set("ceid", "IN:en");

  // Compatibility endpoint used by older Google News RSS implementations.
  const legacy =
    `https://news.google.com/news/rss/search/section/q/${encoded}` +
    `?hl=en-IN&gl=IN&ceid=IN:en`;

  return [primary.toString(), legacy];
}

async function fetchGoogleNews(query) {
  const urls = googleNewsUrls(query);
  const failures = [];

  for (const url of urls) {
    const result = await fetchWithRetry(url, 2);

    if (result.ok) {
      const items = parseFeed(result.text);

      if (items.length) {
        return {
          ok: true,
          source: "Google News RSS",
          sourceUrl: result.finalUrl,
          items: items.slice(0, 100)
        };
      }

      failures.push({
        url,
        status: result.status,
        detail: "HTTP succeeded but no RSS/Atom items were found"
      });
      continue;
    }

    failures.push({
      url,
      status: result.status,
      detail: result.statusText
    });
  }

  return {
    ok: false,
    error: "Google News RSS could not be fetched",
    attempts: failures
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
        version: "7-google-news-fixed",
        endpoints: [
          "/rss?url=RSS_URL",
          "/news?q=KEYWORD"
        ]
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

      const result = await fetchGoogleNews(query);

      if (!result.ok) {
        // Deliberately expose useful diagnostics so the MarketFeed UI
        // does not hide the real upstream problem behind a generic 502.
        return json(
          {
            ok: false,
            error: result.error,
            source: "Google News RSS",
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

    const result = await fetchWithRetry(feedUrl.toString(), 3);

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
