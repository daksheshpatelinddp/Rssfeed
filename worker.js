/*
 * MarketFeed RSS Worker - V13 BSE DIAGNOSTIC
 *
 * BSE ONLY
 *
 * Purpose:
 *   Diagnose why TCS keyword matching returns 0.
 *
 * Logic:
 *   BSE today -> last 6 hours -> show actual BSE fields
 *
 * Google / Bing / GDELT are intentionally removed.
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
   JSON RESPONSE
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
   CLEAN TEXT
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
   FETCH BSE PAGE
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

          redirect: "follow"
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
   GET BSE DATE FIELD
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


  const text =
    String(value).trim();


  /*
   * Try JavaScript parsing.
   */

  let timestamp =
    Date.parse(text);


  if (
    Number.isFinite(timestamp)
  ) {

    return timestamp;

  }


  /*
   * DD/MM/YYYY HH:mm:ss
   */

  let match =
    text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );


  if (match) {

    return Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]) - 5,
      Number(match[5]) - 30,
      Number(match[6] || 0)
    );

  }


  /*
   * DD-MM-YYYY HH:mm:ss
   */

  match =
    text.match(
      /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );


  if (match) {

    return Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]) - 5,
      Number(match[5]) - 30,
      Number(match[6] || 0)
    );

  }


  /*
   * YYYY-MM-DD HH:mm:ss
   */

  match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );


  if (match) {

    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]) - 5,
      Number(match[5]) - 30,
      Number(match[6] || 0)
    );

  }


  return NaN;

}


/* =========================================================
   DIAGNOSTIC RECORD
   ========================================================= */

function diagnosticRow(row) {

  return {

    SCRIP_CD:
      row?.SCRIP_CD || "",

    SLONGNAME:
      cleanText(
        row?.SLONGNAME || ""
      ),

    NEWSSUB:
      cleanText(
        row?.NEWSSUB || ""
      ),

    HEADLINE:
      cleanText(
        row?.HEADLINE || ""
      ),

    CATEGORYNAME:
      cleanText(
        row?.CATEGORYNAME || ""
      ),

    NEWSID:
      row?.NEWSID || "",

    ATTACHMENTNAME:
      row?.ATTACHMENTNAME || "",

    NSURL:
      row?.NSURL || "",

    DissemDT:
      row?.DissemDT || "",

    News_submission_dt:
      row?.News_submission_dt || "",

    DT_TM:
      row?.DT_TM || "",

    NEWS_DT:
      row?.NEWS_DT || "",

    News_submission_dt_tm:
      row?.News_submission_dt_tm || "",

    MORE:
      cleanText(
        row?.MORE || ""
      )

  };

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


  const date =
    bseDate(0);


  const attempts =
    [];


  let allRows =
    [];


  /*
   * Only today's first 5 pages.
   */

  for (
    let page = 1;
    page <= 5;
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

      break;

    }


    allRows.push(
      ...result.items
    );


    if (
      !result.items.length
    ) {

      break;

    }


    if (
      result.totalPages > 0 &&
      page >= result.totalPages
    ) {

      break;

    }

  }


  /*
   * Filter records to last 6 hours.
   */

  const recentRows =
    allRows.filter(
      row => {

        const dateValue =
          getBSEDate(row);


        const timestamp =
          parseBSEDate(
            dateValue
          );


        return (
          Number.isFinite(timestamp) &&
          timestamp >= sixHoursAgo &&
          timestamp <= now
        );

      }
    );


  /*
   * VERY IMPORTANT:
   *
   * We are NOT filtering by TCS yet.
   *
   * We want to see exactly what BSE
   * returned during the last 6 hours.
   */

  const diagnostic =
    recentRows
      .slice(0, 20)
      .map(
        diagnosticRow
      );


  return {

    ok:
      true,

    source:
      "BSE Corporate Announcements",

    keyword,

    timeWindow:
      "last 6 hours",

    count:
      diagnostic.length,

    items:
      diagnostic,

    diagnosticInfo: {

      totalBSERows:
        allRows.length,

      rowsLast6Hours:
        recentRows.length,

      rowsShown:
        diagnostic.length,

      now:
        new Date(
          now
        ).toISOString(),

      sixHoursAgo:
        new Date(
          sixHoursAgo
        ).toISOString(),

      bseDate:
        date,

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
        "13-bse-diagnostic",

      provider:
        "BSE Corporate Announcements",

      endpoint:
        "/news?q=KEYWORD",

      window:
        "last 6 hours",

      keywordFiltering:
        "temporarily disabled"

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
            "BSE fetch failed",

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