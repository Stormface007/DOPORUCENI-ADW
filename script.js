const API_URL = 'https://script.google.com/macros/s/AKfycbxPdGIduQhxL3ZVBh85jo7T8-fFb0botFxE8VesqRx3vc70jKAlgpQy0g3rxEOGdhq1/exec';

let allRows = [];

// === Načtení dat z listu DATA ===
async function loadAnalyses() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Chyba při načítání dat: ' + res.status);
  return await res.json();
}

function getUniqueFields(rows) {
  const map = new Map();
  rows.forEach(row => {
    const key = row['Název'];
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        key,
        čtverec: row['Čtverec'],
        zkod: row['Zkod'],
        název: row['Název']
      });
    }
  });
  return Array.from(map.values());
}

function fillFieldSelect(fields) {
  const select = document.getElementById('fieldSelect');
  select.innerHTML = '<option value="">-- vyber pole --</option>';

  fields.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.název;
    opt.textContent = f.název;
    select.appendChild(opt);
  });
}

// === Pomocné funkce ===
function urciTypPudy(kvk) {
  if (kvk < 120) return 'lehka';
  if (kvk <= 200) return 'stredni';
  return 'tezka';
}

function urciIntervalovyRadek(pH) {
  if (pH <= 5.0) return 'do5';
  if (pH > 5.0 && pH <= 5.5) return '5_55';
  if (pH > 5.5 && pH <= 6.0) return '55_60';
  if (pH > 6.0 && pH <= 6.5) return '60_65';
  return 'nad65';
}

// === Tabulka „vapno objemy“ převedená do JS ===
// hodnoty jsou v t/ha produktu, poslední sloupec je interval (roky)
const vapnoTabulka = {
  lehka: {
    do5:   { nemecko: 3.0, prodA: 2.0, prodB: 1.7, interval: 2 },
    5_55:  { nemecko: 2.0, prodA: 1.3, prodB: 1.1, interval: 3 },
    55_60: { nemecko: 0,   prodA: 0,   prodB: 0,   interval: 0 }, // není v tabulce – nevápnit
    60_65: { nemecko: 0,   prodA: 0,   prodB: 0,   interval: 0 },
    nad65: { nemecko: 0,   prodA: 0,   prodB: 0,   interval: 0 }
  },
  stredni: {
    do5:   { nemecko: 4.0, prodA: 3.0, prodB: 2.5, interval: 3 },
    5_55:  { nemecko: 3.0, prodA: 2.3, prodB: 2.0, interval: 3 }, // 3–4 roky → vezmeme 3
    55_60: { nemecko: 2.5, prodA: 1.9, prodB: 1.6, interval: 4 },
    60_65: { nemecko: 2.0, prodA: 1.5, prodB: 1.2, interval: 4 },
    nad65: { nemecko: 0,   prodA: 0,   prodB: 0,   interval: 0 }
  },
  tezka: {
    do5:   { nemecko: 5.0, prodA: 4.0, prodB: 3.5, interval: 5 }, // 4–5 let → 5
    5_55:  { nemecko: 4.0, prodA: 3.1, prodB: 2.7, interval: 5 }, // 5–6 let → 5
    55_60: { nemecko: 3.0, prodA: 2.3, prodB: 2.0, interval: 5 },
    60_65: { nemecko: 2.5, prodA: 1.9, prodB: 1.6, interval: 6 },
    nad65: { nemecko: 0,   prodA: 0,   prodB: 0,   interval: 0 }
  }
};

// === Výběr produktu podle Mg ===
// Mg2+ < 0 = deficit → Produkt A (Ca + Mg), jinak Produkt B (téměř čisté Ca)
function vyberProdukt(mgPlus) {
  if (mgPlus < 0) return 'Produkt A (Ca + Mg)';
  return 'Produkt B (Ca převládá)';
}

// === Jádro: vyhodnocení jednoho bodu ===
function vyhodnotVapneniBod(bod) {
  const pH   = Number(bod['PH']);
  const kvk  = Number(bod['KVK']);
  const ca   = Number(bod['CA']);
  const mg   = Number(bod['MG']);
  const org  = Number(bod['ORG_HMOTA']);
  const caPlus = Number(bod['Ca2+']);
  const mgPlus = Number(bod['Mg2+']);
  const kPlus  = Number(bod['K+']);

  if (isNaN(pH) || isNaN(kvk)) {
    return {
      vapnit: false,
      duvod: 'Chybí pH nebo KVK, nelze automaticky doporučit vápnění.'
    };
  }

  const typ = urciTypPudy(kvk);
  const rada = urciIntervalovyRadek(pH);
  const zapis = vapnoTabulka[typ][rada];

  // Bezpečnostní brzda – vysoké pH → nevápnit
  if (pH >= 7.0) {
    return {
      vapnit: false,
      duvod:
        `pH = ${pH.toFixed(1)} (vyšší/vysoké), typ půdy ${typ}. ` +
        `Ca ≈ ${ca.toFixed(0)} ppm, Ca2+ = ${caPlus.toFixed(0)}. ` +
        `Zásobní vápnění se v této reakci neprovádí; fosfor jen plodinově, bez zásobních dávek kvůli blokacím.`
    };
  }

  // Pokud v tabulce není dávka (0), tak nevápnit – jen komentář
  if (!zapis || zapis.prodA === 0 && zapis.prodB === 0) {
    return {
      vapnit: false,
      duvod:
        `pH = ${pH.toFixed(1)}, typ půdy ${typ}. Pro tuto kombinaci pH a KVK není v tabulce zásobní dávka; ` +
        `Ca2+ = ${caPlus.toFixed(0)}, Mg2+ = ${mgPlus.toFixed(0)}, ORG = ${org.toFixed(1)} %. ` +
        `Strategie: zatím nevápnit, sledovat vývoj pH a plodinové požadavky.`
    };
  }

  // Rozhodnutí o produktu
  const produktNazev = vyberProdukt(mgPlus);
  const davka = (mgPlus < 0) ? zapis.prodA : zapis.prodB;
  const interval = zapis.interval;

  return {
    vapnit: true,
    produkt: produktNazev,
    davka_t_ha: davka,
    interval_let: interval,
    duvod:
      `pH = ${pH.toFixed(1)}, typ půdy ${typ}. Podle tabulky „vapno objemy“ vychází zásobní dávka ` +
      `${davka.toFixed(1)} t/ha (produkt: ${produktNazev}), opakovat přibližně každých ${interval} let. ` +
      `Ca ≈ ${ca.toFixed(0)} ppm (Ca2+ = ${caPlus.toFixed(0)}), Mg ≈ ${mg.toFixed(0)} ppm (Mg2+ = ${mgPlus.toFixed(0)}), ` +
      `K+ = ${kPlus.toFixed(0)}, ORG = ${org.toFixed(1)} %. Dávka je myšlená jako zásobní na více let, ne k okamžitému dorovnání cílových procent.`
  };
}

// === Vyhodnocení pro celé pole ===
function vyhodnotVapneniPole(nazevPole) {
  const bodyPole = allRows.filter(r => r['Název'] === nazevPole);
  if (!bodyPole.length) {
    return '<p>Pro pole "' + nazevPole + '" nebyly nalezeny žádné body.</p>';
  }

  const items = bodyPole.map(bod => {
    const cislo = bod['Číslo bodu'];
    const res = vyhodnotVapneniBod(bod);

    if (res.vapnit) {
      return `<li><strong>Bod ${cislo}</strong>: VÁPNIT – produkt: ${res.produkt}, ` +
             `dávka: ${res.davka_t_ha.toFixed(1)} t/ha, interval: cca ${res.interval_let} let.<br>` +
             `Důvod: ${res.duvod}</li>`;
    } else {
      return `<li><strong>Bod ${cislo}</strong>: NEVÁPNIT – ${res.duvod}</li>`;
    }
  });

  return `<ul>${items.join('')}</ul>`;
}

// === MODAL – otevření / zavření ===
function initModal() {
  const modal = document.getElementById('vapneniModal');
  const openBtn = document.getElementById('openModalBtn');
  const closeBtn = document.getElementById('closeModalBtn');
  const evaluateBtn = document.getElementById('evaluateBtn');

  openBtn.addEventListener('click', async () => {
    try {
      if (!allRows.length) {
        allRows = await loadAnalyses();
        const fields = getUniqueFields(allRows);
        fillFieldSelect(fields);
      }
      modal.style.display = 'block';
    } catch (e) {
      alert('Chyba při načítání dat: ' + e.message);
    }
  });

  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  evaluateBtn.addEventListener('click', () => {
    const select = document.getElementById('fieldSelect');
    const nazevPole = select.value;
    const resultsDiv = document.getElementById('resultsContainer');

    if (!nazevPole) {
      resultsDiv.textContent = 'Nejprve vyber pole.';
      return;
    }

    const html = vyhodnotVapneniPole(nazevPole);
    resultsDiv.innerHTML = html;
  });
}

// === inicializace po načtení stránky ===
document.addEventListener('DOMContentLoaded', () => {
  initModal();
});
