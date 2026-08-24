/*
 * MarketFeed RSS Worker - V11 BSE DIAGNOSTIC
 *
 * Sources:
 *   Google News RSS
 *   GDELT News RSS
 *   Bing News RSS
 *   BSE Corporate Announcements
 *
 * Endpoints:
 *   /
 *   /news?q=TCS
 *   /rss?url=RSS_URL
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
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}


/* =========================================================
   TEXT
   ========================================================= */

function cleanText(value) {

  if (value == null) {
    return "";
  }

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


function tagValue(block, tag) {

  const re =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    block.match(re);

  return match
    ? decodeEntities(
        cleanText(match[1])
      )
    : "";
}


function attrValue(
  block,
  tag,
  attr
) {

  const re =
    new RegExp(
      `<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*\\/?>`,
      "i"
    );

  const match =
    block.match(re);

  return match
    ? decodeEntities(match[1])
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

  const rss =
    text.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

  const atom =
    text.match(
      /<entry\b[\s\S]*?<\/entry>/gi
    ) || [];

  const blocks =
    rss.length
      ? rss
      : atom;

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
            "MarketFeed/11.0",

          "Accept":
            "application/rss+xml, " +
            "application/atom+xml, " +
            "application/xml, " +
            "text/xml, */*"
        },

        redirect:
          "follow"
      }
    );

  return {
    response,
    text:
      await response.text()
  };
}


/* =========================================================
   NEWS SOURCE URLS
   ========================================================= */

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


function bingUrl(
  keyword
) {

  return (
    "https://www.bing.com/news/search?q=" +
    encodeURIComponent(keyword) +
    "&format=rss"
  );
}


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


/* =========================================================
   BSE DATE
   ========================================================= */

function bseDate(
  daysBack = 0
) {

  const date =
    new Date(
      Date.now() -
      daysBack *
      86400000
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
    ).formatToParts(date);

  const result = {};

  for (
    const part
    of parts
  ) {

    result[part.type] =
      part.value;
  }

  return (
    result.year +
    result.month +
    result.day
  );
}


/* =========================================================
   BSE URL
   ========================================================= */

function bseUrl(
  date,
  page
) {

  const params =
    new URLSearchParams();

  params.set(
    "pageno",
    String(page)
  );

  params.set(
    "strCat",
    "-1"
  );

  params.set(
    "subcategory",
    "-1"
  );

  params.set(
    "strPrevDate",
    date
  );

  params.set(
    "strToDate",
    date
  );

  params.set(
    "strSearch",
    "P"
  );

  params.set(
    "strscrip",
    ""
  );

  params.set(
    "strType",
    "C"
  );

  return (
    "https://api.bseindia.com/" +
    "BseIndiaAPI/api/" +
    "AnnSubCategoryGetData/w?" +
    params.toString()
  );
}


/* =========================================================
   BSE REQUEST
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
              "Chrome/134.0.0.0 " +
              "Safari/537.36",

            "Accept":
              "application/json, " +
              "text/plain, */*",

            "Accept-Language":
              "en-IN,en;q=0.9",

            "Referer":
              "https://www.bseindia.com/",

            "Origin":
              "https://www.bseindia.com"
          },

          redirect:
            "follow"
        }
      );


    const text =
      await response.text();


    if (
      !response.ok
    ) {

      return {

        ok: false,

        status:
          response.status,

        items: [],

        detail:
          "BSE HTTP " +
          response.status +
          ": " +
          text.slice(0, 300)
      };
    }


    let data;

    try {

      data =
        JSON.parse(text);

    } catch (error) {

      return {

        ok: false,

        status:
          response.status,

        items: [],

        detail:
          "BSE returned non-JSON: " +
          text.slice(0, 300)
      };
    }


    const rows =
      Array.isArray(
        data?.Table
      )
        ? data.Table
        : [];


    const totalPages =
      rows.length
        ? Number(
            rows[0]
              ?.TotalPageCnt
          ) || 0
        : 0;


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


  } catch (error) {

    return {

      ok: false,

      status: 0,

      items: [],

      detail:
        "BSE fetch exception: " +
        String(
          error?.message ||
          error
        )

    };
  }
}


/* =========================================================
   BSE ITEM NORMALIZATION
   ========================================================= */

function normalizeBSE(
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
    "";

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

  const scrip =
    String(
      row?.SCRIP_CD ||
      ""
    );

  const newsId =
    String(
      row?.NEWSID ||
      ""
    );

  let link = "";


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

    link =
      "https://www.bseindia.com/" +
      "stockinfo/anndet.aspx?" +
      "newsid=" +
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

    bseNewsId:
      newsId
  };
}


/* =========================================================
   BSE KEYWORD MATCH
   ========================================================= */

function bseMatches(
  item,
  keyword
) {

  const query =
    String(
      keyword || ""
    )
      .toLowerCase()
      .trim();

  if (!query) {
    return true;
  }


  const text =
    [
      item.title,
      item.description,
      item.company,
      item.scrip,
      item.category
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();


  if (
    text.includes(query)
  ) {

    return true;
  }


  const words =
    query
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 2
      );


  return (
    words.length > 0 &&
    words.every(
      word =>
        text.includes(word)
    )
  );
}


/* =========================================================
   BSE NEWS
   ========================================================= */

async function fetchBSENews(
  keyword
) {

  const dates = [
    bseDate(0),
    bseDate(1)
  ];


  const attempts = [];

  let allRows = [];


  /*
   * Fetch first few BSE pages.
   */

  for (
    const date
    of dates
  ) {

    const pages = [
      1,
      2,
      3,
      4,
      5
    ];


    const results =
      await Promise.all(
        pages.map(
          page =>
            fetchBSEPage(
              date,
              page
            )
        )
      );


    for (
      const result
      of results
    ) {

      attempts.push({

        date,

        ok:
          result.ok,

        status:
          result.status,

        detail:
          result.detail

      });


      if (
        result.ok &&
        result.items.length
      ) {

        allRows.push(
          ...result.items
        );

      }

    }


    const anySuccess =
      results.some(
        x => x.ok
      );


    if (
      !anySuccess
    ) {

      break;
    }

  }


  /*
   * TEMPORARY DIAGNOSTIC:
   *
   * Do NOT filter by keyword yet.
   *
   * We need to inspect the actual
   * BSE fields first.
   */

  const items =
    allRows
      .map(
        normalizeBSE
      )
      .filter(
        item =>
          item.title ||
          item.link
      );


  return {

    ok:
      items.length > 0,

    provider:
      "BSE Corporate Announcements",

    keyword,

    count:
      items.length,

    items,

    attempts,

    /*
     * Show first 3 RAW BSE records.
     * This is temporary and will be
     * removed after diagnosis.
     */

    debugRaw:
      allRows.slice(0, 3)

  };
}


/* =========================================================
   GENERIC RSS PROVIDER
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
   DEDUP
   ========================================================= */

function normalizeCompare(
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


function dedupe(
  items
) {

  const links =
    new Set();

  const titles =
    new Set();

  const result =
    [];


  for (
    const item
    of items
  ) {

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


    result.push(
      item
    );

  }


  return result;
}


/* =========================================================
   NEWS
   ========================================================= */

async function getNews(
  keyword
) {

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


  const [
    rssResults,
    bseResult
  ] =
    await Promise.all([

      Promise.all(
        providers.map(
          provider =>
            fetchProvider(
              provider.provider,
              provider.url
            )
        )
      ),

      fetchBSENews(
        keyword
      )

    ]);


  const merged =
    [];


  for (
    const result
    of rssResults
  ) {

    if (
      result.ok
    ) {

      merged.push(
        ...result.items
      );

    }

  }


  if (
    bseResult.ok
  ) {

    merged.push(
      ...bseResult.items
    );

  }


  const items =
    dedupe(
      merged
    );


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


      return 0;

    }
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
        bseResult.attempts
          ?.find(
            x => x.status
          )
          ?.status || 0,

      count:
        bseResult.count,

      detail:
        bseResult.attempts?.length
          ? bseResult.attempts
              .map(
                x =>
                  x.detail
              )
              .join(" | ")
          : "No BSE response"

    }

  ];


  return {

    ok:
      items.length > 0,

    source:
      "Google News RSS + GDELT + Bing News RSS + BSE",

    keyword,

    count:
      items.length,

    items,

    attempts,

    /*
     * TEMPORARY BSE DEBUG DATA
     */

    bseDebugRaw:
      bseResult.debugRaw || []

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
        "11-multisource-bse-diagnostic",

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
      await getNews(
        keyword
      )
    );

  }


  /* =======================================================
     EXISTING RSS
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