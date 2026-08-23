/*
 * MarketFeed RSS Worker - V10 MULTI-SOURCE + BSE
 *
 * Endpoints:
 *   /                  health/status
 *   /news?q=TCS        Google + GDELT + Bing + BSE
 *   /rss?url=...       existing RSS/Atom proxy
 *
 * NEWS SOURCES:
 *   1. Google News RSS
 *   2. GDELT News RSS
 *   3. Bing News RSS
 *   4. BSE Corporate Announcements
 *
 * BSE:
 *   BSE Corporate Announcements are fetched from
 *   BSE's JSON data endpoint and converted to the
 *   same news-item format used by the other sources.
 *
 * NO:
 *   NewsData.io
 *   GNews API
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store"
};


/* =========================================================
   BASIC RESPONSE
   ========================================================= */

function json(data, status = 200, extra = {}) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...CORS,
        ...extra,
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}


/* =========================================================
   TEXT HELPERS
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


function decodeEntities(s) {

  return String(s || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(
      /&#(\d+);/g,
      (_, n) =>
        String.fromCharCode(Number(n))
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) =>
        String.fromCharCode(
          parseInt(n, 16)
        )
    );
}


function tagValue(block, tag) {

  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const m =
    block.match(re);

  return m
    ? decodeEntities(
        cleanText(m[1])
      )
    : "";
}


function attrValue(block, tag, attr) {

  const re = new RegExp(
    `<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*\\/?>`,
    "i"
  );

  const m =
    block.match(re);

  return m
    ? decodeEntities(m[1])
    : "";
}


/* =========================================================
   RSS PARSER
   ========================================================= */

function parseRSS(
  text,
  limit = 50
) {

  const items = [];

  const rssBlocks =
    text.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

  const atomBlocks =
    text.match(
      /<entry\b[\s\S]*?<\/entry>/gi
    ) || [];

  const blocks =
    rssBlocks.length
      ? rssBlocks
      : atomBlocks;

  for (
    const block
    of blocks.slice(0, limit)
  ) {

    const title =
      tagValue(
        block,
        "title"
      );

    let link =
      tagValue(
        block,
        "link"
      );

    if (!link) {

      link =
        attrValue(
          block,
          "link",
          "href"
        );
    }

    const description =
      tagValue(
        block,
        "description"
      ) ||
      tagValue(
        block,
        "summary"
      ) ||
      tagValue(
        block,
        "content"
      );

    const published =
      tagValue(
        block,
        "pubDate"
      ) ||
      tagValue(
        block,
        "published"
      ) ||
      tagValue(
        block,
        "updated"
      ) ||
      tagValue(
        block,
        "dc:date"
      );

    const guid =
      tagValue(
        block,
        "guid"
      ) ||
      tagValue(
        block,
        "id"
      );

    if (
      title ||
      link
    ) {

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


/* =========================================================
   RSS FETCH
   ========================================================= */

async function fetchRSS(url) {

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "User-Agent":
            "MarketFeed/10.0 (+RSS reader)",

          "Accept":
            "application/rss+xml, " +
            "application/atom+xml, " +
            "application/xml, " +
            "text/xml, */*"
        },

        redirect: "follow"
      }
    );

  return {
    response,
    text:
      await response.text()
  };
}


/* =========================================================
   SOURCE URLS
   ========================================================= */

function gdeltUrl(
  keyword
) {

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


function bingUrl(
  keyword
) {

  return (
    "https://www.bing.com/news/search?q=" +
    encodeURIComponent(keyword) +
    "&format=rss"
  );
}


function googleUrl(
  keyword
) {

  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(keyword) +
    "&hl=en-IN" +
    "&gl=IN" +
    "&ceid=IN:en"
  );
}


/* =========================================================
   BSE DATE
   ========================================================= */

function indiaDateString(
  daysBack = 0
) {

  const now =
    new Date(
      Date.now() -
      daysBack * 86400000
    );

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(now);

  const map = {};

  for (
    const p of parts
  ) {
    map[p.type] =
      p.value;
  }

  return (
    map.year +
    map.month +
    map.day
  );
}


/* =========================================================
   BSE API URL
   ========================================================= */

function bseUrl(
  date,
  page
) {

  return (
    "https://api.bseindia.com/" +
    "BseIndiaAPI/api/AnnGetData/w?" +

    "pageno=" +
    page +

    "&strCat=-1" +

    "&strPrevDate=" +
    date +

    "&strScrip=" +

    "&strSearch=P" +

    "&strToDate=" +
    date +

    "&strType=C"
  );
}


/* =========================================================
   BSE FETCH
   ========================================================= */

async function fetchBSEPage(
  date,
  page
) {

  const url =
    bseUrl(
      date,
      page
    );

  try {

    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {

            "User-Agent":
              "Mozilla/5.0 " +
              "(Windows NT 10.0; Win64; x64) " +
              "AppleWebKit/537.36 " +
              "(KHTML, like Gecko) " +
              "Chrome/134.0 Safari/537.36",

            "Accept":
              "application/json, text/plain, */*",

            "Accept-Language":
              "en-IN,en;q=0.9",

            "Referer":
              "https://www.bseindia.com/corporates/ann.html",

            "Origin":
              "https://www.bseindia.com"
          },

          redirect:
            "follow"
        }
      );

    const text =
      await response.text();

    if (!response.ok) {

      return {
        ok: false,
        status:
          response.status,
        items: [],
        totalPages: 0,
        detail:
          "HTTP " +
          response.status
      };
    }

    let data;

    try {

      data =
        JSON.parse(text);

    } catch (_) {

      return {
        ok: false,
        status:
          response.status,
        items: [],
        totalPages: 0,
        detail:
          "BSE returned non-JSON"
      };
    }

    const rows =
      Array.isArray(
        data?.Table
      )
        ? data.Table
        : [];

    let totalPages =
      0;

    if (
      rows.length
    ) {

      totalPages =
        Number(
          rows[0]
            ?.TotalPageCnt
        ) || 0;
    }

    return {
      ok: true,
      status:
        response.status,
      items:
        rows,
      totalPages,
      detail:
        "BSE page " +
        page +
        ": " +
        rows.length +
        " items"
    };

  } catch (err) {

    return {
      ok: false,
      status: 0,
      items: [],
      totalPages: 0,
      detail:
        String(
          err?.message ||
          err
        )
    };
  }
}


/* =========================================================
   BSE NORMALIZATION
   ========================================================= */

function normalizeBSEItem(
  row
) {

  const title =
    cleanText(
      row?.NEWSSUB ||
      row?.HEADLINE ||
      ""
    );

  const description =
    cleanText(
      row?.MORE ||
      row?.HEADLINE ||
      ""
    );

  const published =
    row?.DissemDT ||
    row?.News_submission_dt ||
    row?.DT_TM ||
    row?.NEWS_DT ||
    "";

  const scrip =
    String(
      row?.SCRIP_CD ||
      ""
    );

  const company =
    cleanText(
      row?.SLONGNAME ||
      ""
    );

  const category =
    cleanText(
      row?.CATEGORYNAME ||
      ""
    );

  const newsId =
    String(
      row?.NEWSID ||
      ""
    );

  let link =
    "";

  /*
   * Prefer the actual BSE filing document.
   */

  if (
    row?.ATTACHMENTNAME
  ) {

    link =
      "https://www.bseindia.com/" +
      "xml-data/corpfiling/" +
      "AttachLive/" +
      row.ATTACHMENTNAME;

  } else if (
    row?.NSURL
  ) {

    link =
      row.NSURL;

  } else if (
    newsId
  ) {

    /*
     * Older BSE announcement detail
     * URL. Kept as fallback.
     */

    link =
      "https://www.bseindia.com/" +
      "stockinfo/anndet.aspx?newsid=" +
      encodeURIComponent(
        newsId
      );
  }


  return {

    title,

    link,

    description,

    published,

    guid:
      newsId ||
      link,

    source:
      "BSE Corporate Announcements",

    company,

    scrip,

    category,

    sourceUrl:
      row?.NSURL ||
      "",

    bseNewsId:
      newsId
  };
}


/* =========================================================
   BSE KEYWORD MATCH
   ========================================================= */

function bseMatchesKeyword(
  item,
  keyword
) {

  const q =
    String(
      keyword || ""
    )
      .toLowerCase()
      .trim();

  if (!q) {
    return true;
  }

  const haystack =
    [
      item.title,
      item.description,
      item.company,
      item.category,
      item.scrip
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  /*
   * Exact keyword/phrase matching.
   */

  if (
    haystack.includes(q)
  ) {
    return true;
  }

  /*
   * Also match individual words.
   * This helps searches such as:
   * "Tata Consultancy Services"
   */

  const words =
    q
      .split(/\s+/)
      .filter(
        x => x.length >= 2
      );

  if (!words.length) {
    return false;
  }

  return words.every(
    word =>
      haystack.includes(word)
  );
}


/* =========================================================
   BSE NEWS SEARCH
   ========================================================= */

async function fetchBSENews(
  keyword
) {

  /*
   * First search today's BSE announcements.
   *
   * We fetch a few pages in parallel instead
   * of downloading thousands of announcements.
   */

  const today =
    indiaDateString(0);

  const pages =
    [1, 2, 3, 4, 5];

  let results =
    await Promise.all(
      pages.map(
        page =>
          fetchBSEPage(
            today,
            page
          )
      )
    );

  let rows =
    results.flatMap(
      x => x.items
    );

  let attempts =
    results.map(
      x => ({
        date: today,
        ok: x.ok,
        status: x.status,
        detail: x.detail
      })
    );


  /*
   * If today's first five pages did not
   * contain the requested company/keyword,
   * try the previous calendar day.
   *
   * This is useful on weekends/holidays.
   */

  let normalized =
    rows
      .map(
        normalizeBSEItem
      )
      .filter(
        item =>
          item.title ||
          item.link
      )
      .filter(
        item =>
          bseMatchesKeyword(
            item,
            keyword
          )
      );


  if (
    !normalized.length
  ) {

    const previous =
      indiaDateString(1);

    const previousResults =
      await Promise.all(
        pages.map(
          page =>
            fetchBSEPage(
              previous,
              page
            )
        )
      );

    rows =
      previousResults.flatMap(
        x => x.items
      );

    attempts.push(
      ...previousResults.map(
        x => ({
          date: previous,
          ok: x.ok,
          status: x.status,
          detail: x.detail
        })
      )
    );

    normalized =
      rows
        .map(
          normalizeBSEItem
        )
        .filter(
          item =>
            item.title ||
            item.link
        )
        .filter(
          item =>
            bseMatchesKeyword(
              item,
              keyword
            )
        );
  }


  return {

    ok:
      normalized.length > 0,

    provider:
      "BSE Corporate Announcements",

    keyword,

    count:
      normalized.length,

    items:
      normalized,

    attempts
  };
}


/* =========================================================
   GENERIC PROVIDER FETCH
   ========================================================= */

async function fetchProvider(
  provider,
  url
) {

  try {

    const {
      response,
      text
    } =
      await fetchRSS(
        url
      );

    if (
      !response.ok
    ) {

      return {
        provider,
        ok: false,
        status:
          response.status,
        items: [],
        detail:
          "HTTP " +
          response.status
      };
    }


    const items =
      parseRSS(
        text,
        50
      )
        .map(
          item => ({
            title:
              item.title ||
              "",

            link:
              item.link ||
              "",

            description:
              item.description ||
              "",

            published:
              item.published ||
              "",

            guid:
              item.guid ||
              item.link ||
              "",

            source:
              provider
          })
        )
        .filter(
          item =>
            item.title ||
            item.link
        );


    return {

      provider,

      ok: true,

      status:
        response.status,

      items,

      detail:
        "RSS parsed: " +
        items.length +
        " items"
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


/* =========================================================
   NORMALIZE FOR DEDUPLICATION
   ========================================================= */

function normalizeForCompare(
  value
) {

  return String(
    value || ""
  )
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


/* =========================================================
   DEDUPLICATE
   ========================================================= */

function dedupeNews(
  items
) {

  const seenLinks =
    new Set();

  const seenTitles =
    new Set();

  const result =
    [];

  for (
    const item
    of items
  ) {

    const link =
      normalizeForCompare(
        item.link
      );

    const title =
      normalizeForCompare(
        item.title
      );


    if (
      link &&
      seenLinks.has(link)
    ) {
      continue;
    }


    if (
      title &&
      seenTitles.has(title)
    ) {
      continue;
    }


    if (link) {
      seenLinks.add(
        link
      );
    }


    if (title) {
      seenTitles.add(
        title
      );
    }


    result.push(
      item
    );
  }


  return result;
}


/* =========================================================
   MAIN KEYWORD NEWS
   ========================================================= */

async function keywordNews(
  keyword
) {

  /*
   * ALL FOUR SOURCES ARE REQUESTED.
   */

  const providers = [

    {
      provider:
        "GDELT News RSS",

      url:
        gdeltUrl(
          keyword
        )
    },

    {
      provider:
        "Bing News RSS",

      url:
        bingUrl(
          keyword
        )
    },

    {
      provider:
        "Google News RSS",

      url:
        googleUrl(
          keyword
        )
    }

  ];


  /*
   * Fetch RSS sources and BSE
   * at the same time.
   */

  const [
    rssAttempts,
    bseResult
  ] =
    await Promise.all([

      Promise.all(
        providers.map(
          p =>
            fetchProvider(
              p.provider,
              p.url
            )
        )
      ),

      fetchBSENews(
        keyword
      )

    ]);


  /*
   * Merge everything.
   */

  const merged =
    [];


  for (
    const attempt
    of rssAttempts
  ) {

    if (
      attempt.ok &&
      attempt.items.length
    ) {

      merged.push(
        ...attempt.items
      );
    }
  }


  if (
    bseResult.ok &&
    bseResult.items.length
  ) {

    merged.push(
      ...bseResult.items
    );
  }


  /*
   * Remove duplicates.
   */

  const items =
    dedupeNews(
      merged
    );


  /*
   * Newest first.
   */

  items.sort(
    (a, b) => {

      const da =
        Date.parse(
          a.published ||
          ""
        );

      const db =
        Date.parse(
          b.published ||
          ""
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
    }
  );


  const attempts = [

    ...rssAttempts.map(
      x => ({
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
      })
    ),

    {
      provider:
        bseResult.provider,

      ok:
        bseResult.ok,

      status:
        bseResult.ok
          ? 200
          : 0,

      count:
        bseResult.count,

      detail:
        "BSE corporate announcements"
    }

  ];


  if (
    !items.length
  ) {

    return {

      ok: false,

      error:
        "No news found from " +
        "Google News RSS, GDELT, " +
        "Bing News RSS or BSE",

      keyword,

      count: 0,

      items: [],

      attempts
    };
  }


  return {

    ok: true,

    source:
      "Google News RSS + GDELT + Bing News RSS + BSE",

    keyword,

    count:
      items.length,

    items,

    attempts
  };
}


/* =========================================================
   REQUEST HANDLER
   ========================================================= */

async function handle(
  request
) {

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
        "10-multisource-bse",

      endpoints: [
        "/rss?url=RSS_URL",
        "/news?q=KEYWORD"
      ],

      keywordProviders: [
        "Google News RSS",
        "GDELT News RSS",
        "Bing News RSS",
        "BSE Corporate Announcements"
      ]

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
      await keywordNews(
        keyword
      )
    );
  }


  /* =======================================================
     EXISTING RSS PROXY
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
        new URL(
          target
        );


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
          50
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