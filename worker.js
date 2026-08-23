/*
 * MarketFeed RSS Worker - V12 BSE ONLY
 *
 * TEMPORARY BSE-ONLY VERSION
 *
 * Sources:
 *   BSE Corporate Announcements ONLY
 *
 * Endpoint:
 *   /news?q=TCS
 *
 * Current purpose:
 *   Diagnose and fix BSE news retrieval before
 *   adding Google News, GDELT and Bing again.
 *
 * Logic:
 *   1. Request BSE announcement pages
 *   2. Read BSE records
 *   3. Filter to last 6 hours
 *   4. Match requested keyword/company/scrip
 *   5. Remove duplicates
 *   6. Sort newest first
 *   7. Return maximum 20 items
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
   TEXT HELPERS
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


function normalizeText(value) {

  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

}


/* =========================================================
   BSE DATE
   ========================================================= */

function bseDate(daysBack = 0) {

  const date =
    new Date(
      Date.now() -
      daysBack * 86400000
    );

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(date);

  const result = {};

  for (const part of parts) {

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

function bseUrl(date, page) {

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


    if (!response.ok) {

      return {

        ok: false,

        status:
          response.status,

        items: [],

        totalPages: 0,

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

        totalPages: 0,

        detail:
          "BSE returned non-JSON: " +
          text.slice(0, 300)

      };

    }


    const rows =
      Array.isArray(data?.Table)
        ? data.Table
        : [];


    const totalPages =
      rows.length
        ? Number(
            rows[0]?.TotalPageCnt
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

      totalPages: 0,

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
   BSE PUBLISHED DATE
   ========================================================= */

function getBSEDate(row) {

  return (
    row?.DissemDT ||
    row?.News_submission_dt ||
    row?.DT_TM ||
    row?.NEWS_DT ||
    row?.News_submission_dt_tm ||
    ""
  );

}


/* =========================================================
   PARSE BSE DATE
   ========================================================= */

function parseBSEDate(value) {

  if (!value) {
    return NaN;
  }


  let text =
    String(value)
      .trim();


  /*
   * Try normal JavaScript date parsing first.
   */

  let timestamp =
    Date.parse(text);


  if (
    Number.isFinite(timestamp)
  ) {

    return timestamp;

  }


  /*
   * BSE sometimes uses:
   *
   * DD/MM/YYYY HH:mm:ss
   */

  let match =
    text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );


  if (match) {

    const day =
      Number(match[1]);

    const month =
      Number(match[2]) - 1;

    const year =
      Number(match[3]);

    const hour =
      Number(match[4]);

    const minute =
      Number(match[5]);

    const second =
      Number(match[6] || 0);


    /*
     * BSE time is IST.
     * Convert IST to UTC.
     */

    return Date.UTC(
      year,
      month,
      day,
      hour - 5,
      minute - 30,
      second
    );

  }


  /*
   * Try:
   *
   * DD-MM-YYYY HH:mm:ss
   */

  match =
    text.match(
      /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );


  if (match) {

    const day =
      Number(match[1]);

    const month =
      Number(match[2]) - 1;

    const year =
      Number(match[3]);

    const hour =
      Number(match[4]);

    const minute =
      Number(match[5]);

    const second =
      Number(match[6] || 0);


    return Date.UTC(
      year,
      month,
      day,
      hour - 5,
      minute - 30,
      second
    );

  }


  /*
   * Try:
   *
   * YYYY-MM-DD HH:mm:ss
   */

  match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );


  if (match) {

    const year =
      Number(match[1]);

    const month =
      Number(match[2]) - 1;

    const day =
      Number(match[3]);

    const hour =
      Number(match[4]);

    const minute =
      Number(match[5]);

    const second =
      Number(match[6] || 0);


    return Date.UTC(
      year,
      month,
      day,
      hour - 5,
      minute - 30,
      second
    );

  }


  return NaN;

}


/* =========================================================
   BSE ITEM NORMALIZATION
   ========================================================= */

function normalizeBSE(row) {

  const title =
    cleanText(
      row?.NEWSSUB ||
      row?.HEADLINE ||
      row?.NEWS_SUBJECT ||
      ""
    );


  const description =
    cleanText(
      row?.MORE ||
      row?.HEADLINE ||
      row?.NEWS_SUBJECT ||
      ""
    );


  const published =
    getBSEDate(row);


  const company =
    cleanText(
      row?.SLONGNAME ||
      row?.LONGNAME ||
      row?.SCRIP_NAME ||
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
      row?.SCRIPCODE ||
      ""
    );


  const newsId =
    String(
      row?.NEWSID ||
      row?.NewsID ||
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
      link ||
      title,

    source:
      "BSE Corporate Announcements",

    company,

    scrip,

    category,

    bseNewsId:
      newsId,

    bseDateMs:
      parseBSEDate(
        published
      )

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
    normalizeText(
      keyword
    );


  if (!query) {

    return true;

  }


  const text =
    normalizeText(
      [
        item.title,
        item.description,
        item.company,
        item.scrip,
        item.category
      ]
        .filter(Boolean)
        .join(" ")
    );


  /*
   * Exact phrase first.
   */

  if (
    text.includes(query)
  ) {

    return true;

  }


  /*
   * Then require all words.
   */

  const words =
    query
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 2
      );


  if (!words.length) {

    return false;

  }


  return words.every(
    word =>
      text.includes(word)
  );

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
      normalizeText(
        item.bseNewsId ||
        item.link ||
        (
          item.title +
          "|" +
          item.published
        )
      );


    if (!key) {

      continue;

    }


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
   BSE NEWS
   ========================================================= */

async function fetchBSENews(
  keyword
) {

  const now =
    Date.now();


  const sixHoursAgo =
    now -
    6 * 60 * 60 * 1000;


  /*
   * We use today first.
   *
   * Yesterday is included only as a
   * safety fallback for timezone/date
   * boundary issues.
   */

  const dates = [
    bseDate(0),
    bseDate(1)
  ];


  const attempts =
    [];


  let allRows =
    [];


  /*
   * Keep the first diagnostic version
   * small.
   *
   * BSE pages are checked sequentially.
   *
   * This avoids creating 10 simultaneous
   * BSE requests like the previous version.
   */

  const maxPagesPerDate =
    5;


  for (
    const date
    of dates
  ) {

    let dateFound =
      false;


    for (
      let page = 1;
      page <= maxPagesPerDate;
      page++
    ) {

      const result =
        await fetchBSEPage(
          date,
          page
        );


      attempts.push({

        date,

        page,

        ok:
          result.ok,

        status:
          result.status,

        count:
          result.items.length,

        totalPages:
          result.totalPages,

        detail:
          result.detail

      });


      if (
        !result.ok
      ) {

        /*
         * If BSE failed for this page,
         * move to next date.
         */

        break;

      }


      if (
        result.items.length
      ) {

        dateFound = true;

        allRows.push(
          ...result.items
        );

      }


      /*
       * If this page is empty,
       * there is no reason to continue.
       */

      if (
        !result.items.length
      ) {

        break;

      }


      /*
       * Stop when BSE says there are
       * no more pages.
       */

      if (
        result.totalPages > 0 &&
        page >= result.totalPages
      ) {

        break;

      }

    }


    /*
     * We normally only need today.
     *
     * If today's pages produced records,
     * don't unnecessarily query yesterday.
     *
     * Yesterday remains available as a
     * fallback if today's request returned
     * nothing.
     */

    if (
      dateFound
    ) {

      break;

    }

  }


  /*
   * Normalize.
   */

  let items =
    allRows
      .map(
        normalizeBSE
      )
      .filter(
        item =>
          item.title ||
          item.link
      );


  /*
   * TEMPORARY DIAGNOSTIC:
   *
   * Count how many records BSE returned
   * before filtering.
   */

  const beforeTimeFilter =
    items.length;


  /*
   * Filter to last 6 hours.
   *
   * IMPORTANT:
   * If BSE date parsing fails for a record,
   * it is NOT included in the 6-hour result.
   */

  items =
    items.filter(
      item => {

        const time =
          item.bseDateMs;


        if (
          !Number.isFinite(time)
        ) {

          return false;

        }


        return (
          time >= sixHoursAgo &&
          time <= now
        );

      }
    );


  const afterTimeFilter =
    items.length;


  /*
   * Filter by requested company /
   * keyword.
   */

  items =
    items.filter(
      item =>
        bseMatches(
          item,
          keyword
        )
    );


  const afterKeywordFilter =
    items.length;


  /*
   * Remove duplicates.
   */

  items =
    dedupe(
      items
    );


  /*
   * Newest first.
   */

  items.sort(
    (a, b) =>
      (
        b.bseDateMs -
        a.bseDateMs
      )
  );


  /*
   * HARD LIMIT.
   */

  items =
    items.slice(
      0,
      20
    );


  /*
   * Remove internal timestamp before
   * sending response.
   */

  items =
    items.map(
      item => {

        const copy =
          { ...item };

        delete copy.bseDateMs;

        return copy;

      }
    );


  return {

    ok:
      items.length > 0,

    source:
      "BSE Corporate Announcements",

    keyword,

    timeWindow:
      "last 6 hours",

    count:
      items.length,

    items,

    diagnostic: {

      fetchedRows:
        allRows.length,

      beforeTimeFilter,

      afterTimeFilter,

      afterKeywordFilter,

      finalCount:
        items.length,

      windowStart:
        new Date(
          sixHoursAgo
        ).toISOString(),

      windowEnd:
        new Date(
          now
        ).toISOString(),

      attempts

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
   * OPTIONS / CORS
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
        "12-bse-only-6h",

      endpoints: [
        "/news?q=KEYWORD"
      ],

      providers: [
        "BSE Corporate Announcements"
      ],

      newsWindow:
        "6 hours",

      maxResults:
        20

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


    try {

      return json(
        await fetchBSENews(
          keyword
        )
      );

    } catch (error) {

      return json(
        {
          ok: false,

          source:
            "BSE Corporate Announcements",

          keyword,

          error:
            "BSE news fetch failed",

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