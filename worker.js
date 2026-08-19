export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/news" || url.pathname.endsWith("/news")) {
      try {
        const searchQuery = url.searchParams.get("query") || "Indian stock market";
        const apiKey = env.GOOGLE_NEWS_API_KEY;

        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Missing GOOGLE_NEWS_API_KEY in Cloudflare Worker secrets." }),
            { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&apiKey=${apiKey}&sortBy=publishedAt&language=en`;

        const response = await fetch(apiUrl, {
          headers: { "User-Agent": "MarketFeed-Worker/1.0" }
        });

        if (!response.ok) {
          return new Response(
            JSON.stringify({ error: `News API HTTP ${response.status}` }),
            { status: response.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const data = await response.json();

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Worker Execution Error", details: err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    return new Response(
      JSON.stringify({ status: "MarketFeed Backend Worker Live" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};