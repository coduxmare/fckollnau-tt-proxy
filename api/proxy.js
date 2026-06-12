export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, url } = req.query;

  if (action === 'tabelle')            return handleTabelle(req, res);
  if (action === 'spielplan')          return handleSpielplan(req, res);
  if (action === 'bilanzen')           return handleBilanzen(req, res);
  if (action === 'vereinsteams')       return handleVereinsTeams(req, res);
  if (action === 'mannschaftsmeldungen') return handleMeldungen(req, res);

  // Generic proxy fallback
  if (!url) return res.status(400).json({ error: 'Missing url or action' });
  let targetUrl;
  try { targetUrl = new URL(decodeURIComponent(url)); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!targetUrl.hostname.endsWith('mytischtennis.de'))
    return res.status(403).json({ error: 'Forbidden domain' });

  try {
    const r = await fetch(targetUrl.toString(), { headers: makeHeaders() });
    const text = await r.text();
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try { return res.status(200).json(JSON.parse(text)); } catch {}
    }
    return res.status(200).send(text);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://www.mytischtennis.de/',
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: makeHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  const parsed = JSON.parse(text); // throws if not JSON
  return parsed;
}

// URL-encode a _data value the same way a browser would
function dataParam(val) {
  return encodeURIComponent(val);
}

// ─── TABELLE ─────────────────────────────────────────────────────────────────
// _data = routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/tabelle.$filter
async function handleTabelle(req, res) {
  const { groupId = '494633', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/tabelle.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/tabelle/gesamt?_data=${dataParam(_data)}`;
  try {
    const json = await fetchJson(url);
    const rows = json?.data?.league_table || [];
    if (rows.length) return res.status(200).json({ ok: true, source: 'json', league_table: rows });
    return res.status(200).json({ ok: false, error: 'Empty league_table', raw: json });
  } catch (e) {
    return res.status(500).json({ error: 'tabelle failed: ' + e.message });
  }
}

// ─── SPIELPLAN ───────────────────────────────────────────────────────────────
// _data = routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielplan.$filter
// Returns meetings array (already flat, grouped by date in raw response)
async function handleSpielplan(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielplan.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/spielplan/gesamt?_data=${dataParam(_data)}`;
  try {
    const json = await fetchJson(url);
    // Response: { data: { meetings: [ { "2025-09-15": [{...}, ...] }, ... ] } }
    const rawMeetings = json?.data?.meetings || [];
    const flat = [];
    for (const dayObj of rawMeetings) {
      for (const dayMeetings of Object.values(dayObj)) {
        if (Array.isArray(dayMeetings)) {
          for (const m of dayMeetings) {
            if (!teamId || m.team_home_id == teamId || m.team_away_id == teamId) {
              flat.push(m);
            }
          }
        }
      }
    }
    return res.status(200).json({ ok: true, source: 'json', meetings: flat });
  } catch (e) {
    return res.status(500).json({ error: 'spielplan failed: ' + e.message });
  }
}

// ─── BILANZEN ────────────────────────────────────────────────────────────────
// URL: /click-tt/{assoc}/{season}/ligen/{slug}/gruppe/{groupId}/mannschaft/{teamId}/{teamName}/spielerbilanzen/{filter}
// _data = routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/spielerbilanzen.$filter
async function handleBilanzen(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/spielerbilanzen.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaft/${teamId}/x/spielerbilanzen/gesamt?_data=${dataParam(_data)}`;
  try {
    const json = await fetchJson(url);
    const balances = json?.data?.player_balances || [];
    if (balances.length) return res.status(200).json({ ok: true, source: 'json', player_balances: balances });
    return res.status(200).json({ ok: false, error: 'Empty player_balances', raw: json });
  } catch (e) {
    return res.status(500).json({ error: 'bilanzen failed: ' + e.message });
  }
}

// ─── VEREINSTEAMS ────────────────────────────────────────────────────────────
// Two strategies:
// 1. /api/ttr/teams?clubNumber=22036&organization=TTBW  (simple, public)
// 2. /click-tt/{assoc}/{season}/verein/{clubId}/x/mannschaften  (frontend loader)
// _data = routes/click-tt+/$association+/$season+/verein.$clubid.$clubname+/mannschaften
async function handleVereinsTeams(req, res) {
  const { clubId = '22036', assoc = 'TTBW', season = '25--26' } = req.query;

  // Strategy 1: simple API endpoint
  try {
    const url1 = `https://www.mytischtennis.de/api/ttr/teams?clubNumber=${clubId}&organization=${assoc}`;
    const json = await fetchJson(url1);
    const teams = json?.data || [];
    if (teams.length) return res.status(200).json({ ok: true, source: 'api', teams });
  } catch {}

  // Strategy 2: frontend loader
  try {
    const _data = 'routes/click-tt+/$association+/$season+/verein.$clubid.$clubname+/mannschaften';
    const url2 = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/verein/${clubId}/x/mannschaften?_data=${dataParam(_data)}`;
    const json = await fetchJson(url2);
    const teams = json?.data?.teams || [];
    if (teams.length) return res.status(200).json({ ok: true, source: 'json', teams });
    return res.status(200).json({ ok: false, error: 'No teams found', raw: json });
  } catch (e) {
    return res.status(500).json({ error: 'vereinsteams failed: ' + e.message });
  }
}

// ─── MANNSCHAFTSMELDUNGEN (für TTR/Q-TTR) ────────────────────────────────────
// _data = routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/mannschaftsmeldungen.$filter
async function handleMeldungen(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/mannschaftsmeldungen.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaftsmeldungen/vr?_data=${dataParam(_data)}`;
  try {
    const json = await fetchJson(url);
    // Response: { data: { teams: [ { team_id, players: [{player_id, player_firstname, player_lastname, q_ttr, ...}] } ] } }
    const teams = json?.data?.teams || [];
    const myTeam = teams.find(t => String(t.team_id) === String(teamId));
    const players = myTeam?.players || [];
    return res.status(200).json({ ok: true, source: 'json', players, all_teams: teams.length });
  } catch (e) {
    return res.status(500).json({ error: 'meldungen failed: ' + e.message });
  }
}
