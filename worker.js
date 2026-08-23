/*
 * MarketFeed RSS Worker
 * BSE ISOLATED TEST - TCS
 *
 * Only source:
 *   BSE Corporate Announcements API
 *
 * Test:
 *   /news?q=TCS
 *
 * TCS:
 *   BSE Scrip Code = 532540
 *
 * Filters:
 *   Segment       = Equity
 *   Type          = Announcement
 *   Date          = Today
 *   Time window   = Last 6 hours
 *
 * No Google / GDELT / Bing yet.
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
   BSE COMPANY MAP
   =========================================================
   For this test we use TCS directly.
   More companies can be added later.
   ========================================================= */

const COMPANIES = {

  TCS: {
    name:
      "Tata Consultancy Services Ltd",

    scripCode:
      "532540"
  }

};


/* =========================================================
   DATE
   ========================================================= */

function getIndiaDate() {

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Asia/Kolkata",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    ).formatToParts(
      new Date()
    );


  const obj = {};

  for (
    const p of parts
  ) {

    obj[p.type] =
      p.value;

  }


  return (
    obj.year +
    obj.month +
    obj.day
  );

}


/* =========================================================
   BSE DATE FOR DISPLAY
   ========================================================= */

function isoDateFromBSE(
  bseDate
) {

  if (
    !bseDate ||
    bseDate.length !== 8
  ) {

    return "";

  }


  return (
    bseDate.slice(0, 4) +
    "-" +
    bseDate.slice(4, 6) +
    "-" +
    bseDate.slice(6, 8)
  );

}


/* =========================================================
   BSE API URL
   ========================================================= */

function bseAnnouncementURL(
  date,
  scripCode,
  page = 1
) {

  const params =
    new URLSearchParams();


  /*
   * Page number
   */

  params.set(
    "pageno",
    String(page)
  );


  /*
   * Category
   *
   * -1 = all categories
   */

  params.set(
    "strCat",
    "-1"
  );


  /*
   * Sub-category
   *
   * -1 = all sub-categories
   */

  params.set(
    "subcategory",
    "-1"
  );


  /*
   * From date
   */

  params.set(
    "strPrevDate",
    date
  );


  /*
   * To date
   */

  params.set(
    "strToDate",
    date
  );


  /*
   * Announcement
   *
   * P = Announcement
   */

  params.set(
    "strSearch",
    "P"
  );


  /*
   * IMPORTANT:
   * BSE company/scrip filter
   */

  params.set(
    "strScrip",
    scripCode
  );


  /*
   * Equity
   *
   * C = Equity
   */

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
  scripCode,
  page
) {

  const url =
    bseAnnouncementURL(
      date,
      scripCode,
      page
    );


  try {

    const response =
      await fetch(
        url,
        {
          method:
            "GET",

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

            /*
             * IMPORTANT FOR BSE
             */

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

        ok:
          false,

        status:
          response.status,

        items: [],

        totalPages:
          null,

        raw:
          text.slice(
            0,
            500
          ),

        url

      };

    }


    let data;


    try {

      data =
        JSON.parse(
          text
        );

    } catch (error) {

      return {

        ok:
          false,

        status:
          response.status,

        items: [],

        totalPages:
          null,

        raw:
          text.slice(
            0,
            500
          ),

        error:
          "BSE response was not JSON",

        url

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
            rows[0]?.TotalPageCnt
          ) || 0
        : 0;


    return {

      ok:
        true,

      status:
        response.status,

      items:
        rows,

      totalPages,

      url

    };


  } catch (error) {

    return {

      ok:
        false,

      status:
        0,

      items: [],

      totalPages:
        null,

      error:
        String(
          error?.message ||
          error
        ),

      url

    };

  }

}


/* =========================================================
   PARSE BSE DATE
   ========================================================= */

function parseBSEDate(
  value
) {

  if (!value) {

    return NaN;

  }


  const text =
    String(
      value
    ).trim();


  /*
   * Normal ISO format:
   * 2026-08-23T13:51:31.72
   */

  let date =
    Date.parse(
      text
    );


  if (
    Number.isFinite(date)
  ) {

    return date;

  }


  /*
   * Try DD/MM/YYYY HH:mm:ss
   */

  const match =
    text.match(
      /^(\d{2})[\/-](\d{2})[\/-](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/
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
      Number(
        match[6] || 0
      );


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


  return NaN;

}


/* =========================================================
   NORMALIZE BSE ITEM
   ========================================================= */

function normalizeBSE(
  row
) {

  const scrip =
    String(
      row?.SCRIP_CD ||
      row?.SCRIPCODE ||
      row?.ScripCode ||
      ""
    ).trim();


  const company =
    String(
      row?.SLONGNAME ||
      row?.SCRIP_NAME ||
      row?.CompanyName ||
      ""
    ).trim();


  const title =
    String(
      row?.NEWSSUB ||
      row?.HEADLINE ||
      row?.News_Sub ||
      ""
    ).trim();


  const description =
    String(
      row?.MORE ||
      row?.HEADLINE ||
      row?.News ||
      ""
    ).trim();


  const published =
    String(
      row?.DissemDT ||
      row?.News_submission_dt ||
      row?.DT_TM ||
      row?.NEWS_DT ||
      ""
    ).trim();


  const newsId =
    String(
      row?.NEWSID ||
      row?.NewsId ||
      ""
    ).trim();


  const attachment =
    String(
      row?.ATTACHMENTNAME ||
      row?.AttachmentName ||
      ""
    ).trim();


  let link = "";


  if (
    attachment
  ) {

    link =
      "https://www.bseindia.com/" +
      "xml-data/corpfiling/" +
      "AttachLive/" +
      attachment;

  } else if (
    row?.NSURL
  ) {

    link =
      String(
        row.NSURL
      );

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

    company,

    scripCode:
      scrip,

    description,

    published,

    link,

    guid:
      newsId ||
      link,

    category:
      String(
        row?.CATEGORYNAME ||
        ""
      ).trim(),

    newsId

  };

}


/* =========================================================
   KEYWORD / COMPANY CHECK
   ========================================================= */

function companyMatches(
  item,
  company,
  scripCode,
  keyword
) {

  /*
   * FIRST:
   * Exact BSE scrip-code match.
   */

  if (
    String(
      item.scripCode
    ) ===
    String(
      scripCode
    )
  ) {

    return true;

  }


  /*
   * SECOND:
   * Company name match.
   */

  const companyText =
    String(
      item.company ||
      ""
    ).toLowerCase();


  const wantedCompany =
    String(
      company ||
      ""
    ).toLowerCase();


  if (
    companyText &&
    wantedCompany &&
    companyText.includes(
      wantedCompany
    )
  ) {

    return true;

  }


  /*
   * THIRD:
   * Keyword match.
   */

  const keywordText =
    String(
      keyword ||
      ""
    ).toLowerCase()
    .trim();


  if (
    keywordText &&
    (
      companyText.includes(
        keywordText
      ) ||
      String(
        item.title ||
        ""
      ).toLowerCase().includes(
        keywordText
      )
    )
  ) {

    return true;

  }


  return false;

}


/* =========================================================
   LAST 6 HOURS
   ========================================================= */

function withinLast6Hours(
  item,
  now
) {

  const timestamp =
    parseBSEDate(
      item.published
    );


  if (
    !Number.isFinite(
      timestamp
    )
  ) {

    return false;

  }


  const sixHoursAgo =
    now -
    6 * 60 * 60 * 1000;


  return (
    timestamp >=
      sixHoursAgo &&
    timestamp <=
      now
  );

}


/* =========================================================
   DEDUPLICATE
   ========================================================= */

function dedupe(
  items
) {

  const seen =
    new Set();

  const result =
    [];


  for (
    const item
    of items
  ) {

    const key =
      item.newsId ||
      (
        String(
          item.scripCode
        ) +
        "|" +
        String(
          item.published
        ) +
        "|" +
        String(
          item.title
        )
      );


    if (
      seen.has(key)
    ) {

      continue;

    }


    seen.add(
      key
    );

    result.push(
      item
    );

  }


  return result;

}


/* =========================================================
   FETCH TCS BSE NEWS
   ========================================================= */

async function fetchBSENews(
  keyword
) {

  const normalized =
    String(
      keyword ||
      ""
    )
      .trim()
      .toUpperCase();


  /*
   * For this first test:
   *
   * TCS = 532540
   */

  const company =
    COMPANIES[
      normalized
    ];


  if (
    !company
  ) {

    return {

      ok:
        false,

      source:
        "BSE Corporate Announcements",

      keyword,

      error:
        "Only TCS is enabled for this test.",

      availableCompanies:
        ["TCS"]

    };

  }


  const bseDate =
    getIndiaDate();


  const now =
    Date.now();


  const sixHoursAgo =
    now -
    6 * 60 * 60 * 1000;


  /*
   * Fetch page 1.
   *
   * The BSE page normally contains
   * today's matching records.
   */

  const first =
    await fetchBSEPage(
      bseDate,
      company.scripCode,
      1
    );


  if (
    !first.ok
  ) {

    return {

      ok:
        false,

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
        0,

      items: [],

      diagnostic: {

        endpoint:
          "AnnSubCategoryGetData/w",

        httpStatus:
          first.status,

        totalRowsReturnedByBSE:
          0,

        totalPages:
          first.totalPages,

        error:
          first.error ||
          "BSE request failed",

        raw:
          first.raw ||
          null,

        url:
          first.url

      }

    };

  }


  let rows =
    [
      ...first.items
    ];


  /*
   * If BSE reports more pages,
   * fetch remaining pages.
   *
   * Safety limit prevents a huge request.
   */

  const totalPages =
    Math.min(
      first.totalPages || 1,
      10
    );


  if (
    totalPages > 1
  ) {

    const pageNumbers =
      [];


    for (
      let page = 2;
      page <= totalPages;
      page++
    ) {

      pageNumbers.push(
        page
      );

    }


    const pageResults =
      await Promise.all(
        pageNumbers.map(
          page =>
            fetchBSEPage(
              bseDate,
              company.scripCode,
              page
            )
        )
      );


    for (
      const result
      of pageResults
    ) {

      if (
        result.ok
      ) {

        rows.push(
          ...result.items
        );

      }

    }

  }


  /*
   * Normalize.
   */

  const normalizedRows =
    rows.map(
      normalizeBSE
    );


  /*
   * Time filter first.
   */

  const recentRows =
    normalizedRows.filter(
      item =>
        withinLast6Hours(
          item,
          now
        )
    );


  /*
   * Company/scrip filter.
   */

  const matchingRows =
    recentRows.filter(
      item =>
        companyMatches(
          item,
          company.name,
          company.scripCode,
          keyword
        )
    );


  const finalItems =
    dedupe(
      matchingRows
    );


  /*
   * Newest first.
   */

  finalItems.sort(
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


  return {

    ok:
      finalItems.length > 0,

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
      finalItems.length,

    items:
      finalItems,

    diagnostic: {

      endpoint:
        "AnnSubCategoryGetData/w",

      bseDate,

      totalRowsReturnedByBSE:
        rows.length,

      rowsLast6Hours:
        recentRows.length,

      matchingCompanyRows:
        matchingRows.length,

      finalCount:
        finalItems.length,

      totalPages:
        first.totalPages,

      windowStart:
        new Date(
          sixHoursAgo
        ).toISOString(),

      windowEnd:
        new Date(
          now
        ).toISOString(),

      /*
       * This helps us diagnose the next
       * problem without returning all
       * BSE records.
       */

      firstBSERecord:
        rows.length
          ? rows[0]
          : null,

      firstRecentRecord:
        recentRows.length
          ? recentRows[0]
          : null,

      firstMatchingRecord:
        matchingRows.length
          ? matchingRows[0]
          : null

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
        status:
          204,

        headers:
          CORS
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

      ok:
        true,

      service:
        "MarketFeed BSE Test Worker",

      version:
        "BSE-TCS-6H",

      endpoint:
        "/news?q=TCS",

      company:
        "Tata Consultancy Services Ltd",

      bseScripCode:
        "532540",

      filters: {

        segment:
          "Equity",

        submissionType:
          "Announcement",

        category:
          "All",

        subcategory:
          "All",

        timeWindow:
          "Last 6 hours"

      }

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
        ) ||
        ""
      ).trim();


    if (
      !keyword
    ) {

      return json(
        {
          ok:
            false,

          error:
            "Missing q parameter",

          example:
            "/news?q=TCS"

        },
        400
      );

    }


    return json(
      await fetchBSENews(
        keyword
      )
    );

  }


  /* =======================================================
     NOT FOUND
     ======================================================= */

  return json(
    {
      ok:
        false,

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