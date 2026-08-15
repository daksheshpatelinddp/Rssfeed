export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. GENERATE RSS FEED (XML) FOR ANY WEBSITE OR STOCK KEYWORD
    if (url.pathname === "/generate") {
      const target = url.searchParams.get("target");
      if (!target) return new Response("Missing target", { status: 400 });

      let articles = [];
      let feedTitle = `RSS Feed for ${target}`;

      // Google News Generator for Stock Tickers/Keywords
      const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(target)}&hl=en-IN&gl=IN&ceid=IN:en`;
      try {
        const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const text = await res.text();
        
        // Parse basic RSS items using Regex
        const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
        articles = items.map(item => {
          const title = item.match(/<title>(.*?)<\/title>/)?.[1] || "";
          const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || new Date().toUTCString();
          return { title, link, pubDate };
        });
      } catch (e) {
        articles = [];
      }

      // Build XML RSS Response
      const xmlItems = articles.map(a => `
        <item>
          <title><![CDATA[${a.title}]]></title>
          <link>${a.link}</link>
          <pubDate>${a.pubDate}</pubDate>
          <guid>${a.link}</guid>
        </item>`).join('');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${feedTitle}</title>
    <link>https://${url.hostname}/generate?target=${encodeURIComponent(target)}</link>
    <description>Generated stock market feed for ${target}</description>
    ${xmlItems}
  </channel>
</rss>`;

      return new Response(xml, {
        headers: { ...corsHeaders, "Content-Type": "application/xml; charset=utf-8" }
      });
    }

    // 2. PROXY EXISTING RSS FEEDS TO JSON
    if (url.pathname === "/rss") {
      const feedUrl = url.searchParams.get("url");
      if (!feedUrl) return new Response(JSON.stringify({ ok: false, error: "Missing URL" }), { headers: corsHeaders });

      try {
        const res = await fetch(feedUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const text = await res.text();
        const items = [];
        const matches = text.match(/<item[\s\S]*?<\/item>/gi) || text.match(/<entry[\s\S]*?<\/entry>/gi) || [];

        for (const m of matches) {
          const title = (m.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || "";
          const link = (m.match(/<link[^>]*href=["']([^"']+)["']/i) || m.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || [])[1] || "";
          const desc = (m.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || m.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i) || [])[1] || "";
          const date = (m.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i) || m.match(/<updated[^>]*>(.*?)<\/updated>/i) || [])[1] || new Date().toISOString();

          items.push({
            id: btoa(link || title).slice(0, 16),
            title: title.replace(/<[^>]+>/g, "").trim(),
            description: desc.replace(/<[^>]+>/g, "").trim(),
            url: link.trim(),
            date: new Date(date).toISOString()
          });
        }

        return new Response(JSON.stringify({ ok: true, count: items.length, items }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { headers: corsHeaders });
      }
    }

    return new Response("MarketFeed Worker Running", { headers: corsHeaders });
  }
};