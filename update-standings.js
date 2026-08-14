const fs = require('fs');
const { JSDOM } = require('jsdom');

const LIQUIPEDIA_API_URL = 'https://liquipedia.net/dota2/api.php?action=parse&page=The_International/2026/Group_Stage&format=json';
const FALLBACK_URL = 'https://liquipedia.net/dota2/api.php?action=parse&page=The_International/2026&format=json';

async function fetchLiquipediaHTML() {
  const headers = {
    'User-Agent': 'Dota2HUD-Bot/1.0 (https://github.com/)'
  };

  try {
    let res = await fetch(LIQUIPEDIA_API_URL, { headers });
    let data = await res.json();
    let html = data?.parse?.text?.['*'];

    if (!html) {
      res = await fetch(FALLBACK_URL, { headers });
      data = await res.json();
      html = data?.parse?.text?.['*'];
    }

    return html || null;
  } catch (err) {
    console.error('Error al conectar con la API de Liquipedia:', err.message);
    return null;
  }
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
    return {
      opponent,
      opponentLogo,
      score,
      result
    };
  }

  return td.textContent.trim() || '-';
}

async function main() {
  console.log('Obteniendo HTML de Liquipedia...');
  const htmlRaw = await fetchLiquipediaHTML();

  if (!htmlRaw) {
    console.error('No se pudo obtener el contenido HTML.');
    process.exit(1);
  }

  const dom = new JSDOM(htmlRaw);
  const doc = dom.window.document;

  const table = doc.querySelector('div[data-analytics-name="Swiss standings table"] table') ||
                doc.querySelector('.standings-swiss table');

  if (!table) {
    console.log('No se encontró la tabla Swiss Standings aún.');
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

    return {
      pos,
      name,
      logo,
      matches,
      games,
      status,
      rounds
    };
  });

  const outputData = {
    updated_at: new Date().toISOString(),
    teams
  };

  fs.writeFileSync('standings.json', JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`✅ standings.json actualizado con éxito (${teams.length} equipos cargados).`);
}

main();
