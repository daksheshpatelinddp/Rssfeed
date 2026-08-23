/* MarketFeed RSS Worker - V9 MULTI-SOURCE
 *
 * Endpoints:
 *   /                         health/status
 *   /news?q=TCS               multi-source keyword news
 *   /rss?url=...              existing RSS/Atom proxy
 *
 * Keyword sources:
 *   - GDELT News RSS
 *   - Bing News RSS
 *   - Google News RSS
 *
 * IMPORTANT:
 *   All keyword providers are fetched together.
 *   Results are merged and deduplicated.
 *   No NewsData.io API.
 *   No GNews API.
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


/* ================= TEXT HELPERS ================= */

function cleanText(value) {
  if (value == null) return "";

  return String(value)
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/gi, "")
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
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}


function tagValue(block, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const m = block.match(re);

  return m
    ? decodeEntities(cleanText(m[1]))
    : "";
}


function attrValue(block, tag, attr) {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*\\/?>`,
    "i"
  );

  const m = block.match(re);

  return m
    ? decodeEntities(m[1])
    : "";
}


/* ================= RSS PARSER ================= */

function parseRSS(text, limit = 50) {
  const items = [];

  const rssBlocks =
    text.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  const atomBlocks =
    text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  const blocks =
    rssBlocks.length
      ? rssBlocks
      : atomBlocks;

  for (const block of blocks.slice(0, limit)) {

    const title =
      tagValue(block, "title");

    let link =
      tagValue(block, "link");

    if (!link) {
      link =
        attrValue(block, "link", "href");
    }

    const description =
      tagValue(block, "description") ||
      tagValue(block, "summary") ||
      tagValue(block, "content");

    const published =
      tagValue(block, "pubDate") ||
      tagValue(block, "published") ||
      tagValue(block, "updated") ||
      tagValue(block, "dc:date");

    const guid =
      tagValue(block, "guid") ||
      tagValue(block, "id");

    if (title || link) {
      items.push({
        title,
        link,
        description,
        published,
        guid
      });
    }
  }

  return items;
}


/* ================= FETCH RSS ================= */

async function fetchRSS(url) {

  const response = await fetch(url, {
    method: "GET",

    headers: {
      "User-Agent":
        "MarketFeed/9.0 (+RSS reader)",

      "Accept":
        "application/rss+xml, " +
        "application/atom+xml, " +
        "application/xml, " +
        "text/xml, " +
        "*/*"
    },

    redirect: "follow"
  });

  const text =
    await response.text();

  return {
    response,
    text
  };
}


/* ================= SOURCE URLS ================= */

function gdeltUrl(keyword) {

  return (
    "https://api.gdeltproject.org/api/v2/doc/doc?" +
    "query=" +
    encodeURIComponent(keyword) +
    "&mode=artlist" +
    "&maxrecords=50" +
    "&timespan=1week" +
    "&sort=datedesc" +
    "&format=rssarchive"
  );
}


function bingUrl(keyword) {

  return (
    "https://www.bing.com/news/search?q=" +
    encodeURIComponent(keyword) +
    "&format=rss"
  );
}


function googleUrl(keyword) {

  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(keyword) +
    "&hl=en-IN" +
    "&gl=IN" +
    "&ceid=IN:en"
  );
}


/* ================= NORMALIZATION ================= */

function normalizeItem(item, provider) {

  return {
    title: item.title || "",
    link: item.link || item.url || "",
    description: item.description || "",
    published:
      item.published ||
      item.date ||
      "",
    guid:
      item.guid ||
      item.link ||
      item.url ||
      "",
    source:
      item.source ||
      provider
  };
}


/* ================= DEDUPLICATION ================= */

function normalizeForCompare(value) {

  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/^www\./, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function dedupeNews(items) {

  const seenLinks =
    new Set();

  const seenTitles =
    new Set();

  const result = [];

  for (const item of items) {

    const link =
      normalizeForCompare(item.link);

    const title =
      normalizeForCompare(item.title);

    /*
     * URL is strongest duplicate key.
     */

    if (link && seenLinks.has(link)) {
      continue;
    }

    /*
     * Same title from different providers
     * is normally the same news article.
     */

    if (title && seenTitles.has(title)) {
      continue;
    }

    if (link) {
      seenLinks.add(link);
    }

    if (title) {
      seenTitles.add(title);
    }

    result.push(item);
  }

  return result;
}


/* ================= KEYWORD NEWS ================= */

async function fetchProvider(provider, url) {

  try {

    const {
      response,
      text
    } = await fetchRSS(url);

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (!response.ok) {

      return {
        provider,
        ok: false,
        status: response.status,
        items: [],
        detail:
          "HTTP " +
          response.status
      };
    }

    /*
     * All three keyword sources are
     * expected to return RSS.
     */

    const items =
      parseRSS(text, 50)
        .map(x =>
          normalizeItem(
            x,
            provider
          )
        )
        .filter(x =>
          x.title || x.link
        );

    /*
     * Keep a small diagnostic entry.
     * This helps identify a source that
     * stops returning RSS.
     */

    return {
      provider,
      ok: true,
      status: response.status,
      items,
      detail:
        "RSS parsed: " +
        items.length +
        " items",
      contentType
    };

  } catch (err) {

    return {
      provider,
      ok: false,
      status: 0,
      items: [],
      detail:
        String(
          err?.message ||
          err
        )
    };
  }
}


async function keywordNews(keyword) {

  const providers = [

    {
      provider:
        "GDELT News RSS",

      url:
        gdeltUrl(keyword)
    },

    {
      provider:
        "Bing News RSS",

      url:
        bingUrl(keyword)
    },

    {
      provider:
        "Google News RSS",

      url:
        googleUrl(keyword)
    }

  ];


  /*
   * IMPORTANT:
   *
   * Promise.all means the three
   * providers are requested together.
   *
   * We do NOT stop when one succeeds.
   */

  const attempts =
    await Promise.all(
      providers.map(p =>
        fetchProvider(
          p.provider,
          p.url
        )
      )
    );


  /*
   * Merge all successful results.
   */

  const merged = [];

  for (const attempt of attempts) {

    if (
      attempt.ok &&
      attempt.items.length
    ) {

      merged.push(
        ...attempt.items
      );
    }
  }


  /*
   * Remove duplicate articles
   * appearing in multiple sources.
   */

  const items =
    dedupeNews(merged);


  /*
   * Sort newest first where a
   * usable publication date exists.
   */

  items.sort((a, b) => {

    const da =
      Date.parse(
        a.published || ""
      );

    const db =
      Date.parse(
        b.published || ""
      );

    if (
      Number.isFinite(da) &&
      Number.isFinite(db)
    ) {
      return db - da;
    }

    if (
      Number.isFinite(db)
    ) {
      return 1;
    }

    if (
      Number.isFinite(da)
    ) {
      return -1;
    }

    return 0;
  });


  if (!items.length) {

    return {
      ok: false,

      error:
        "No news could be fetched " +
        "from Google News RSS, " +
        "GDELT, or Bing News RSS",

      keyword,

      count: 0,

      items: [],

      attempts:
        attempts.map(x => ({
          provider: x.provider,
          ok: x.ok,
          status: x.status,
          detail: x.detail
        }))
    };
  }


  return {

    ok: true,

    source:
      "Google News RSS + GDELT + Bing News RSS",

    keyword,

    count:
      items.length,

    items,

    attempts:
      attempts.map(x => ({
        provider:
          x.provider,

        ok:
          x.ok,

        status:
          x.status,

        count:
          x.items.length,

        detail:
          x.detail
      }))
  };
}


/* ================= REQUEST HANDLER ================= */

async function handle(request) {

  if (
    request.method ===
    "OPTIONS"
  ) {
    return new Response(
      null,
      {
        status: 204,
        headers: CORS
      }
    );
  }


  const url =
    new URL(
      request.url
    );

  const path =
    url.pathname;


  /* ================= HEALTH ================= */

  if (
    path === "/" ||
    path === ""
  ) {

    return json({

      ok: true,

      service:
        "MarketFeed RSS Proxy",

      version:
        "9-multisource",

      endpoints: [
        "/rss?url=RSS_URL",
        "/news?q=KEYWORD"
      ],

      keywordProviders: [
        "Google News RSS",
        "GDELT News RSS",
        "Bing News RSS"
      ]

    });
  }


  /* ================= KEYWORD NEWS ================= */

  if (
    path === "/news"
  ) {

    const keyword =
      (
        url.searchParams.get("q") ||
        ""
      ).trim();


    if (!keyword) {

      return json(
        {
          ok: false,
          error:
            "Missing q parameter"
        },
        400
      );
    }


    return json(
      await keywordNews(
        keyword
      )
    );
  }


  /* ================= EXISTING RSS ================= */

  if (
    path === "/rss"
  ) {

    const target =
      (
        url.searchParams.get("url") ||
        ""
      ).trim();


    if (!target) {

      return json(
        {
          ok: false,
          error:
            "Missing url parameter"
        },
        400
      );
    }


    let targetURL;

    try {

      targetURL =
        new URL(target);

      if (
        ![
          "http:",
          "https:"
        ].includes(
          targetURL.protocol
        )
      ) {
        throw new Error(
          "Only HTTP/HTTPS URLs are allowed"
        );
      }

    } catch (_) {

      return json(
        {
          ok: false,
          error:
            "Invalid RSS URL"
        },
        400
      );
    }


    try {

      const {
        response,
        text
      } =
        await fetchRSS(
          targetURL.toString()
        );


      if (!response.ok) {

        return json(
          {
            ok: false,

            error:
              "RSS source returned HTTP " +
              response.status,

            status:
              response.status,

            url:
              targetURL.toString()
          },
          502
        );
      }


      const items =
        parseRSS(
          text,
          50
        );


      if (!items.length) {

        return json(
          {
            ok: false,

            error:
              "RSS/Atom feed returned no readable items",

            url:
              targetURL.toString()
          },
          502
        );
      }


      return json({

        ok: true,

        source:
          targetURL.hostname,

        url:
          targetURL.toString(),

        count:
          items.length,

        items

      });

    } catch (err) {

      return json(
        {
          ok: false,

          error:
            "RSS fetch failed",

          detail:
            String(
              err?.message ||
              err
            ),

          url:
            targetURL.toString()
        },
        502
      );
    }
  }


  /* ================= NOT FOUND ================= */

  return json(
    {
      ok: false,
      error:
        "Not found"
    },
    404
  );
}


export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    return handle(
      request
    );

  }

};