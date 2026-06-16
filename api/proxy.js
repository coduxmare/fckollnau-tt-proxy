export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  if (action === 'tabelle')       return handleTabelle(req, res);
  if (action === 'spielplan')     return handleSpielplan(req, res);
  if (action === 'bilanzen')      return handleBilanzen(req, res);
  if (action === 'vereinsrang')   return handleVereinsRang(req, res);
  if (action === 'meldungen')     return handleMeldungen(req, res);

  // Generic proxy fallback
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url or action' });
  let targetUrl;
  try { targetUrl = new URL(decodeURIComponent(url)); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!targetUrl.hostname.endsWith('mytischtennis.de'))
    return res.status(403).json({ error: 'Forbidden domain' });
  try {
    const r = await fetch(targetUrl.toString(), { headers: hdr() });
    const text = await r.text();
    try { return res.status(200).json(JSON.parse(text)); } catch {}
    return res.status(200).send(text);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function hdr() {
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://www.mytischtennis.de/',
  };
}
async function fetchJson(url) {
  const r = await fetch(url, { headers: hdr() });
  if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`);
  return JSON.parse(await r.text());
}
async function fetchHtml(url) {
  const r = await fetch(url, { headers: hdr() });
  if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`);
  return r.text();
}
const enc = v => encodeURIComponent(v);

// ─── TABELLE ─────────────────────────────────────────────────────────────────
async function handleTabelle(req, res) {
  const { groupId = '494633', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/tabelle.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/tabelle/gesamt?_data=${enc(_data)}`;
  try {
    const json = await fetchJson(url);
    const rows = json?.data?.league_table || [];
    return res.status(200).json({ ok: true, league_table: rows });
  } catch (e) {
    return res.status(500).json({ error: 'tabelle: ' + e.message });
  }
}

// ─── SPIELPLAN ───────────────────────────────────────────────────────────────
async function handleSpielplan(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielplan.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/spielplan/gesamt?_data=${enc(_data)}`;
  try {
    const json = await fetchJson(url);
    const rawMeetings = json?.data?.meetings || [];
    const flat = [];
    for (const dayObj of rawMeetings) {
      for (const dayMeetings of Object.values(dayObj)) {
        if (Array.isArray(dayMeetings)) {
          for (const m of dayMeetings) {
            if (!teamId || m.team_home_id == teamId || m.team_away_id == teamId)
              flat.push(m);
          }
        }
      }
    }
    return res.status(200).json({ ok: true, meetings: flat });
  } catch (e) {
    return res.status(500).json({ error: 'spielplan: ' + e.message });
  }
}

// ─── BILANZEN (FC Kollnau III) ───────────────────────────────────────────────
async function handleBilanzen(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/spielerbilanzen.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaft/${teamId}/x/spielerbilanzen/gesamt?_data=${enc(_data)}`;
  try {
    const json = await fetchJson(url);
    const balancesheet = json?.data?.balancesheet || [];
    const myTeam = balancesheet.find(t => String(t.team_id) === String(teamId)) || balancesheet[0];
    const players = myTeam?.single_player_statistics || [];
    return res.status(200).json({ ok: true, players });
  } catch (e) {
    return res.status(500).json({ error: 'bilanzen: ' + e.message });
  }
}

// ─── VEREINSRANGLISTE ────────────────────────────────────────────────────────
// Step 1: fetch player NUIDs from all 5 teams' Spielerbilanzen
// Step 2: fetch Q-TTR for each player from Spielerportrait HTML
// Step 3: return sorted list
const TEAMS = [
  { name: 'FC Kollnau I',   teamId: '2959788', groupId: '494496', ligaSlug: 'x' },
  { name: 'FC Kollnau II',  teamId: '2960599', groupId: '494202', ligaSlug: 'x' },
  { name: 'FC Kollnau III', teamId: '2960786', groupId: '494633', ligaSlug: 'x' },
  { name: 'FC Kollnau IV',  teamId: '2959922', groupId: '494684', ligaSlug: 'x' },
  { name: 'FC Kollnau V',   teamId: '2992085', groupId: '502100', ligaSlug: 'x' },
];

async function handleVereinsRang(req, res) {
  const { assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/spielerbilanzen.$filter';

  // Collect all players across all teams (deduplicated by player_id)
  const playerMap = {}; // player_id → { name, nuid, team, wins, losses }

  await Promise.allSettled(TEAMS.map(async team => {
    try {
      const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/${team.ligaSlug}/gruppe/${team.groupId}/mannschaft/${team.teamId}/x/spielerbilanzen/gesamt?_data=${enc(_data)}`;
      const json = await fetchJson(url);
      const balancesheet = json?.data?.balancesheet || [];
      const myTeam = balancesheet.find(t => String(t.team_id) === String(team.teamId)) || balancesheet[0];
      const players = myTeam?.single_player_statistics || [];

      for (const p of players) {
        const id = p.player_id;
        if (!id) continue;
        if (!playerMap[id]) {
          playerMap[id] = {
            player_id:   id,
            firstname:   p.player_firstname || '',
            lastname:    p.player_lastname  || '',
            team:        team.name,
            wins:        0,
            losses:      0,
            q_ttr:       null,
          };
        }
        // accumulate wins/losses (player may appear in multiple teams)
        playerMap[id].wins   += parseInt(p.points_won  || 0);
        playerMap[id].losses += parseInt(p.points_lost || 0);
      }
    } catch (_) { /* skip failed team */ }
  }));

  const players = Object.values(playerMap);
  if (!players.length) {
    return res.status(500).json({ error: 'Keine Spieler gefunden' });
  }

  // Fetch Q-TTR for each player from Spielerportrait
  // Rate-limit: process in batches of 5 to avoid hammering the server
  async function getQTTR(nuid) {
    try {
      const url = `https://www.mytischtennis.de/click-tt/spieler/${nuid}/spielerportrait`;
      const html = await fetchHtml(url);
      // Pattern: "Q-TTR-Wert" followed by the number in the HTML
      const match = html.match(/Q-TTR-Wert[\s\S]{0,200}?(\d{3,4})/);
      return match ? parseInt(match[1]) : null;
    } catch { return null; }
  }

  // Process in batches of 6 parallel requests
  const batchSize = 6;
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);
    await Promise.all(batch.map(async p => {
      p.q_ttr = await getQTTR(p.player_id);
    }));
  }

  // Sort by Q-TTR descending (null values last)
  players.sort((a, b) => {
    if (a.q_ttr === null && b.q_ttr === null) return 0;
    if (a.q_ttr === null) return 1;
    if (b.q_ttr === null) return -1;
    return b.q_ttr - a.q_ttr;
  });

  return res.status(200).json({ ok: true, players });
}

// ─── MANNSCHAFTSMELDUNGEN (Q-TTR für "Ich"-Tab) ──────────────────────────────
async function handleMeldungen(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;
  const _data = 'routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/mannschaftsmeldungen.$filter';
  const url = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaftsmeldungen/vr?_data=${enc(_data)}`;
  try {
    const json = await fetchJson(url);
    const teams = json?.data?.teams || [];
    const myTeam = teams.find(t => String(t.team_id) === String(teamId));
    const players = myTeam?.players || [];
    return res.status(200).json({ ok: true, players });
  } catch (e) {
    return res.status(500).json({ error: 'meldungen: ' + e.message });
  }
}
