// Vercel Serverless Function – myTischtennis Proxy
// Datei: api/proxy.js

export default async function handler(req, res) {
  // CORS-Header für deine PWA erlauben
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Ziel-URL aus Query-Parameter lesen
  const target = req.query.url;
  if (!target) {
    return res.status(400).json({ error: "Kein url Parameter angegeben" });
  }

  // Nur mytischtennis.de erlauben (Sicherheit)
  if (!target.startsWith("https://www.mytischtennis.de/")) {
    return res.status(403).json({ error: "Nur mytischtennis.de ist erlaubt" });
  }

  try {
    // Alle Header vom Original-Request weiterleiten
    const forwardHeaders = {
      "Content-Type": req.headers["content-type"] || "application/x-www-form-urlencoded",
      "Accept": req.headers["accept"] || "application/json, text/html, */*",
      "User-Agent": "Mozilla/5.0 (Android 14; Mobile) AppleWebKit/537.36",
    };

    // Cookie weiterleiten (für Session)
    if (req.headers["cookie"]) {
      forwardHeaders["Cookie"] = req.headers["cookie"];
    }
    // Authorization weiterleiten
    if (req.headers["authorization"]) {
      forwardHeaders["Authorization"] = req.headers["authorization"];
    }

    // Body für POST-Requests
    let body = undefined;
    if (req.method === "POST") {
      if (typeof req.body === "object") {
        body = new URLSearchParams(req.body).toString();
      } else {
        body = req.body;
      }
    }

    const response = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body: body,
      redirect: "follow",
    });

    // Response-Cookie zurückgeben (für Login-Session)
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("Set-Cookie", setCookie);
      // Cookie auch als JSON zurückgeben damit die PWA ihn lesen kann
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
