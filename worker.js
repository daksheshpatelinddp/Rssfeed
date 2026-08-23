/*
 * MarketFeed RSS Worker - V16
 *
 * BSE ADVANCED SEARCH TEST
 *
 * Provider:
 *   BSE Corporate Announcements ONLY
 *
 * Test company:
 *   Tata Consultancy Services Ltd
 *   BSE Scrip Code: 532540
 *
 * Time window:
 *   Last 6 hours
 *
 * Endpoint:
 *   /news?q=TCS
 *
 * BSE API:
 *   getDataAdvance_New/w
 *
 * IMPORTANT:
 * This version does NOT use:
 *
 *   AnnSubCategoryGetData/w
 *
 * It tests the BSE Advanced Search endpoint directly.
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
   COMPANY
   ========================================================= */

const COMPANY = {

  keyword:
    "TCS",

  name:
    "Tata Consultancy Services Ltd",

  scripCode:
    "532540"

};


/* =========================================================
   IST DATE/TIME
   ========================================================= */

function istParts(date) {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
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

  return result;

}


/* =========================================================
   YYYY-MM-DD
   ========================================================= */

function istDate(date) {

  const p =
    istParts(date);

  return (
    p.year +
    "-" +
    p.month +
    "-" +
    p.day
  );

}


/* =========================================================
   BSE API DATE
   ========================================================= */

function bseDate(date) {

  const p =
    istParts(date);

  return (
    p.year +
    p.month +
    p.day
  );

}


/* =========================================================
   ADVANCED SEARCH URL
   ========================================================= */

function bseAdvancedUrl(
  fromDate,
  toDate,
  scripCode
) {

  const params =
    new URLSearchParams();


  /*
   * These parameter names are from
   * BSE's getDataAdvance_New endpoint.
   */

  params.set(
    "strTxtNoticeNo",
    ""
  );

  params.set(
    "strTxtDate",
    fromDate
  );

  params.set(
    "strTxtTodate",
    toDate
  );

  params.set(
    "strScripcode",
    String(scripCode)
  );

  params.set(
    "strDep",
    ""
  );

  params.set(
    "strSegment",
    "Equity"
  );

  params.set(
    "subject",
    ""
  );

  params.set(
    "category",
    ""
  );

  params.set(
    "containgtext",
    ""
  );


  return (
    "https://api.bseindia.com/" +
    "BseIndiaAPI/api/" +
    "getDataAdvance_New/w?" +
    params.toString()
  );

}


/* =========================================================
   FETCH BSE ADVANCED SEARCH
   ========================================================= */

async function fetchBSEAdvanced(
  fromDate,
  toDate,
  scripCode
) {

  const url =
    bseAdvancedUrl(
      fromDate,
      toDate,
      scripCode
    );


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

      url,

      detail:
        "BSE HTTP " +
        response.status +
        ": " +
        text.slice(0, 500)

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

      url,

      detail:
        "BSE returned non-JSON: " +
        text.slice(0, 500)

    };

  }


  return {

    ok: true,

    status:
      response.status,

    url,

    data

  };

}


/* =========================================================
   EXTRACT ROWS
   ========================================================= */

function extractRows(data) {

  if (
    Array.isArray(
      data?.Table
    )
  ) {

    return data.Table;

  }


  if (
    Array.isArray(
      data?.Table1
    )
  ) {

    return data.Table1;

  }


  if (
    Array.isArray(data)
  ) {

    return data;

  }


  return [];

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
   * Typical BSE value:
   *
   * 2026-08-23T13:51:31.72
   *
   * BSE timestamps are treated as IST.
   */

  const match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/
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
    ) -
    (
      5 * 60 * 60 * 1000 +
      30 * 60 * 1000
    );

  }


  const timestamp =
    Date.parse(text);


  return Number.isFinite(timestamp)
    ? timestamp
    : NaN;

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
      row?.NewsID ||
      row?.NEWS_ID ||
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

  }
  else if (
    row?.NSURL
  ) {

    link =
      row.NSURL;

  }
  else if (
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
        row?.SUBJECT ||
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
        row?.ScripName ||
        ""
      ).trim(),

    scrip:
      String(
        row?.SCRIP_CD ||
        row?.SCRIPCODE ||
        row?.ScripCode ||
        COMPANY.scripCode
      ).trim(),

    category:
      String(
        row?.CATEGORYNAME ||
        row?.CATEGORY ||
        ""
      ).trim(),

    bseNewsId:
      newsId

  };

}


/* =========================================================
   DEDUPE
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
   GET TCS NEWS
   ========================================================= */

async function getTCSNews() {

  const now =
    new Date();


  const sixHoursAgo =
    new Date(
      now.getTime() -
      6 * 60 * 60 * 1000
    );


  const fromDate =
    istDate(
      sixHoursAgo
    );


  const toDate =
    istDate(
      now
    );


  const fromBSEDate =
    bseDate(
      sixHoursAgo
    );


  const toBSEDate =
    bseDate(
      now
    );


  /*
   * BSE Advanced Search accepts
   * date-only values.
   *
   * Therefore we request today's
   * date and perform the exact
   * 6-hour time filtering ourselves.
   */

  const result =
    await fetchBSEAdvanced(
      fromDate,
      toDate,
      COMPANY.scripCode
    );


  if (
    !result.ok
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

      count:
        0,

      items: [],

      diagnostic: {

        error:
          result.detail,

        status:
          result.status,

        requestURL:
          result.url,

        fromDate,

        toDate

      }

    };

  }


  const allRows =
    extractRows(
      result.data
    );


  /*
   * Normalize first.
   */

  const normalized =
    allRows.map(
      normalizeBSE
    );


  /*
   * Exact six-hour filtering.
   */

  const recent =
    normalized.filter(
      item => {

        const time =
          parseBSEDate(
            item.published
          );


        return (
          Number.isFinite(time) &&
          time >=
            sixHoursAgo.getTime() &&
          time <=
            now.getTime()
        );

      }
    );


  /*
   * Safety check:
   *
   * The API should already be
   * filtered by scrip code.
   *
   * But we verify the returned
   * records as well.
   */

  const matchingCompany =
    recent.filter(
      item => {

        const code =
          String(
            item.scrip ||
            ""
          ).trim();


        const company =
          String(
            item.company ||
            ""
          ).toLowerCase();


        return (
          code ===
            COMPANY.scripCode ||
          company.includes(
            "tata consultancy services"
          )
        );

      }
    );


  const items =
    dedupe(
      matchingCompany
    );


  items.sort(
    (a, b) => {

      const da =
        parseBSEDate(
          a.published
        );

      const db =
        parseBSEDate(
          b.published
        );

      return db - da;

    }
  );


  const finalItems =
    items.slice(0, 20);


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

      endpoint:
        "getDataAdvance_New/w",

      fromDate,

      toDate,

      bseFromDate:
        fromBSEDate,

      bseToDate:
        toBSEDate,

      totalRowsReturnedByBSE:
        allRows.length,

      rowsLast6Hours:
        recent.length,

      matchingCompanyRows:
        matchingCompany.length,

      finalCount:
        finalItems.length,

      now:
        now.toISOString(),

      sixHoursAgo:
        sixHoursAgo.toISOString(),

      totalPages:
        result.data?.Table1?.[0]?.TotalPageCnt ||
        result.data?.Table1?.[0]?.ROWCNT ||
        null,

      responseKeys:
        Object.keys(
          result.data || {}
        ),

      firstRawRecord:
        allRows[0] || null

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
        "16-bse-advanced-search",

      provider:
        "BSE Corporate Announcements",

      company:
        COMPANY.name,

      scripCode:
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
      ).trim()
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
        await getTCSNews()
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
            "BSE request failed",

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