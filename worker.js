 /*
  * MarketFeed RSS Worker - V15 BSE DIRECT SCRIP TEST
  *
  * BSE ONLY
  *
  * Test:
  *   /news?q=TCS
  *
  * TCS:
  *   BSE Scrip Code = 532540
  *
  * Main test:
  *   Send strscrip=532540 directly to BSE API.
  *
  * Then:
  *   - filter last 6 hours
  *   - return BSE records
  *   - maximum 20
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

 function bseUrl(
   date,
   page,
   scripCode
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

   /*
    * IMPORTANT:
    *
    * Previous version:
    *
    *   strscrip=
    *
    * New test:
    *
    *   strscrip=532540
    */

   params.set(
     "strscrip",
     String(scripCode)
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
   page,
   scripCode
 ) {

   const url =
     bseUrl(
       date,
       page,
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

     throw new Error(
       "BSE HTTP " +
       response.status +
       ": " +
       text.slice(0, 500)
     );

   }


   let data;

   try {

     data =
       JSON.parse(text);

   } catch (error) {

     throw new Error(
       "BSE returned non-JSON: " +
       text.slice(0, 500)
     );

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

     rows,

     totalPages,

     rawFirstRow:
       rows[0] || null

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
    * BSE format:
    *
    * 2026-08-23T13:51:31.72
    *
    * Treat as IST.
    */

   const match =
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


   const timestamp =
     Date.parse(text);


   return Number.isFinite(timestamp)
     ? timestamp
     : NaN;

 }


 /* =========================================================
    TCS CONFIG
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
    NORMALIZE
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
    FETCH TCS
    ========================================================= */

 async function fetchTCSNews() {

   const now =
     Date.now();


   const sixHoursAgo =
     now -
     6 * 60 * 60 * 1000;


   const today =
     bseDate(0);


   /*
    * Direct BSE scrip request.
    */

   const result =
     await fetchBSEPage(
       today,
       1,
       COMPANY.scripCode
     );


   const allRows =
     result.rows;


   /*
    * Last 6 hours.
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
    * Normalize.
    */

   let items =
     recentRows
       .map(
         normalizeBSE
       );


   /*
    * Dedupe.
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

     keyword:
       COMPANY.keyword,

     company:
       COMPANY.name,

     bseScripCode:
       COMPANY.scripCode,

     timeWindow:
       "last 6 hours",

     count:
       items.length,

     items,

     diagnostic: {

       bseDate:
         today,

       totalRowsReturnedByBSE:
         allRows.length,

       rowsLast6Hours:
         recentRows.length,

       finalCount:
         items.length,

       totalPages:
         result.totalPages,

       windowStart:
         new Date(
           sixHoursAgo
         ).toISOString(),

       windowEnd:
         new Date(
           now
         ).toISOString(),

       firstBSERecord:
         result.rawFirstRow

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
         "15-bse-direct-scrip-test",

       provider:
         "BSE Corporate Announcements",

       company:
         COMPANY.name,

       scripCode:
         COMPANY.scripCode,

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
         await fetchTCSNews()
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