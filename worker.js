/*
 * MarketFeed RSS Worker - V17
 *
 * BSE CORPORATE ANNOUNCEMENT RSS TEST
 *
 * SOURCE:
 * https://beta.bseindia.com/data/xml/announcements.xml
 *
 * TEST:
 *   TCS
 *   BSE Scrip Code: 532540
 *   Last 6 hours
 *
 * NO:
 *   Google News
 *   Bing News
 *   GDELT
 *   BSE JSON API
 */


/* =========================================================
   CORS
   ========================================================= */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store"
};


/* =========================================================
   BSE RSS
   ========================================================= */

const BSE_RSS =
  "https://beta.bseindia.com/data/xml/announcements.xml";


/* =========================================================
   TEST COMPANY
   ========================================================= */

const COMPANY = {
  keyword: "TCS",
  name: "Tata Consultancy Services Ltd",
  scripCode: "532540"
};


/* =========================================================
   JSON
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
   TEXT CLEANING
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


/* =========================================================
   XML ENTITY DECODING
   ========================================================= */

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


/* =========================================================
   XML TAG VALUE
   ========================================================= */

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


/* =========================================================
   RSS ITEM PARSER
   ========================================================= */

function parseBSEFeed(xml) {

  const items = [];

  const blocks =
    xml.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];


  for (
    const block
    of blocks
  ) {

    const title =
      tagValue(
        block,
        "title"
      );

    const link =
      tagValue(
        block,
        "link"
      );

    const scripCode =
      tagValue(
        block,
        "scripcode"
      );

    const description =
      tagValue(
        block,
        "description"
      );

    const pubDate =
      tagValue(
        block,
        "pubDate"
      );


    if (
      title ||
      link ||
      scripCode
    ) {

      items.push({

        title,

        link,

        scripCode,

        description,

        pubDate

      });

    }

  }


  return items;

}


/* =========================================================
   BSE DATE PARSER
 *
 * Example:
 *
 * 23-Aug-2026 20:37:08
 *
 * BSE time is IST.
 * ========================================================= */

function parseBSEDate(value) {

  if (!value) {
    return NaN;
  }


  const text =
    String(value)
      .trim();


  const match =
    text.match(
      /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
    );


  if (!match) {

    return Date.parse(text);

  }


  const day =
    Number(match[1]);


  const monthNames = {

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
    monthNames[
      match[2]
    ];


  const year =
    Number(match[3]);


  const hour =
    Number(match[4]);


  const minute =
    Number(match[5]);


  const second =
    Number(match[6]);


  if (
    month === undefined
  ) {

    return NaN;

  }


  /*
   * Convert IST to UTC.
   */

  return Date.UTC(
    year,
    month,
    day,
    hour,
    minute,
    second
  )
  -
  (
    5 * 60 * 60 * 1000 +
    30 * 60 * 1000
  );

}


/* =========================================================
   FETCH BSE RSS
   ========================================================= */

async function fetchBSERSS() {

  try {

    const response =
      await fetch(
        BSE_RSS,
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
              "application/rss+xml, " +
              "application/xml, " +
              "text/xml, " +
              "*/*",

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


    return {

      ok:
        response.ok,

      status:
        response.status,

      text,

      contentType:
        response.headers.get(
          "content-type"
        ),

      size:
        text.length

    };


  }
  catch (error) {

    return {

      ok: false,

      status: 0,

      text: "",

      contentType: "",

      size: 0,

      error:
        String(
          error?.message ||
          error
        )

    };

  }

}


/* =========================================================
   DEDUPLICATION
   ========================================================= */

function dedupe(items) {

  const seen =
    new Set();

  const result =
    [];


  for (
    const item
    of items
  ) {

    const key =
      [
        item.scripCode,
        item.link,
        item.pubDate,
        item.title
      ].join("|");


    if (
      seen.has(key)
    ) {

      continue;

    }


    seen.add(key);

    result.push(item);

  }


  return result;

}


/* =========================================================
   GET TCS NEWS
   ========================================================= */

async function getNews() {

  const now =
    Date.now();


  const sixHoursAgo =
    now -
    (
      6 *
      60 *
      60 *
      1000
    );


  /*
   * Fetch actual BSE RSS.
   */

  const fetched =
    await fetchBSERSS();


  /*
   * BSE request failed.
   */

  if (
    !fetched.ok
  ) {

    return {

      ok: false,

      source:
        "BSE Corporate Announcements",

      keyword:
        COMPANY.keyword,

      company:
        COMPANY.name,

      bseScripCode:
        COMPANY.scripCode,

      timeWindow:
        "last 6 hours",

      count: 0,

      items: [],

      diagnostic: {

        feedURL:
          BSE_RSS,

        httpStatus:
          fetched.status,

        contentType:
          fetched.contentType,

        responseSize:
          fetched.size,

        error:
          fetched.error ||
          (
            "BSE RSS returned HTTP " +
            fetched.status
          )

      }

    };

  }


  /*
   * Parse RSS.
   */

  const allItems =
    parseBSEFeed(
      fetched.text
    );


  /*
   * Filter by exact BSE
   * scrip code.
   */

  const companyItems =
    allItems.filter(
      item =>
        String(
          item.scripCode
        ).trim() ===
        COMPANY.scripCode
    );


  /*
   * Filter last 6 hours.
   */

  const recentItems =
    companyItems.filter(
      item => {

        const timestamp =
          parseBSEDate(
            item.pubDate
          );


        return (
          Number.isFinite(
            timestamp
          ) &&
          timestamp >=
            sixHoursAgo &&
          timestamp <=
            now
        );

      }
    );


  /*
   * Remove duplicates.
   */

  const uniqueItems =
    dedupe(
      recentItems
    );


  /*
   * Newest first.
   */

  uniqueItems.sort(
    (a, b) => {

      return (
        parseBSEDate(
          b.pubDate
        ) -
        parseBSEDate(
          a.pubDate
        )
      );

    }
  );


  /*
   * Maximum 20 results.
   */

  const finalItems =
    uniqueItems
      .slice(0, 20)
      .map(
        item => ({

          title:
            item.title,

          link:
            item.link,

          description:
            item.description,

          published:
            item.pubDate,

          guid:
            item.link,

          source:
            "BSE Corporate Announcements",

          company:
            COMPANY.name,

          scripCode:
            item.scripCode

        })
      );


  /*
   * Return diagnostic data.
   */

  return {

    ok:
      finalItems.length > 0,

    source:
      "BSE Corporate Announcements",

    keyword:
      COMPANY.keyword,

    company:
      COMPANY.name,

    bseScripCode:
      COMPANY.scripCode,

    timeWindow:
      "last 6 hours",

    count:
      finalItems.length,

    items:
      finalItems,

    diagnostic: {

      feedURL:
        BSE_RSS,

      httpStatus:
        fetched.status,

      contentType:
        fetched.contentType,

      responseSize:
        fetched.size,

      totalRSSItems:
        allItems.length,

      matchingScripItems:
        companyItems.length,

      matchingLast6Hours:
        recentItems.length,

      finalCount:
        finalItems.length,

      now:
        new Date(
          now
        ).toISOString(),

      sixHoursAgo:
        new Date(
          sixHoursAgo
        ).toISOString(),

      firstRSSItem:
        allItems[0] || null,

      firstMatchingItem:
        companyItems[0] || null

    }

  };

}


/* =========================================================
   REQUEST HANDLER
   ========================================================= */

async function handle(
  request
) {

  /*
   * OPTIONS
   */

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
        "17-bse-rss-only",

      provider:
        "BSE Corporate Announcements",

      feed:
        BSE_RSS,

      testCompany:
        COMPANY.name,

      testScripCode:
        COMPANY.scripCode,

      timeWindow:
        "last 6 hours",

      endpoint:
        "/news?q=TCS"

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
      )
      .trim()
      .toUpperCase();


    if (
      keyword !==
      "TCS"
    ) {

      return json(
        {

          ok: false,

          error:
            "This diagnostic version only supports q=TCS",

          expected:
            "/news?q=TCS"

        },
        400
      );

    }


    try {

      return json(
        await getNews()
      );

    }
    catch (error) {

      return json(
        {

          ok: false,

          source:
            "BSE Corporate Announcements",

          keyword,

          error:
            "Unexpected worker error",

          detail:
            String(
              error?.message ||
              error
            )

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