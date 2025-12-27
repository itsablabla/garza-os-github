// Jessica cron - triggers jessica-bot daily at 7am Denver
export default {
  async scheduled(event, env, ctx) {
    const response = await fetch("https://jessica-bot.fly.dev/trigger", {
      method: "POST",
      headers: {
        "x-webhook-secret": env.WEBHOOK_SECRET,
        "Content-Type": "application/json"
      }
    });
    const result = await response.text();
    console.log("Jessica bot trigger result:", result);
    return result;
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/test") {
      const response = await fetch("https://jessica-bot.fly.dev/trigger", {
        method: "POST",
        headers: {
          "x-webhook-secret": env.WEBHOOK_SECRET,
          "Content-Type": "application/json"
        }
      });
      return new Response(await response.text(), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      status: "ok",
      service: "jessica-cron",
      schedule: "7am Denver daily"
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
