const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const LIQUIPEDIA_URL = 'https://liquipedia.net/dota2/The_International/2026'; // Ajusta a tu URL objetivo

async function fetchLiquipediaHTML() {
  try {
    const response = await fetch(LIQUIPEDIA_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TI2026Dashboard/1.0',
        'Accept-Encoding': 'gzip, deflate'
      }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.text();
  } catch (e) {
    console.error('Error al obtener Liquipedia:', e);
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

  // 1. Extraer el Bracket de Playoffs (Main Event)
  let bracketEl = null;

  // Buscar el título del Main Event o Playoffs
  const mainEventHeading = doc.querySelector('#Main_Event, #Playoffs, #Bracket, #Main_Stage');
  if (mainEventHeading) {
    const parent = mainEventHeading.closest('.mw-parser-output') || mainEventHeading.parentElement;
    if (parent) {
      const allBrackets = parent.querySelectorAll('.brkts-bracket');
      // El cuadro del Main Event es el último elemento .brkts-bracket de esa sección
      if (allBrackets.length > 0) {
        bracketEl = allBrackets[allBrackets.length - 1];
      }
    }
  }

  // Respaldo: Si no lo encuentra por ID, tomar el último .brkts-bracket del documento
  if (!bracketEl) {
    const brackets = doc.querySelectorAll('.brkts-bracket');
    if (brackets.length > 0) {
      bracketEl = brackets[brackets.length - 1];
    }
  }

  let bracketHtml = bracketEl ? bracketEl.outerHTML : '<div class="status-text">Cuadro de playoffs no disponible.</div>';

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

      return { pos, name, logo, matches, games, status };
    });
  }

  const outputData = {
    updated_at: new Date().toISOString(),
    bracket_html: bracketHtml,
    teams: teams
  };

  fs.writeFileSync('standings.json', JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`✅ standings.json actualizado con el cuadro correcto del Main Event.`);
}

main();
