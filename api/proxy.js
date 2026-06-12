export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, url } = req.query;

  // ── ACTION-BASED ENDPOINTS ──────────────────────────────────────────
  if (action === 'tabelle') {
    return handleTabelle(req, res);
  }
  if (action === 'spielplan') {
    return handleSpielplan(req, res);
  }
  if (action === 'bilanzen') {
    return handleBilanzen(req, res);
  }
  if (action === 'vereinsteams') {
    return handleVereinsTeams(req, res);
  }
  if (action === 'mannschaftsmeldungen') {
    return handleMannschaftsMeldungen(req, res);
  }

  // ── GENERIC PROXY (fallback) ────────────────────────────────────────
  if (!url) return res.status(400).json({ error: 'Missing url or action' });

  let targetUrl;
  try { targetUrl = new URL(decodeURIComponent(url)); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  if (!targetUrl.hostname.endsWith('mytischtennis.de')) {
    return res.status(403).json({ error: 'Forbidden domain' });
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: baseHeaders(targetUrl.toString()),
    });
    const text = await response.text();
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try { return res.status(200).json(JSON.parse(text)); } catch {}
    }
    return res.status(200).send(text);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── HELPERS ─────────────────────────────────────────────────────────────
function baseHeaders(referer) {
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    'Referer': referer || 'https://www.mytischtennis.de/',
    'Cache-Control': 'no-cache',
  };
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: baseHeaders(url) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Try JSON via _data param with Accept: application/json header
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      ...baseHeaders(url),
      'Accept': 'application/json',
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error('Response is not JSON: ' + text.slice(0, 200)); }
}

// ── TABELLE ──────────────────────────────────────────────────────────────
async function handleTabelle(req, res) {
  const { groupId = '494633', assoc = 'TTBW', season = '25--26' } = req.query;

  // Try JSON endpoint first
  const jsonUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/tabelle/gesamt`
    + `?_data=routes%2Fclick-tt%2B%2F%24association%2B%2F%24season%2B%2F%24type%2B%2F%24groupname.gruppe.%24urlid%2B%2Ftabelle.%24filter`;

  try {
    const data = await fetchJson(jsonUrl);
    if (data?.data?.league_table?.length) {
      return res.status(200).json({ ok: true, source: 'json', data });
    }
  } catch (e) {
    // fall through to HTML parsing
  }

  // Fallback: parse HTML
  try {
    const htmlUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/tabelle/gesamt`;
    const html = await fetchHtml(htmlUrl);
    const table = parseTableHtml(html);
    return res.status(200).json({ ok: true, source: 'html', data: { data: { league_table: table } } });
  } catch (e) {
    return res.status(500).json({ error: 'Tabelle failed: ' + e.message });
  }
}

function parseTableHtml(html) {
  // Extract table rows from HTML
  // Pattern: rank | team name | Beg. | S | U | N | Spiele | +/- | Punkte
  const rows = [];

  // Find all table rows
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  let rowIndex = 0;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      cells.push(stripHtml(tdMatch[1]).trim());
    }

    if (cells.length >= 7) {
      const rank = parseInt(cells[0]);
      if (!isNaN(rank) && rank >= 1) {
        // Extract team name and optional team_id from link
        const teamNameMatch = trMatch[1].match(/mannschaft\/(\d+)\/[^"]*"[^>]*>([^<]+)<\/a>/);
        const teamId = teamNameMatch ? teamNameMatch[1] : null;
        const teamName = teamNameMatch ? teamNameMatch[2].trim() : cells[1];

        // Parse Punkte (last column like "14:4")
        const punkte = cells[cells.length - 1];
        const [pts_won, pts_lost] = punkte.split(':').map(Number);

        // Parse S:U:N (columns 3,4,5 if present)
        const S = parseInt(cells[3]) || 0;
        const U = parseInt(cells[4]) || 0;
        const N = parseInt(cells[5]) || 0;

        // Parse Spiele (like "175:104")
        const spieleStr = cells[6] || '';
        const [matches_won, matches_lost] = spieleStr.split(':').map(s => parseInt(s) || 0);

        rows.push({
          table_rank: rank,
          team_name: teamName,
          team_id: teamId,
          meetings_won: S,
          meetings_tie: U,
          meetings_lost: N,
          matches_won,
          matches_lost,
          points_won: pts_won || 0,
          points_lost: pts_lost || 0,
        });
        rowIndex++;
      }
    }
  }
  return rows;
}

// ── SPIELPLAN ─────────────────────────────────────────────────────────────
async function handleSpielplan(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;

  // Try JSON
  const jsonUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/spielplan/gesamt`
    + `?_data=routes%2Fclick-tt%2B%2F%24association%2B%2F%24season%2B%2F%24type%2B%2F%24groupname.gruppe.%24urlid%2B%2Fspielplan.%24filter`;

  try {
    const data = await fetchJson(jsonUrl);
    // Extract meetings from nested structure
    const raw = data?.data?.meetings;
    if (raw) {
      const meetings = extractMeetingsFromRaw(raw, teamId);
      if (meetings.length) return res.status(200).json({ ok: true, source: 'json', meetings });
    }
  } catch {}

  // Fallback: HTML of Mannschaft page
  try {
    const htmlUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/spielplan/gesamt`;
    const html = await fetchHtml(htmlUrl);
    const meetings = parseSpielplanHtml(html, teamId);
    return res.status(200).json({ ok: true, source: 'html', meetings });
  } catch (e) {
    return res.status(500).json({ error: 'Spielplan failed: ' + e.message });
  }
}

function extractMeetingsFromRaw(raw, teamId) {
  const meetings = [];
  if (Array.isArray(raw)) {
    for (const dayObj of raw) {
      for (const [date, games] of Object.entries(dayObj)) {
        if (Array.isArray(games)) {
          for (const g of games) {
            if (!teamId || g.team_home_id == teamId || g.team_away_id == teamId) {
              meetings.push(g);
            }
          }
        }
      }
    }
  }
  return meetings;
}

function parseSpielplanHtml(html, teamId) {
  const meetings = [];
  // Look for table rows with date, teams, result
  // Pattern from click-tt HTML tables
  const datePattern = /(\w+\.\s*\d{2}\.\d{2}\.\d{2})/;
  const resultPattern = /(\d+):(\d+)/;

  // Split by rows
  const rows = html.split(/<tr[^>]*>/i).slice(1);

  let currentDate = null;

  for (const row of rows) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRe.exec(row)) !== null) {
      cells.push(stripHtml(m[1]).trim());
    }

    if (cells.length === 0) continue;

    // Check if first cell has a date
    const dateMatch = cells[0].match(/(\d{2}\.\d{2}\.\d{2})/);
    if (dateMatch) {
      const [d, mo, y] = dateMatch[1].split('.');
      currentDate = `20${y}-${mo}-${d}`;
    }

    if (cells.length >= 4 && currentDate) {
      // Try to find team links
      const homeTeamMatch = row.match(/mannschaft\/(\d+)\/[^"]*">([^<]+)<\/a>[\s\S]*?mannschaft\/(\d+)\/[^"]*">([^<]+)<\/a>/);
      if (!homeTeamMatch) continue;

      const [, homeId, homeName, awayId, awayName] = homeTeamMatch;

      if (!teamId || homeId == teamId || awayId == teamId) {
        // Find time
        const timeMatch = cells.find(c => /^\d{2}:\d{2}/.test(c)) || '';
        const time = typeof timeMatch === 'string' ? timeMatch.replace(/[v]$/, '').trim() : '';

        // Find result
        const resultCell = cells.find(c => /^\d+:\d+$/.test(c));
        const resultMatch = resultCell ? resultCell.match(/^(\d+):(\d+)$/) : null;

        const meeting = {
          date: currentDate + (time ? `T${time}:00` : 'T00:00:00'),
          team_home: homeName.trim(),
          team_home_id: homeId,
          team_away: awayName.trim(),
          team_away_id: awayId,
          state: resultMatch ? 'done' : 'scheduled',
        };

        if (resultMatch) {
          meeting.matches_won = resultMatch[1];
          meeting.matches_lost = resultMatch[2];
        }

        meetings.push(meeting);
      }
    }
  }
  return meetings;
}

// ── BILANZEN (Spielerbilanzen der Mannschaft) ─────────────────────────────
async function handleBilanzen(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;

  const jsonUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaft/${teamId}/x/spielerbilanzen/gesamt`
    + `?_data=routes%2Fclick-tt%2B%2F%24association%2B%2F%24season%2B%2F%24type%2B%2F(%24groupname).gruppe.%24urlid_.mannschaft.%24teamid.%24teamname%2B%2Fspielerbilanzen.%24filter`;

  try {
    const data = await fetchJson(jsonUrl);
    const balances = data?.data?.player_balances;
    if (balances?.length) {
      return res.status(200).json({ ok: true, source: 'json', player_balances: balances });
    }
  } catch {}

  // HTML fallback
  try {
    const htmlUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaft/${teamId}/x/spielerbilanzen/gesamt`;
    const html = await fetchHtml(htmlUrl);
    const balances = parseBilanzenHtml(html);
    return res.status(200).json({ ok: true, source: 'html', player_balances: balances });
  } catch (e) {
    return res.status(500).json({ error: 'Bilanzen failed: ' + e.message });
  }
}

function parseBilanzenHtml(html) {
  const players = [];
  const rows = html.split(/<tr[^>]*>/i).slice(1);

  for (const row of rows) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRe.exec(row)) !== null) {
      cells.push(stripHtml(m[1]).trim());
    }

    // Expect: rank | name | games | won | lost
    if (cells.length >= 4) {
      const won = parseInt(cells[cells.length - 2]);
      const lost = parseInt(cells[cells.length - 1]);
      const name = cells[1] || cells[0];
      if (!isNaN(won) && !isNaN(lost) && name && name.length > 2) {
        const nameParts = name.split(',').map(s => s.trim());
        players.push({
          player_lastname: nameParts[0] || name,
          player_firstname: nameParts[1] || '',
          points_won: won,
          points_lost: lost,
          meetings_count: won + lost,
        });
      }
    }
  }
  return players;
}

// ── VEREINSTEAMS ─────────────────────────────────────────────────────────
async function handleVereinsTeams(req, res) {
  const { clubId = '22036', assoc = 'TTBW', season = '25--26' } = req.query;

  // Try JSON
  const jsonUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/verein/${clubId}/x/mannschaften`
    + `?_data=routes%2Fclick-tt%2B%2F%24association%2B%2F%24season%2B%2Fverein.%24clubid.%24clubname%2B%2Fmannschaften`;

  try {
    const data = await fetchJson(jsonUrl);
    const teams = data?.data?.teams;
    if (teams?.length) return res.status(200).json({ ok: true, source: 'json', teams });
  } catch {}

  // HTML fallback
  try {
    const htmlUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/verein/${clubId}/x/mannschaften`;
    const html = await fetchHtml(htmlUrl);
    const teams = parseVereinsTeamsHtml(html);
    return res.status(200).json({ ok: true, source: 'html', teams });
  } catch (e) {
    return res.status(500).json({ error: 'VereinsTeams failed: ' + e.message });
  }
}

function parseVereinsTeamsHtml(html) {
  const teams = [];
  // Find team links and their context
  const teamRe = /mannschaft\/(\d+)\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = teamRe.exec(html)) !== null) {
    const [, teamId, , teamName] = m;
    if (!teams.find(t => t.team_id === teamId)) {
      teams.push({
        team_id: teamId,
        team_name: teamName.trim(),
        points_won: 0,
        points_lost: 0,
        table_rank: null,
        league_name: '',
      });
    }
  }
  return teams;
}

// ── STRIP HTML ────────────────────────────────────────────────────────────
function stripHtml(str) {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#[0-9]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── MANNSCHAFTSMELDUNGEN (für TTR/Q-TTR) ────────────────────────────────────
async function handleMannschaftsMeldungen(req, res) {
  const { groupId = '494633', teamId = '2960786', assoc = 'TTBW', season = '25--26' } = req.query;

  const _dataVr = 'routes%2Fclick-tt%2B%2F%24association%2B%2F%24season%2B%2F%24type%2B%2F%24groupname.gruppe.%24urlid%2B%2Fmannschaftsmeldungen.%24filter';
  const jsonUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaftsmeldungen/vr?_data=${_dataVr}`;

  try {
    const data = await fetchJson(jsonUrl);
    const teams = data?.data?.teams || [];
    const myTeam = teams.find(t => t.team_id == teamId);
    const players = myTeam?.players || [];
    return res.status(200).json({ ok: true, source: 'json', players });
  } catch {}

  // HTML fallback
  try {
    const htmlUrl = `https://www.mytischtennis.de/click-tt/${assoc}/${season}/ligen/x/gruppe/${groupId}/mannschaftsmeldungen/vr`;
    const html = await fetchHtml(htmlUrl);
    const players = parseMeldungenHtml(html, teamId);
    return res.status(200).json({ ok: true, source: 'html', players });
  } catch (e) {
    return res.status(500).json({ error: 'Meldungen failed: ' + e.message });
  }
}

function parseMeldungenHtml(html, teamId) {
  const players = [];
  // Look for Q-TTR values near player names
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  for (const row of rows) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRe.exec(row)) !== null) cells.push(stripHtml(m[1]).trim());

    if (cells.length >= 3) {
      const ttr = parseInt(cells[cells.length-1]);
      const name = cells[1] || cells[0];
      if (!isNaN(ttr) && ttr > 400 && ttr < 3000 && name?.length > 2) {
        const parts = name.split(',').map(s => s.trim());
        players.push({ lastname: parts[0], firstname: parts[1]||'', q_ttr: ttr });
      }
    }
  }
  return players;
}
