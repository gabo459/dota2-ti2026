const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

// Liquipedia exige un User-Agent identificable con datos de contacto
const USER_AGENT = 'TI2026Dashboard/1.0 (https://github.com/tu-usuario/dota2-ti2026; contacto@tu-email.com)';
const API_URL = 'https://liquipedia.net/dota2/api.php?action=parse&page=The_International/2026&format=json';

const FALLBACK_BRACKET_HTML = `<div class="brkts-bracket"><div class="status-text">Cuadro de eliminatorias no disponible.</div></div>`;

async function fetchLiquipediaHTML(retries = 3, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(API_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'gzip, deflate'
        }
      });

      if (response.status === 429) {
        console.warn(`⚠️ Error 429 (Rate Limit). Reintentando en ${delayMs / 1000}s... (${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponencial
        continue;
      }

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      if (data && data.parse && data.parse.text) {
        return data.parse.text['*']; // HTML renderizado desde la API
      }

      throw new Error('Estructura de respuesta de API invalida');
    } catch (e) {
      if (i === retries - 1) {
        console.error('❌ No se pudo conectar con Liquipedia tras varios intentos:', e);
        return null;
      }
    }
  }
}

function parseRoundCell(cell) {
  if (!cell) return '-';
  
  const scoreSpan = cell.querySelector('.match-score') || cell.querySelector('b');
  const score = scoreSpan ? scoreSpan.textContent.trim() : '';

  const oppImg = cell.querySelector('img');
  let opponentLogo = oppImg ? oppImg.getAttribute('src') || '' : '';
  if (opponentLogo.startsWith('/')) opponentLogo = 'https://liquipedia.net' + opponentLogo;

  const oppLink = cell.querySelector('a[title]');
  const opponent = oppLink ? oppLink.getAttribute('title').trim() : cell.textContent.replace(score, '').trim();

  let result = 'none';
  if (cell.classList.contains('bg-win') || cell.style.backgroundColor?.includes('green') || score.startsWith('2-') || score.startsWith('3-')) {
    result = 'win';
  } else if (cell.classList.contains('bg-loss') || cell.style.backgroundColor?.includes('red') || score.endsWith('-2') || score.endsWith('-3')) {
    result = 'loss';
  }

  if (!score && !opponent) return '-';

  return { score, opponent, opponentLogo, result };
}

function parseNextMatches(doc) {
  const timerSpan = doc.querySelector('.timer-object');
  if (!timerSpan) return null;

  const startTime = timerSpan.getAttribute('data-timestamp') 
    ? new Date(parseInt(timerSpan.getAttribute('data-timestamp')) * 1000).toISOString()
    : null;

  const matchBox = timerSpan.closest('.match-filler') || timerSpan.closest('tr');
  if (!matchBox) return startTime ? { start_time: startTime, matches: [] } : null;

  const team1El = matchBox.querySelector('.team-left a') || matchBox.querySelector('.team-left');
  const team2El = matchBox.querySelector('.team-right a') || matchBox.querySelector('.team-right');

  const team1LogoImg = matchBox.querySelector('.team-left img');
  const team2LogoImg = matchBox.querySelector('.team-right img');

  let team1Logo = team1LogoImg ? team1LogoImg.getAttribute('src') || '' : '';
  let team2Logo = team2LogoImg ? team2LogoImg.getAttribute('src') || '' : '';

  if (team1Logo.startsWith('/')) team1Logo = 'https://liquipedia.net' + team1Logo;
  if (team2Logo.startsWith('/')) team2Logo = 'https://liquipedia.net' + team2Logo;

  return {
    start_time: startTime,
    matches: [
      {
        team1: team1El ? team1El.textContent.trim() : 'TBD',
        team1_logo: team1Logo,
        team2: team2El ? team2El.textContent.trim() : 'TBD',
        team2_logo: team2Logo
      }
    ]
  };
}

async function main() {
  console.log('Obteniendo datos de Liquipedia vía API...');
  const htmlRaw = await fetchLiquipediaHTML();

  if (!htmlRaw) {
    console.error('❌ No se pudo obtener el contenido HTML de la API.');
    process.exit(1);
  }

  const dom = new JSDOM(htmlRaw);
  const doc = dom.window.document;

  const nextMatch = parseNextMatches(doc);

  // 1. Extraer el Bracket de Playoffs (Main Event)
  let bracketEl = null;

  // Filtrar por título/sección del Main Event para ignorar los brackets de desempate
  const mainEventHeading = doc.querySelector('#Main_Event, #Playoffs, #Bracket, #Main_Stage');
  if (mainEventHeading) {
    const parent = mainEventHeading.closest('.mw-parser-output') || mainEventHeading.parentElement;
    if (parent) {
      const allBrackets = parent.querySelectorAll('.brkts-bracket');
      if (allBrackets.length > 0) {
        bracketEl = allBrackets[allBrackets.length - 1];
      }
    }
  }

  // Respaldo: Tomar el último bracket del documento
  if (!bracketEl) {
    const brackets = doc.querySelectorAll('.brkts-bracket');
    if (brackets.length > 0) {
      bracketEl = brackets[brackets.length - 1];
    }
  }

  let bracketHtml = bracketEl ? bracketEl.outerHTML : FALLBACK_BRACKET_HTML;

  // Normalizar rutas relativas de imágenes dentro del HTML del bracket
  bracketHtml = bracketHtml.replace(/src="\/commons\//g, 'src="https://liquipedia.net/commons/');
  bracketHtml = bracketHtml.replace(/src="\/dota2\/commons\//g, 'src="https://liquipedia.net/dota2/commons/');

  // 2. Extraer Tabla Swiss Standings
  const table = doc.querySelector('div[data-analytics-name="Swiss standings table"] table') ||
                doc.querySelector('.standings-swiss table') ||
                doc.querySelector('table.wikitable');

  let teams = [];
  if (table) {
    const rows = Array.from(table.querySelectorAll('tr.table2__row--body, tr')).filter(row => {
      if (row.classList.contains('table2__row--head') || row.querySelector('th')) return false;
      const pos = row.querySelector('.label--placement')?.textContent.trim() || row.cells[0]?.textContent.trim();
      const name = row.querySelector('.block-team .name.hidden-xs')?.textContent.trim() ||
                   row.querySelector('.block-team a')?.textContent.trim() ||
                   row.cells[1]?.textContent.trim();
      return pos && name && pos !== '#' && name.toLowerCase() !== 'participant';
    });

    teams = rows.map(row => {
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
  }

  const outputData = {
    updated_at: new Date().toISOString(),
    next_match: nextMatch,
    bracket_html: bracketHtml,
    teams: teams
  };

  fs.writeFileSync('standings.json', JSON.stringify(outputData, null, 2), 'utf-8');
  console.log('✅ standings.json generado correctamente.');
}

main();
