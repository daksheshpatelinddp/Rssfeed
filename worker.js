const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function decodeXml(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
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
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? match[1].trim() : "";
}

function getAttribute(block, tag, attribute) {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`, "i");
  const match = block.match(re);
  return match ? decodeXml(match[1]) : "";
}

function parseRSS(xml) {
  const items = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  for (const block of itemMatches) {
    const title = cleanText(getTag(block, "title"));
    const description = cleanText(getTag(block, "description") || getTag(block, "content:encoded"));
    const link = decodeXml(getTag(block, "link")) || getTag(block, "guid");
    const date = getTag(block, "pubDate") || getTag(block, "dc:date") || getTag(block, "date");
    const guid = cleanText(getTag(block, "guid")) || link || `${title}-${date}`;

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
    const description = cleanText(getTag(block, "summary") || getTag(block, "content"));
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

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {status: 204, headers: CORS});
    }

    if (requestUrl.pathname === "/") {
      return json({
        ok: true,
        service: "MarketFeed RSS Proxy",
        endpoint: "/rss?url=RSS_URL"
      });
    }

    if (requestUrl.pathname !== "/rss") {
      return json({ok: false, error: "Endpoint not found"}, 404);
    }

    const source = requestUrl.searchParams.get("url");

    if (!source) {
      return json({ok: false, error: "Missing url parameter"}, 400);
    }

    let feedUrl;

    try {
      feedUrl = new URL(source);
    } catch {
      return json({ok: false, error: "Invalid RSS URL"}, 400);
    }

    if (!["http:", "https:"].includes(feedUrl.protocol)) {
      return json({ok: false, error: "Only HTTP and HTTPS URLs are allowed"}, 400);
    }

    try {
      let response = null;
      let lastError = "";

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);

          try {
            response = await fetch(feedUrl.toString(), {
              method: "GET",
              redirect: "follow",
              headers: {
                "User-Agent": "Mozilla/5.0 (compatible; MarketFeed RSS Reader/1.0)",
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                "Accept-Language": "en-IN,en;q=0.9"
              },
              signal: controller.signal
            });
          } finally {
            clearTimeout(timer);
          }

          if (response.ok) break;

          lastError = `Source returned HTTP ${response.status}`;

          if (![408,425,429,500,502,503,504].includes(response.status)) break;
        } catch (e) {
          lastError = e?.name==="AbortError" ? "Source request timed out" : (e?.message||"Source request failed");
        }

        if (attempt < 2) await new Promise(r=>setTimeout(r,600*(attempt+1)));
      }

      if (!response) {
        return json({ok:false,error:`RSS source unavailable: ${lastError}`},502);
      }

      if (!response.ok) {
        return json({ok:false,error:lastError||`RSS source returned HTTP ${response.status}`},502);
      }

      const xml = await response.text();

      if (!xml || xml.length < 20) {
        return json({ok:false,error:"RSS source returned an empty response"},502);
      }

      const items = parseFeed(xml);

      if (!items.length) {
        return json({ok:false,error:"The URL did not contain a readable RSS or Atom feed"},422);
      }

      return json({
        ok: true,
        items: items.slice(0, 100)
      });
    } catch (error) {
      return json({
        ok: false,
        error: error?.message || "Failed to fetch RSS feed"
      }, 502);
    }
  }
};
