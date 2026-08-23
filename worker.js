/*
 * MarketFeed RSS Worker - V14 BSE TCS TEST
 *
 * BSE ONLY
 *
 * TEST:
 *   /news?q=TCS
 *
 * TCS:
 *   BSE Scrip Code = 532540
 *
 * Logic:
 *   1. Get today's BSE announcements
 *   2. Keep only last 6 hours
 *   3. Match SCRIP_CD = 532540 for TCS
 *   4. Return newest first
 *   5. Maximum 20 results
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

  const response =
    await fetch(
      bseUrl(
        date,
        page
      ),
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

    throw new Error(
      "BSE HTTP " +
      response.status +
      ": " +
      text.slice(0, 300)
    );

  }


  let data;

  try {

    data =
      JSON.parse(text);

  } catch (error) {

    throw new Error(
      "BSE returned non-JSON: " +
      text.slice(0, 300)
    );

  }


  const rows =
    Array.isArray(data?.Table)
      ? data.Table
      : [];


  return {

    rows,

    totalPages:
      rows.length
        ? Number(
            rows[0]?.TotalPageCnt
          ) || 0
        : 0

  };

}


/* =========================================================
   BSE DATE PARSER
   ========================================================= */

function parseBSEDate(value) {

  if (!value) {
    return NaN;
  }


  const text =
    String(value).trim();


  /*
   * BSE current format:
   *
   * 2026-08-23T13:51:31.72
   *
   * Treat it as IST.
   */

  let match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/
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


  /*
   * Fallback to normal parsing.
   */

  const timestamp =
    Date.parse(text);


  return Number.isFinite(timestamp)
    ? timestamp
    : NaN;

}


/* =========================================================
   TCS TEST CONFIGURATION
   ========================================================= */

const COMPANY_MAP = {

  TCS: {

    scripCode:
      "532540",

    name:
      "Tata Consultancy Services Ltd"

  }

};


/* =========================================================
   COMPANY RESOLUTION
   ========================================================= */

function resolveCompany(
  keyword
) {

  const key =
    String(
      keyword || ""
    )
      .trim()
      .toUpperCase();


  return (
    COMPANY_MAP[key] ||
    null
  );

}


/* =========================================================
   NORMALIZE BSE ITEM
   ========================================================= */

function normalizeBSE(row) {

  const published =
    row?.DissemDT ||
    row?.News_submission_dt ||
    row?.DT_TM ||
    row?.NEWS_DT ||
    "";


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

    title:
      String(
        row?.NEWSSUB ||
        row?.HEADLINE ||
        ""
      ).trim(),

    link,

    description:
      String(
        row?.MORE ||
        row?.HEADLINE ||
        ""
      ).trim(),

    published,

    guid:
      newsId ||
      link,

    source:
      "BSE Corporate Announcements",

    company:
      String(
        row?.SLONGNAME ||
        ""
      ).trim(),

    scrip:
      String(
        row?.SCRIP_CD ||
        ""
      ).trim(),

    category:
      String(
        row?.CATEGORYNAME ||
        ""
      ).trim(),

    bseNewsId:
      newsId,

    timestamp:
      parseBSEDate(
        published
      )

  };

}


/* =========================================================
   DEDUPLICATE
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
      item.bseNewsId ||
      item.link ||
      (
        item.title +
        "|" +
        item.published
      );


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
   FETCH TCS NEWS
   ========================================================= */

async function fetchCompanyNews(
  keyword
) {

  const company =
    resolveCompany(
      keyword
    );


  if (!company) {

    return {

      ok: false,

      source:
        "BSE Corporate Announcements",

      keyword,

      error:
        "Company is not configured yet",

      configuredCompanies:
        Object.keys(
          COMPANY_MAP
        )

    };

  }


  const now =
    Date.now();


  const sixHoursAgo =
    now -
    6 * 60 * 60 * 1000;


  const today =
    bseDate(0);


  const result =
    await fetchBSEPage(
      today,
      1
    );


  const allRows =
    result.rows;


  /*
   * First filter by time.
   */

  const recentRows =
    allRows.filter(
      row => {

        const timestamp =
          parseBSEDate(
            row?.DissemDT ||
            row?.News_submission_dt ||
            row?.DT_TM ||
            row?.NEWS_DT ||
            ""
          );


        return (
          Number.isFinite(timestamp) &&
          timestamp >= sixHoursAgo &&
          timestamp <= now
        );

      }
    );


  /*
   * Then filter by exact BSE
   * scrip code.
   */

  const companyRows =
    recentRows.filter(
      row =>
        String(
          row?.SCRIP_CD ||
          ""
        ).trim() ===
        company.scripCode
    );


  /*
   * Normalize.
   */

  let items =
    companyRows
      .map(
        normalizeBSE
      );


  /*
   * Deduplicate.
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
      b.timestamp -
      a.timestamp
  );


  /*
   * Maximum 20.
   */

  items =
    items
      .slice(0, 20)
      .map(
        item => {

          const copy =
            { ...item };

          delete copy.timestamp;

          return copy;

        }
      );


  return {

    ok:
      items.length > 0,

    source:
      "BSE Corporate Announcements",

    keyword,

    company:
      company.name,

    bseScripCode:
      company.scripCode,

    timeWindow:
      "last 6 hours",

    count:
      items.length,

    items,

    diagnostic: {

      totalBSERows:
        allRows.length,

      rowsLast6Hours:
        recentRows.length,

      matchingCompanyRows:
        companyRows.length,

      finalCount:
        items.length,

      bseDate:
        today,

      windowStart:
        new Date(
          sixHoursAgo
        ).toISOString(),

      windowEnd:
        new Date(
          now
        ).toISOString(),

      totalPages:
        result.totalPages

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
        "14-bse-tcs-test",

      provider:
        "BSE Corporate Announcements",

      testCompany:
        "Tata Consultancy Services Ltd",

      testScrip:
        "532540",

      window:
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
        await fetchCompanyNews(
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