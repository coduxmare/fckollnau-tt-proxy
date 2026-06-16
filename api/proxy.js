export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── Spielplan komplett (Remix _data endpoint) ──────────────────────────
  if (action === 'spielplan') {
    const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
    const _data = 'routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielplan.$filter';
    const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/spielplan/gesamt?_data=${encodeURIComponent(_data)}`;
    try {
      const r = await fetch(url, { headers: hdrs() });
      const json = JSON.parse(await r.text());
      // Flatten date-grouped meetings, filter to this team
      const raw = json?.data?.meetings || [];
      const flat = [];
      for (const dayObj of raw) {
        for (const games of Object.values(dayObj)) {
          if (Array.isArray(games)) {
            for (const g of games) {
              if (g.team_home_id == teamId || g.team_away_id == teamId) flat.push(g);
            }
          }
        }
      }
      return res.status(200).json({ ok: true, meetings: flat });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── Spielerbilanzen (für Ich-Tab & Heimseite) ──────────────────────────
  if (action === 'bilanzen') {
    const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
    const _data = 'routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/spielerbilanzen.$filter';
    const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaft/${teamId}/x/spielerbilanzen/gesamt?_data=${encodeURIComponent(_data)}`;
    try {
      const r = await fetch(url, { headers: hdrs() });
      const json = JSON.parse(await r.text());
      const bs = json?.data?.balancesheet || [];
      const myTeam = bs.find(t => String(t.team_id) === String(teamId)) || bs[0] || {};
      return res.status(200).json({
        ok: true,
        players: myTeam.single_player_statistics || [],
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── Spielersuche → Q-TTR (öffentlich, POST) ────────────────────────────
  if (action === 'suche') {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });
    try {
      const r = await fetch('https://www.mytischtennis.de/api/search/players', {
        method: 'POST',
        headers: { ...hdrs(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `query=${encodeURIComponent(query)}&pagesize=10`,
      });
      const json = JSON.parse(await r.text());
      return res.status(200).json({ ok: true, results: json.results || [] });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── Generic proxy (für direkte API-Calls vom Client) ───────────────────
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url or action' });
  let target;
  try { target = new URL(decodeURIComponent(url)); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!target.hostname.endsWith('mytischtennis.de'))
    return res.status(403).json({ error: 'Forbidden domain' });
  try {
    const r = await fetch(target.toString(), { headers: hdrs() });
    const text = await r.text();
    try { return res.status(200).json(JSON.parse(text)); } catch {}
    return res.status(200).send(text);
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

function hdrs() {
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
    'Accept': 'application/json, */*',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://www.mytischtennis.de/',
  };
}
