 /*
  * MarketFeed RSS Worker - Multi Source
  *
  * /                  health/status
  * /news?q=TCS        merged keyword news
  * /rss?url=...       existing RSS/Atom proxy
  *
  * Keyword sources:
  *   1. Google News RSS
  *   2. GDELT News RSS
  *   3. Bing News RSS
  *
  * NewsData.io and GNews API are NOT used.
  */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store"
};

function json(data,status=200,extra={}) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      ...CORS,
      ...extra,
      "Content-Type":"application/json; charset=utf-8"
    }
  });
}

function xml(data,status=200) {
  return new Response(data,{
    status,
    headers:{
      ...CORS,
      "Content-Type":"application/rss+xml; charset=utf-8"
    }
  });
}

function cleanText(value) {
  if(value==null)return "";

  return String(value)
    .replace(/<!\[CDATA\[/g,"")
    .replace(/\]\]>/g,"")
    .replace(/<[^>]*>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function decodeEntities(s) {
  return String(s||"")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&#x27;/gi,"'")
    .replace(
      /&#(\d+);/g,
      (_,n)=>String.fromCharCode(Number(n))
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_,n)=>String.fromCharCode(
        parseInt(n,16)
      )
    );
}

function tagValue(block,tag) {
  const re=new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const m=block.match(re);

  return m
    ?decodeEntities(cleanText(m[1]))
    :"";
}

function attrValue(block,tag,attr) {
  const re=new RegExp(
    `<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*\\/?>`,
    "i"
  );

  const m=block.match(re);

  return m
    ?decodeEntities(m[1])
    :"";
}

function parseRSS(text,limit=50) {

  const rssBlocks=
    text.match(
      /<item\b[\s\S]*?<\/item>/gi
    )||[];

  const atomBlocks=
    text.match(
      /<entry\b[\s\S]*?<\/entry>/gi
    )||[];

  const blocks=
    rssBlocks.length
      ?rssBlocks
      :atomBlocks;

  const items=[];

  for(const block of blocks.slice(0,limit)) {

    const title=
      tagValue(block,"title");

    let link=
      tagValue(block,"link");

    if(!link)
      link=
        attrValue(block,"link","href");

    const description=
      tagValue(block,"description")||
      tagValue(block,"summary")||
      tagValue(block,"content");

    const published=
      tagValue(block,"pubDate")||
      tagValue(block,"published")||
      tagValue(block,"updated")||
      tagValue(block,"dc:date");

    const image=
      attrValue(
        block,
        "media:content",
        "url"
      )||
      attrValue(
        block,
        "media:thumbnail",
        "url"
      );

    if(title||link) {

      items.push({
        title,
        link,
        description,
        published,
        image
      });

    }
  }

  return items;
}

async function fetchRSS(url) {

  const response=await fetch(url,{
    method:"GET",

    headers:{
      "User-Agent":
        "MarketFeed/8.0 (+RSS reader)",

      "Accept":
        "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
    },

    redirect:"follow"
  });

  const text=await response.text();

  return {
    response,
    text
  };
}


/* ================= SOURCE URLS ================= */

function googleUrl(keyword) {

  return (
    "https://news.google.com/rss/search?q="+
    encodeURIComponent(keyword)+
    "&hl=en-IN"+
    "&gl=IN"+
    "&ceid=IN:en"
  );
}

function gdeltUrl(keyword) {

  return (
    "https://api.gdeltproject.org/api/v2/doc/doc?"+
    "query="+encodeURIComponent(keyword)+
    "&mode=artlist"+
    "&maxrecords=50"+
    "&timespan=1week"+
    "&sort=datedesc"+
    "&format=rssarchive"
  );
}

function bingUrl(keyword) {

  return (
    "https://www.bing.com/news/search?q="+
    encodeURIComponent(keyword)+
    "&format=rss"
  );
}


/* ================= NORMALIZE ================= */

function normalizeItem(item,provider) {

  return {
    title:item.title||"",
    link:item.link||"",
    description:item.description||"",
    published:item.published||"",
    image:item.image||"",
    source:provider
  };
}


/* ================= DUPLICATE KEY ================= */

function articleKey(item) {

  const url=
    String(item.link||"")
      .trim()
      .toLowerCase();

  if(url)
    return "url:"+url;

  return (
    "title:"+
    String(item.title||"")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g," ")
      .trim()
  );
}


/* ================= MERGE ================= */

function mergeNews(sourceLists,limit=100) {

  const map=new Map();

  for(const list of sourceLists) {

    for(const item of list) {

      const key=articleKey(item);

      if(!key||key==="title:")
        continue;

      if(!map.has(key)) {

        map.set(key,{
          ...item
        });

      }
      else {

        const old=map.get(key);

        if(!old.description&&item.description)
          old.description=item.description;

        if(!old.image&&item.image)
          old.image=item.image;

        if(!old.published&&item.published)
          old.published=item.published;

        if(old.source!==item.source) {

          old.source=
            old.source+
            " + "+
            item.source;

        }
      }
    }
  }

  const items=[...map.values()];

  items.sort((a,b)=>{

    const da=
      new Date(
        a.published||0
      ).getTime();

    const db=
      new Date(
        b.published||0
      ).getTime();

    return db-da;
  });

  return items.slice(0,limit);
}


/* ================= KEYWORD NEWS ================= */

async function keywordNews(keyword) {

  const providers=[
    {
      provider:"Google News RSS",
      url:googleUrl(keyword)
    },

    {
      provider:"GDELT News RSS",
      url:gdeltUrl(keyword)
    },

    {
      provider:"Bing News RSS",
      url:bingUrl(keyword)
    }
  ];

  const sourceLists=[];
  const attempts=[];

  const results=
    await Promise.allSettled(
      providers.map(async p=>{

        try {

          const {
            response,
            text
          }=await fetchRSS(p.url);

          const items=
            response.ok
              ?parseRSS(text,50)
              :[];

          attempts.push({

            provider:p.provider,

            status:response.status,

            count:items.length,

            detail:
              response.ok
              ?(
                items.length
                ?"RSS parsed"
                :"No RSS items found"
               )
              :"HTTP "+response.status
          });

          if(response.ok&&items.length) {

            return items.map(
              x=>normalizeItem(
                x,
                p.provider
              )
            );

          }

          return [];

        }
        catch(err) {

          attempts.push({

            provider:p.provider,

            status:0,

            count:0,

            detail:String(
              err?.message||err
            )
          });

          return [];
        }
      })
    );


  for(const r of results) {

    if(
      r.status==="fulfilled"&&
      Array.isArray(r.value)
    ) {
      sourceLists.push(
        r.value
      );
    }

  }


  const items=
    mergeNews(
      sourceLists,
      100
    );


  if(!items.length) {

    return {
      ok:false,

      error:
        "No news was returned by Google News, GDELT or Bing News",

      keyword,

      count:0,

      items:[],

      sources:attempts
    };
  }


  return {

    ok:true,

    source:
      "Google News + GDELT + Bing News",

    keyword,

    count:items.length,

    items,

    sources:attempts
  };
}


/* ================= REQUEST ================= */

async function handle(request) {

  if(request.method==="OPTIONS") {

    return new Response(null,{
      status:204,
      headers:CORS
    });
  }


  const url=
    new URL(request.url);

  const path=
    url.pathname;


  /* HEALTH */

  if(
    path==="/"||
    path===""
  ) {

    return json({

      ok:true,

      service:
        "MarketFeed RSS Proxy",

      version:
        "multi-source-1",

      endpoints:[
        "/rss?url=RSS_URL",
        "/news?q=KEYWORD"
      ],

      keywordProviders:[
        "Google News RSS",
        "GDELT News RSS",
        "Bing News RSS"
      ],

      apiProvidersDisabled:[
        "NewsData.io",
        "GNews API"
      ]
    });
  }


  /* KEYWORD NEWS */

  if(path==="/news") {

    const keyword=
      (
        url.searchParams.get("q")||
        ""
      ).trim();

    if(!keyword) {

      return json({
        ok:false,
        error:"Missing q parameter"
      },400);
    }

    return json(
      await keywordNews(keyword)
    );
  }


  /* EXISTING RSS */

  if(path==="/rss") {

    const target=
      (
        url.searchParams.get("url")||
        ""
      ).trim();

    if(!target) {

      return json({
        ok:false,
        error:"Missing url parameter"
      },400);
    }


    let targetURL;

    try {

      targetURL=
        new URL(target);

      if(
        !["http:","https:"]
        .includes(
          targetURL.protocol
        )
      ) {
        throw new Error(
          "Only HTTP/HTTPS URLs are allowed"
        );
      }

    }
    catch(_) {

      return json({
        ok:false,
        error:"Invalid RSS URL"
      },400);
    }


    try {

      const {
        response,
        text
      }=
        await fetchRSS(
          targetURL.toString()
        );


      if(!response.ok) {

        return json({

          ok:false,

          error:
            "RSS source returned HTTP "+
            response.status,

          status:
            response.status,

          url:
            targetURL.toString()

        },502);
      }


      return xml(
        text,
        200
      );

    }
    catch(err) {

      return json({

        ok:false,

        error:"RSS fetch failed",

        detail:String(
          err?.message||err
        ),

        url:
          targetURL.toString()

      },502);
    }
  }


  return json({
    ok:false,
    error:"Not found"
  },404);
}


/* ================= WORKER ================= */

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