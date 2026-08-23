/*
 * MarketFeed RSS Worker - V12 BASE
 *
 * PRE-BSE-ISOLATION BASE
 *
 * Sources:
 *   Google News RSS
 *   GDELT News RSS
 *   Bing News RSS
 *   BSE Corporate Announcements RSS
 *
 * Endpoints:
 *   /
 *   /news?q=TCS
 *   /rss?url=RSS_URL
 *
 * Main news window:
 *   Last 6 hours
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store"
};


/* =========================================================
   RESPONSE
   ========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}


/* =========================================================
   TEXT
   ========================================================= */

function cleanText(value) {
  if (value == null) return "";

  return String(value)
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function decodeEntities(value) {
  return String(value || "")
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

  const match = block.match(re);

  return match
    ? decodeEntities(cleanText(match[1]))
    : "";
}


function attrValue(block, tag, attr) {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*\\/?>`,
    "i"
  );

  const match = block.match(re);

  return match
    ? decodeEntities(match[1])
    : "";
}


/* =========================================================
   RSS PARSER
   ========================================================= */

function parseRSS(text, limit = 50) {

  const items = [];

  const rss =
    text.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  const atom =
    text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  const blocks = rss.length ? rss : atom;

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

    const scripcode =
      tagValue(block, "scripcode");

    if (title || link) {
      items.push({
        title,
        link,
        description,
        published,
        guid,
        scripcode
      });
    }
  }

  return items;
}


/* =========================================================
   RSS FETCH
   ========================================================= */

async function fetchRSS(url) {

  const response = await fetch(
    url,
    {
      method: "GET",
      headers: {
        "User-Agent":
          "MarketFeed/12.0",
        "Accept":
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
      },
      redirect: "follow"
    }
  );

  return {
    response,
    text: await response.text()
  };
}


/* =========================================================
   NEWS SOURCE URLS
   ========================================================= */

function googleUrl(keyword) {
  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(keyword) +
    "&hl=en-IN" +
    "&gl=IN" +
    "&ceid=IN:en"
  );
}


function bingUrl(keyword) {
  return (
    "https://www.bing.com/news/search?q=" +
    encodeURIComponent(keyword) +
    "&format=rss"
  );
}


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


/* =========================================================
   BSE RSS
   ========================================================= */

const BSE_ANNOUNCEMENT_RSS =
  "https://beta.bseindia.com/data/xml/announcements.xml";


/* =========================================================
   DATE PARSING
   ========================================================= */

function parseDate(value) {

  if (!value) return NaN;

  let timestamp =
    Date.parse(value);

  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  /*
   * BSE format:
   * 23-Aug-2026 20:37:08
   */

  const m =
    String(value).match(
      /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
    );

  if (m) {

    const months = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11
    };

    const month =
      months[m[2]];

    if (month !== undefined) {

      return Date.UTC(
        Number(m[3]),
        month,
        Number(m[1]),
        Number(m[4]) - 5,
        Number(m[5]) - 30,
        Number(m[6])
      );
    }
  }

  return NaN;
}


/* =========================================================
   KEYWORD MATCH
   ========================================================= */

function keywordMatches(item, keyword) {

  const q =
    String(keyword || "")
      .toLowerCase()
      .trim();

  if (!q) return true;

  const text =
    [
      item.title,
      item.description,
      item.company,
      item.scripcode,
      item.scripCode
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  if (text.includes(q)) {
    return true;
  }

  const words =
    q.split(/\s+/)
      .filter(x => x.length >= 2);

  return (
    words.length > 0 &&
    words.every(
      word => text.includes(word)
    )
  );
}


/* =========================================================
   GENERIC PROVIDER
   ========================================================= */

async function fetchProvider(
  provider,
  url,
  keyword,
  limit = 50
) {

  try {

    const {
      response,
      text
    } = await fetchRSS(url);

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

    const parsed =
      parseRSS(text, limit);

    const items =
      parsed.map(item => ({
        title:
          item.title || "",

        link:
          item.link || "",

        description:
          item.description || "",

        published:
          item.published || "",

        guid:
          item.guid ||
          item.link ||
          "",

        source:
          provider,

        scripcode:
          item.scripcode || ""
      }))
      .filter(item =>
        item.title ||
        item.link
      );

    return {
      provider,
      ok: true,
      status: response.status,
      items,
      detail:
        "RSS parsed: " +
        items.length +
        " items"
    };

  } catch (error) {

    return {
      provider,
      ok: false,
      status: 0,
      items: [],
      detail:
        String(
          error?.message ||
          error
        )
    };
  }
}


/* =========================================================
   BSE PROVIDER
   ========================================================= */

async function fetchBSE(keyword) {

  try {

    const {
      response,
      text
    } =
      await fetchRSS(
        BSE_ANNOUNCEMENT_RSS
      );

    if (!response.ok) {

      return {
        provider:
          "BSE Corporate Announcements",

        ok: false,

        status:
          response.status,

        items: [],

        detail:
          "BSE RSS HTTP " +
          response.status
      };
    }

    const parsed =
      parseRSS(
        text,
        1000
      );

    /*
     * BSE RSS contains:
     *
     * title
     * link
     * scripcode
     * description
     * pubDate
     */

    const now =
      Date.now();

    const sixHoursAgo =
      now -
      6 * 60 * 60 * 1000;

    const items = [];

    for (const item of parsed) {

      const publishedMs =
        parseDate(
          item.published
        );

      if (
        !Number.isFinite(
          publishedMs
        )
      ) {
        continue;
      }

      if (
        publishedMs <
        sixHoursAgo
      ) {
        continue;
      }

      if (
        !keywordMatches(
          {
            ...item,
            scripcode:
              item.scripcode
          },
          keyword
        )
      ) {
        continue;
      }

      items.push({

        title:
          item.title,

        link:
          item.link,

        description:
          item.description,

        published:
          item.published,

        guid:
          item.guid ||
          item.link,

        source:
          "BSE Corporate Announcements",

        scripcode:
          item.scripcode || ""
      });
    }

    return {

      provider:
        "BSE Corporate Announcements",

      ok: true,

      status:
        response.status,

      items,

      detail:
        "BSE RSS: " +
        parsed.length +
        " total, " +
        items.length +
        " matching last 6 hours"

    };

  } catch (error) {

    return {

      provider:
        "BSE Corporate Announcements",

      ok: false,

      status: 0,

      items: [],

      detail:
        String(
          error?.message ||
          error
        )
    };
  }
}


/* =========================================================
   DEDUP
   ========================================================= */

function normalizeCompare(value) {

  return String(value || "")
    .toLowerCase()
    .replace(
      /https?:\/\//g,
      ""
    )
    .replace(
      /^www\./,
      ""
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function dedupe(items) {

  const links =
    new Set();

  const titles =
    new Set();

  const result =
    [];

  for (const item of items) {

    const link =
      normalizeCompare(
        item.link
      );

    const title =
      normalizeCompare(
        item.title
      );

    if (
      link &&
      links.has(link)
    ) {
      continue;
    }

    if (
      title &&
      titles.has(title)
    ) {
      continue;
    }

    if (link) {
      links.add(link);
    }

    if (title) {
      titles.add(title);
    }

    result.push(item);
  }

  return result;
}


/* =========================================================
   NEWS
   ========================================================= */

async function getNews(keyword) {

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
   * RSS providers and BSE
   * are independent.
   */

  const [
    rssResults,
    bseResult
  ] =
    await Promise.all([

      Promise.all(
        providers.map(
          p =>
            fetchProvider(
              p.provider,
              p.url,
              keyword,
              50
            )
        )
      ),

      fetchBSE(keyword)

    ]);


  const merged = [];


  for (
    const result
    of rssResults
  ) {

    if (result.ok) {

      merged.push(
        ...result.items
      );
    }
  }


  if (bseResult.ok) {

    merged.push(
      ...bseResult.items
    );
  }


  let items =
    dedupe(merged);


  /*
   * Keep only recent results.
   *
   * This prevents the huge response
   * that we were seeing previously.
   */

  const now =
    Date.now();

  const sixHoursAgo =
    now -
    6 * 60 * 60 * 1000;


  items =
    items.filter(item => {

      const time =
        parseDate(
          item.published
        );

      /*
       * If date cannot be parsed,
       * retain the item rather than
       * accidentally losing news.
       */

      if (
        !Number.isFinite(time)
      ) {
        return true;
      }

      return time >= sixHoursAgo;
    });


  items.sort((a, b) => {

    const da =
      parseDate(
        a.published
      );

    const db =
      parseDate(
        b.published
      );

    if (
      Number.isFinite(da) &&
      Number.isFinite(db)
    ) {
      return db - da;
    }

    return 0;
  });


  /*
   * Hard safety limit.
   *
   * Frontend will never receive
   * hundreds/thousands of records.
   */

  const MAX_RESULTS = 100;

  const finalItems =
    items.slice(
      0,
      MAX_RESULTS
    );


  const attempts = [

    ...rssResults.map(
      result => ({

        provider:
          result.provider,

        ok:
          result.ok,

        status:
          result.status,

        count:
          result.items.length,

        detail:
          result.detail

      })
    ),

    {

      provider:
        bseResult.provider,

      ok:
        bseResult.ok,

      status:
        bseResult.status,

      count:
        bseResult.items.length,

      detail:
        bseResult.detail
    }

  ];


  return {

    ok:
      finalItems.length > 0,

    source:
      "Google News RSS + GDELT + Bing News RSS + BSE",

    keyword,

    timeWindow:
      "last 6 hours",

    count:
      finalItems.length,

    items:
      finalItems,

    attempts

  };
}


/* =========================================================
   REQUEST HANDLER
   ========================================================= */

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


  /* =======================================================
     HEALTH
     ======================================================= */

  if (
    path === "/" ||
    path === ""
  ) {

    return json({

      ok: true,

      service:
        "MarketFeed RSS Proxy",

      version:
        "12-base-pre-bse-isolation",

      endpoints: [
        "/rss?url=RSS_URL",
        "/news?q=KEYWORD"
      ],

      keywordProviders: [
        "Google News RSS",
        "GDELT News RSS",
        "Bing News RSS",
        "BSE Corporate Announcements"
      ],

      newsWindow:
        "last 6 hours",

      maxResults:
        100

    });
  }


  /* =======================================================
     NEWS
     ======================================================= */

  if (
    path === "/news"
  ) {

    const keyword =
      (
        url.searchParams.get(
          "q"
        ) || ""
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
      await getNews(
        keyword
      )
    );
  }


  /* =======================================================
     GENERIC RSS
     ======================================================= */

  if (
    path === "/rss"
  ) {

    const target =
      (
        url.searchParams.get(
          "url"
        ) || ""
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


      if (
        !response.ok
      ) {

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
          100
        );


      if (
        !items.length
      ) {

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


    } catch (error) {

      return json(
        {
          ok: false,

          error:
            "RSS fetch failed",

          detail:
            String(
              error?.message ||
              error
            ),

          url:
            targetURL.toString()
        },
        502
      );
    }
  }


  /* =======================================================
     NOT FOUND
     ======================================================= */

  return json(
    {
      ok: false,
      error:
        "Not found"
    },
    404
  );
}


/* =========================================================
   CLOUDFLARE WORKER
   ========================================================= */

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