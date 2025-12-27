// GARZA OS YouVersion Bible API
const YV_KEY = "YBlQWiiIZ80shMLwVF6vR9P5klEP25p8CPXSf3N1f5AlNXfL";
const YV_API = "https://api.youversion.com/v1";

async function getPassage(ref, version = "111") {
  const res = await fetch(`${YV_API}/bibles/${version}/passages/${ref}`, { 
    headers: { "X-YVP-App-Key": YV_KEY } 
  });
  return res.json();
}

async function getVotd() {
  const verses = ["JHN.3.16", "PHP.4.13", "ROM.8.28", "JER.29.11"];
  const idx = Math.floor(Date.now() / 86400000) % verses.length;
  return getPassage(verses[idx]);
}

async function getBibles() {
  const res = await fetch(`${YV_API}/bibles`, { 
    headers: { "X-YVP-App-Key": YV_KEY } 
  });
  return res.json();
}

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path === "/callback") {
      return new Response(JSON.stringify({ status: "ok" }), { 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }
    
    if (path === "/votd") {
      return new Response(JSON.stringify(await getVotd()), { 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }
    
    if (path.startsWith("/passage/")) {
      const ref = path.slice(9);
      return new Response(JSON.stringify(await getPassage(ref)), { 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }
    
    if (path === "/bibles") {
      return new Response(JSON.stringify(await getBibles()), { 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }
    
    return new Response("GARZA OS Bible API - /votd, /passage/:ref, /bibles", { 
      headers: corsHeaders 
    });
  }
};
