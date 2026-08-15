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

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "MarketFeed RSS Proxy",
        version: "1.0.0",
        time: new Date().toISOString()
      });
    }

    // RSS endpoint
    if (url.pathname !== "/rss") {
      return json({
        ok: false,
        error: "Unknown endpoint.",
        usage: "/rss?url=https://example.com/feed.xml"
      }, 404);
    }

    const feedUrl = url.searchParams.get("url");

    if (!feedUrl) {
      return json({
        ok: false,
        error: "Missing url parameter.",
        usage: "/rss?url=https://example.com/feed.xml"
      }, 400);
    }

    let target;

    try {
      target = new URL(feedUrl);
    } catch {
      return json({
        ok: false,
        error: "Invalid URL."
      }, 400);
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return json({
        ok: false,
        error: "Only HTTP/HTTPS URLs are allowed."
      }, 400);
    }

    // Basic protection against localhost/private network URLs
    if (isBlockedHostname(target.hostname)) {
      return json({
        ok: false,
        error: "Private/local hostnames are not allowed."
      }, 403);
    }

    return fetchFeed(target, ctx);
  }
};


async function fetchFeed(target, ctx) {

  const cache = caches.default;

  const cacheKey = new Request(
    "https://marketfeed-cache.invalid/rss/" +
    encodeURIComponent(target.toString())
  );

  // Return cached feed if available
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
        "User-Agent":
          "MarketFeed/1.0 personal RSS reader",

        "Accept":
          "application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain, */*"
      }
    });

  } catch (error) {

    return json({
      ok: false,
      error: "Could not fetch RSS source.",
      message: String(error?.message || error)
    }, 502);

  }


  if (!response.ok) {

    return json({
      ok: false,
      error: `RSS source returned HTTP ${response.status}`,
      source: target.toString()
    }, 502);

  }


  const contentLength =
    Number(response.headers.get("content-length") || 0);

  if (contentLength > MAX_FEED_SIZE) {

    return json({
      ok: false,
      error: "RSS feed is too large."
    }, 413);

  }


  const xml = await response.text();


  if (xml.length > MAX_FEED_SIZE) {

    return json({
      ok: false,
      error: "RSS feed is too large."
    }, 413);

  }


  const items =
    removeDuplicates(
      parseFeed(xml)
    ).slice(0, MAX_ARTICLES);


  const output = json({
    ok: true,
    source: target.toString(),
    fetchedAt: new Date().toISOString(),
    count: items.length,
    items
  });


  // Store in Cloudflare cache
  ctx.waitUntil(
    cache.put(
      cacheKey,
      output.clone()
    )
  );


  return output;
}


/* =========================
   RSS / ATOM PARSER
   ========================= */

function parseFeed(xml) {

  const results = [];


  /*
   * RSS 2.0
   */

  const rssItems =
    xml.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];


  for (const block of rssItems) {

    const title =
      clean(
        firstTag(block, "title")
      );


    const link =
      getRssLink(block);


    const description =
      clean(
        firstTag(block, "description") ||
        firstTag(block, "content:encoded")
      );


    const date =
      firstTag(block, "pubDate") ||
      firstTag(block, "dc:date");


    const guid =
      clean(
        firstTag(block, "guid")
      ) ||
      link ||
      title;


    const author =
      clean(
        firstTag(block, "author") ||
        firstTag(block, "dc:creator")
      );


    if (title) {

      results.push({

        id: hash(guid),

        title,

        url: link,

        description:
          truncate(
            description,
            4000
          ),

        date:
          normalizeDate(date),

        author,

        type: "rss"

      });

    }

  }


  /*
   * Atom
   */

  const entries =
    xml.match(
      /<entry\b[\s\S]*?<\/entry>/gi
    ) || [];


  for (const block of entries) {

    const title =
      clean(
        firstTag(block, "title")
      );


    const link =
      getAtomLink(block);


    const description =
      clean(
        firstTag(block, "summary") ||
        firstTag(block, "content")
      );


    const date =
      firstTag(block, "updated") ||
      firstTag(block, "published");


    const entryId =
      clean(
        firstTag(block, "id")
      ) ||
      link ||
      title;


    const author =
      clean(
        firstTag(block, "name")
      );


    if (title) {

      results.push({

        id: hash(entryId),

        title,

        url: link,

        description:
          truncate(
            description,
            4000
          ),

        date:
          normalizeDate(date),

        author,

        type: "atom"

      });

    }

  }


  return results;
}


/* =========================
   XML HELPERS
   ========================= */

function firstTag(xml, tag) {

  const safe =
    tag.replace(":", "\\:");

  const regex =
    new RegExp(
      `<${safe}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${safe}>`,
      "i"
    );

  const match =
    xml.match(regex);

  return match
    ? match[1]
    : "";
}


function getRssLink(block) {

  let link =
    clean(
      firstTag(block, "link")
    );


  if (link) {
    return link;
  }


  const match =
    block.match(
      /<link[^>]+href=["']([^"']+)["'][^>]*>/i
    );


  return match
    ? decodeXml(match[1])
    : "";
}


function getAtomLink(block) {

  const links =
    [
      ...block.matchAll(
        /<link\b([^>]*)>/gi
      )
    ];


  for (const match of links) {

    const attributes =
      match[1];


    const rel =
      getAttr(
        attributes,
        "rel"
      ) ||
      "alternate";


    const href =
      getAttr(
        attributes,
        "href"
      );


    if (
      href &&
      (
        rel === "alternate" ||
        rel === ""
      )
    ) {

      return decodeXml(href);

    }

  }


  return "";
}


function getAttr(text, name) {

  const regex =
    new RegExp(
      `${name}\\s*=\\s*["']([^"']+)["']`,
      "i"
    );


  const match =
    text.match(regex);


  return match
    ? match[1]
    : "";
}


/* =========================
   CLEAN XML / HTML
   ========================= */

function clean(value) {

  if (!value) {
    return "";
  }


  return decodeXml(

    value

      .replace(
        /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
        "$1"
      )

      .replace(
        /<script[\s\S]*?<\/script>/gi,
        ""
      )

      .replace(
        /<style[\s\S]*?<\/style>/gi,
        ""
      )

      .replace(
        /<[^>]+>/g,
        " "
      )

      .replace(
        /\s+/g,
        " "
      )

      .trim()

  );
}


function decodeXml(value) {

  return value

    .replace(
      /&amp;/g,
      "&"
    )

    .replace(
      /&lt;/g,
      "<"
    )

    .replace(
      /&gt;/g,
      ">"
    )

    .replace(
      /&quot;/g,
      '"'
    )

    .replace(
      /&#39;/g,
      "'"
    )

    .replace(
      /&#x27;/gi,
      "'"
    )

    .replace(
      /&#(\d+);/g,
      (_, n) =>
        String.fromCharCode(
          Number(n)
        )
    )

    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) =>
        String.fromCharCode(
          parseInt(n, 16)
        )
    );

}


/* =========================
   DATE
   ========================= */

function normalizeDate(value) {

  if (!value) {
    return null;
  }


  const date =
    new Date(value);


  return Number.isNaN(
    date.getTime()
  )
    ? value
    : date.toISOString();
}


/* =========================
   TEXT
   ========================= */

function truncate(value, length) {

  if (
    value &&
    value.length > length
  ) {

    return (
      value.slice(0, length) +
      "…"
    );

  }


  return value || "";
}


/* =========================
   DUPLICATE REMOVAL
   ========================= */

function removeDuplicates(items) {

  const seen =
    new Set();

  const output =
    [];


  for (const item of items) {

    const key =
      normalizeKey(
        item.url
      ) ||
      normalizeKey(
        item.title
      );


    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }


    seen.add(key);

    output.push(item);

  }


  return output;
}


function normalizeKey(value) {

  return String(
    value || ""
  )

    .toLowerCase()

    .trim()

    .replace(
      /^https?:\/\//,
      ""
    )

    .replace(
      /^www\./,
      ""
    )

    .replace(
      /[?#].*$/,
      ""
    )

    .replace(
      /\/$/,
      ""
    );

}


/* =========================
   SIMPLE ID HASH
   ========================= */

function hash(str) {

  let h = 0;


  for (
    let i = 0;
    i < str.length;
    i++
  ) {

    h =
      ((h << 5) - h) +
      str.charCodeAt(i);

    h |= 0;

  }


  return Math
    .abs(h)
    .toString(36);
}


/* =========================
   PRIVATE HOST PROTECTION
   ========================= */

function isBlockedHostname(hostname) {

  const h =
    hostname.toLowerCase();


  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1"
  ) {

    return true;

  }


  const parts =
    h.split(".")
      .map(Number);


  if (
    parts.length === 4 &&
    parts.every(
      Number.isFinite
    )
  ) {

    const [
      a,
      b
    ] = parts;


    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31)
    ) {

      return true;

    }

  }


  return false;
}


/* =========================
   CORS
   ========================= */

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, X-API-Key",

    "Access-Control-Max-Age":
      "86400"

  };

}


function withCors(response) {

  const headers =
    new Headers(
      response.headers
    );


  for (
    const [
      key,
      value
    ] of Object.entries(
      corsHeaders()
    )
  ) {

    headers.set(
      key,
      value
    );

  }


  return new Response(
    response.body,
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers

    }
  );
}


/* =========================
   JSON RESPONSE
   ========================= */

function json(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {

      status,

      headers: {

        "Content-Type":
          "application/json; charset=UTF-8",

        ...corsHeaders(),

        "Cache-Control":
          `public, max-age=${CACHE_TTL}`

      }

    }

  );

}
