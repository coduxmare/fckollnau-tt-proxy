// Vercel Serverless Function – myTischtennis Proxy
// Datei: api/proxy.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, x-client-info");

  if (req.method === "OPTIONS") return res.status(200).end();

  const SUPA_URL = "https://supabase.mytischtennis.de";
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzYiIsInJvbGUiOiJhbm9uIiwiZXhwIjo5OTk5OTk5OTk5fQ.uuv5nJLBPFYbi2gSnxzPZ1jOPwV9rDZKTKBQDFAhXnE";

  // ── Token Refresh ──────────────────────────────
  if (req.query.action === "refresh") {
    try {
      const { refresh_token } = typeof req.body === "string"
        ? JSON.parse(req.body) : req.body;

      const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "apikey": SUPA_KEY,
          "Authorization": `Bearer ${SUPA_KEY}`,
          "Origin": "https://www.mytischtennis.de",
          "Referer": "https://www.mytischtennis.de/",
          "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36",
        },
        body: JSON.stringify({ refresh_token }),
      });

      const data = await resp.json().catch(() => ({}));
      return res.status(resp.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: "Refresh-Fehler", message: err.message });
    }
  }

  // ── Login (mit CAPTCHA – bleibt als Fallback) ──
  if (req.query.action === "login") {
    try {
      const { email, password } = typeof req.body === "string"
        ? JSON.parse(req.body) : req.body;

      const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "apikey": SUPA_KEY,
          "Authorization": `Bearer ${SUPA_KEY}`,
          "Origin": "https://www.mytischtennis.de",
          "Referer": "https://www.mytischtennis.de/",
          "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await resp.json().catch(() => ({}));
      return res.status(resp.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: "Login-Fehler", message: err.message });
    }
  }

  // ── Allgemeiner Proxy ──────────────────────────
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: "Kein url Parameter" });

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
      "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36",
      "Origin": "https://www.mytischtennis.de",
      "Referer": "https://www.mytischtennis.de/",
    };

    if (req.headers["apikey"]) forwardHeaders["apikey"] = req.headers["apikey"];
    if (req.headers["authorization"]) forwardHeaders["Authorization"] = req.headers["authorization"];
    if (req.headers["cookie"]) forwardHeaders["Cookie"] = req.headers["cookie"];

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
    return res.status(502).json({ error: "Proxy-Fehler", message: err.message });
  }
}
