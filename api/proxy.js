// Vercel Serverless Function – myTischtennis Proxy
// Datei: api/proxy.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, x-client-info");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const target = req.query.url;
  if (!target) {
    return res.status(400).json({ error: "Kein url Parameter angegeben" });
  }

  // Erlaubte Domains
  const allowed = [
    "https://www.mytischtennis.de/",
    "https://supabase.mytischtennis.de/",
  ];
  if (!allowed.some(d => target.startsWith(d))) {
    return res.status(403).json({ error: "Nur mytischtennis.de ist erlaubt" });
  }

  try {
    const forwardHeaders = {
      "Content-Type": req.headers["content-type"] || "application/json",
      "Accept": req.headers["accept"] || "application/json, text/html, */*",
      "User-Agent": "Mozilla/5.0 (Android 14; Mobile) AppleWebKit/537.36",
    };

    // Supabase-spezifische Header weiterleiten
    if (req.headers["apikey"]) forwardHeaders["apikey"] = req.headers["apikey"];
    if (req.headers["authorization"]) forwardHeaders["Authorization"] = req.headers["authorization"];
    if (req.headers["cookie"]) forwardHeaders["Cookie"] = req.headers["cookie"];
    if (req.headers["x-client-info"]) forwardHeaders["x-client-info"] = req.headers["x-client-info"];

    let body = undefined;
    if (req.method === "POST") {
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body,
      redirect: "follow",
    });

    // Alle relevanten Response-Header weitergeben
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("Set-Cookie", setCookie);
      res.setHeader("X-Set-Cookie", setCookie);
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.setHeader("Content-Type", contentType || "text/html");
      return res.status(response.status).send(text);
    }

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(502).json({ error: "Proxy-Fehler", message: err.message });
  }
}