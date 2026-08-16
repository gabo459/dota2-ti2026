const fs = require('fs');
const { JSDOM } = require('jsdom');

const LIQUIPEDIA_API_URL = 'https://liquipedia.net/dota2/api.php?action=parse&page=The_International/2026/Group_Stage&format=json';
const FALLBACK_URL = 'https://liquipedia.net/dota2/api.php?action=parse&page=The_International/2026&format=json';

// Proxy de respaldo gratuito sin restricciones de localhost
const PROXY_ALLORIGINS = (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

async function fetchLiquipediaHTML() {
  const headers = {
    'User-Agent': 'Dota2HUDApp/1.0 (https://github.com/gabo459/dota2-ti2026; gabo459@github.com)',
    'Accept-Encoding': 'gzip',
    'Accept': 'application/json'
  };

  const urlsToTry = [
    LIQUIPEDIA_API_URL,
    FALLBACK_URL,
    PROXY_ALLORIGINS(LIQUIPEDIA_API_URL),
    PROXY_ALLORIGINS(FALLBACK_URL)
  ];

  for (const url of urlsToTry) {
    try {
      console.log(`Intentando conectar a: ${url}`);
      const res = await fetch(url, { headers });

      if (!res.ok) continue;

      const rawText = await res.text();
      
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        continue;
      }

      const html = data?.parse?.text?.['*'];

      if (html) {
        console.log(`✅ HTML obtenido correctamente desde: ${url}`);
        return html;
      }
    } catch (err) {
      console.warn(`⚠️ Falló el intento con ${url}: ${err.message}`);
    }
  }

  return null;
}

function parseRoundCell(td) {
  if (!td) return '-';
  const overview = td.querySelector('.standings-match-overview');
  if (!overview) return td.textContent.trim() || '-';

  const scoreEl = overview.querySelector('.generic-label, .label--standings-result');
  const score = scoreEl ? scoreEl.textContent.trim() : '';

  let result = '';
  if (scoreEl) {
    const labelType = scoreEl.getAttribute('data-label-type');
    if (labelType === 'result-win') result = 'win';
    else if (labelType === 'result-loss') result = 'loss';
    else {
      const parts = score.split(':').map(s => parseInt(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        if (parts[0] > parts[1]) result = 'win';
        else if (parts[0] < parts[1]) result = 'loss';
      }
    }
  }

  const teamIcon = overview.querySelector('.team-template-team-icon, .team-template-image-icon');
  let opponent = '';
  let opponentLogo = '';

  if (teamIcon) {
    opponent = teamIcon.getAttribute('data-highlighting-class') ||
               teamIcon.querySelector('a')?.getAttribute('title') ||
               teamIcon.querySelector('img')?.getAttribute('alt') || '';

    const img = teamIcon.querySelector('img');
    if (img) {
      opponentLogo = img.getAttribute('src') || '';
      if (opponentLogo.startsWith('/')) opponentLogo = 'https://liquipedia.net' + opponentLogo;
    }
  }

  if (score || opponent) {
    return { opponent, opponentLogo, score, result };
  }

  return td.textContent.trim() || '-';
}

function cleanTeamName(container) {
  if (!container) return 'TBD';

  const clone = container.cloneNode(true);
  clone.querySelectorAll('.team-template-shortname, .shortname, .mobile-only, .sm-only, [class*="short"]').forEach(el => el.remove());

  const anchor = clone.querySelector('a[title]');
  if (anchor && anchor.getAttribute('title')) {
    const title = anchor.getAttribute('title').trim();
    if (title && !title.startsWith('Edit') && !title.startsWith('File:')) {
      return title;
    }
  }

  const link = clone.querySelector('a');
  if (link && link.textContent.trim()) {
    return link.textContent.trim();
  }

  const rawText = clone.textContent.trim().replace(/\s+/g, ' ');
  return rawText || 'TBD';
}

function parseNextMatches(doc) {
  try {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const timerEls = Array.from(doc.querySelectorAll('.timer-object[data-timestamp]'));

    if (timerEls.length === 0) return null;

    const validItems = timerEls.map(el => ({
      el,
      timestamp: parseInt(el.getAttribute('data-timestamp'))
    })).filter(item => !isNaN(item.timestamp) && item.timestamp > (nowInSeconds - 1800));

    if (validItems.length === 0) return null;

    const minTimestamp = Math.min(...validItems.map(item => item.timestamp));
    const startTime = new Date(minTimestamp * 1000).toISOString();

    const concurrentMatchesEls = validItems.filter(item => item.timestamp === minTimestamp);
    const matchesRaw = [];

    concurrentMatchesEls.forEach(item => {
      const timerEl = item.el;
      const matchBox = timerEl.closest('.match-filler, .bracket-game, .brkts-match-info-popup, .matchbox, tr') || timerEl.parentElement;

      if (!matchBox) return;

      let team1 = 'TBD';
      let team2 = 'TBD';
      let team1Logo = '';
      let team2Logo = '';

      const teamLeft = matchBox.querySelector('.team-left, .match-filler-team-left, .brkts-popup-header-opponent-left');
      const teamRight = matchBox.querySelector('.team-right, .match-filler-team-right, .brkts-popup-header-opponent-right');

      if (teamLeft && teamRight) {
        team1 = cleanTeamName(teamLeft);
        team2 = cleanTeamName(teamRight);

        const img1 = teamLeft.querySelector('img');
        const img2 = teamRight.querySelector('img');
        if (img1) team1Logo = img1.getAttribute('src') || '';
        if (img2) team2Logo = img2.getAttribute('src') || '';
      } else {
        const teamTemplates = matchBox.querySelectorAll('.team-template-team-standard, .block-team');
        if (teamTemplates.length >= 2) {
          team1 = cleanTeamName(teamTemplates[0]);
          team2 = cleanTeamName(teamTemplates[1]);

          const img1 = teamTemplates[0].querySelector('img');
          const img2 = teamTemplates[1].querySelector('img');
          if (img1) team1Logo = img1.getAttribute('src') || '';
          if (img2) team2Logo = img2.getAttribute('src') || '';
        }
      }

      if (team1Logo && team1Logo.startsWith('/')) team1Logo = 'https://liquipedia.net' + team1Logo;
      if (team2Logo && team2Logo.startsWith('/')) team2Logo = 'https://liquipedia.net' + team2Logo;

      if (team1 !== 'TBD' || team2 !== 'TBD') {
        matchesRaw.push({
          team1,
          team1_logo: team1Logo,
          team2,
          team2_logo: team2Logo
        });
      }
    });

    const seenKeys = new Set();
    const uniqueMatches = [];

    matchesRaw.forEach(m => {
      const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = `${normalize(m.team1)}_vs_${normalize(m.team2)}`;

      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueMatches.push(m);
      }
    });

    if (uniqueMatches.length === 0) return null;

    return {
      start_time: startTime,
      matches: uniqueMatches
    };
  } catch (e) {
    console.warn('No se pudieron extraer las próximas partidas:', e.message);
    return null;
  }
}

async function main() {
  console.log('Obteniendo datos de Liquipedia...');
  const htmlRaw = await fetchLiquipediaHTML();

  if (!htmlRaw) {
    console.error('❌ No se pudo obtener el contenido HTML.');
    process.exit(1);
  }

  const dom = new JSDOM(htmlRaw);
  const doc = dom.window.document;

  const nextMatch = parseNextMatches(doc);

  const table = doc.querySelector('div[data-analytics-name="Swiss standings table"] table') ||
                doc.querySelector('.standings-swiss table');

  if (!table) {
    console.log('ℹ️ La tabla Swiss Standings aún no ha sido publicada en Liquipedia.');
    return;
  }

  const rows = Array.from(table.querySelectorAll('tr.table2__row--body')).filter(row => {
    if (row.classList.contains('table2__row--head') || row.querySelector('th')) return false;
    const pos = row.querySelector('.label--placement')?.textContent.trim() || row.cells[0]?.textContent.trim();
    const name = row.querySelector('.block-team .name.hidden-xs')?.textContent.trim() ||
                 row.querySelector('.block-team a')?.textContent.trim() ||
                 row.cells[1]?.textContent.trim();
    return pos && name && pos !== '#' && name.toLowerCase() !== 'participant';
  });

  const teams = rows.map(row => {
    const pos = row.querySelector('.label--placement')?.textContent.trim() || row.cells[0]?.textContent.trim();
    const name = row.querySelector('.block-team .name.hidden-xs')?.textContent.trim() ||
                 row.querySelector('.block-team a')?.textContent.trim() ||
                 row.cells[1]?.textContent.trim();

    const matches = row.cells[2]?.textContent.trim() || '-';
    const games = row.cells[3]?.textContent.trim() || '-';

    const logoImg = row.querySelector('.block-team img');
    let logo = logoImg ? logoImg.getAttribute('src') || '' : '';
    if (logo.startsWith('/')) logo = 'https://liquipedia.net' + logo;

    let status = 'active';
    const matchParts = matches.split('-').map(s => parseInt(s.trim()));
    if (matchParts.length === 2 && !isNaN(matchParts[0]) && !isNaN(matchParts[1])) {
      if (matchParts[0] >= 3) status = 'qualified';
      else if (matchParts[1] >= 3) status = 'eliminated';
    }

    const rounds = [
      parseRoundCell(row.cells[4]),
      parseRoundCell(row.cells[5]),
      parseRoundCell(row.cells[6]),
      parseRoundCell(row.cells[7]),
      parseRoundCell(row.cells[8])
    ];

    return { pos, name, logo, matches, games, status, rounds };
  });

  const outputData = {
    updated_at: new Date().toISOString(),
    next_match: nextMatch,
    teams
  };

  fs.writeFileSync('standings.json', JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`✅ standings.json actualizado con éxito (${teams.length} equipos procesados).`);
}

main();
