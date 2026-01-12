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

// === Tabulka „vapno objemy“ (t/ha produktu) ===
const vapnoTabulka = {
  lehka: {
    do5:   { nemecko: 3.0, prodA: 2.0, prodB: 1.7, interval: 2 },
    5_55:  { nemecko: 2.0, prodA: 1.3, prodB: 1.1, interval: 3 },
    55_60: { nemecko: 0.0, prodA: 0.0, prodB: 0.0, interval: 0 },
    60_65: { nemecko: 0.0, prodA: 0.0, prodB: 0.0, interval: 0 },
    nad65: { nemecko: 0.0, prodA: 0.0, prodB: 0.0, interval: 0 }
  },
  stredni: {
    do5:   { nemecko: 4.0, prodA: 3.0, prodB: 2.5, interval: 3 },
    5_55:  { nemecko: 3.0, prodA: 2.3, prodB: 2.0, interval: 3 }, // 3–4 roky
    55_60: { nemecko: 2.5, prodA: 1.9, prodB: 1.6, interval: 4 },
    60_65: { nemecko: 2.0, prodA: 1.5, prodB: 1.2, interval: 4 },
    nad65: { nemecko: 0.0, prodA: 0.0, prodB: 0.0, interval: 0 }
  },
  tezka: {
    do5:   { nemecko: 5.0, prodA: 4.0, prodB: 3.5, interval: 5 }, // 4–5 let
    5_55:  { nemecko: 4.0, prodA: 3.1, prodB: 2.7, interval: 5 }, // 5–6 let
    55_60: { nemecko: 3.0, prodA: 2.3, prodB: 2.0, interval: 5 },
    60_65: { nemecko: 2.5, prodA: 1.9, prodB: 1.6, interval: 6 },
    nad65: { nemecko: 0.0, prodA: 0.0, prodB: 0.0, interval: 0 }
  }
};

// Mg2+ < 0 = deficit → Produkt A (Ca + Mg), jinak Produkt B (téměř čisté Ca)
function vyberProdukt(mgPlus) {
  if (mgPlus < 0) return 'Produkt A (Ca + Mg)';
  return 'Produkt B (převážně Ca)';
}

// === Nasycení – cílové hodnoty ===
// obecně Ca 70–80 %, Mg 10–20 %, K 2–5 % [web:117][web:124]
function vyhodnotNasyceni(typ, satCa, satMg, satK) {
  const optCaMin = 70;
  const optCaMax = 80;

  let deficitCa = false;
  let silnyDeficitCa = false;

  if (!isNaN(satCa)) {
    if (satCa < optCaMin - 5) deficitCa = true;     // < 65 %
    if (satCa < optCaMin - 15) silnyDeficitCa = true; // < 55 %
  }

  return { deficitCa, silnyDeficitCa };
}

// === Jádro: vyhodnocení jednoho bodu ===
function vyhodnotVapneniBod(bod) {
  const pH     = Number(bod['PH']);
  const kvk    = Number(bod['KVK']);
  const ca     = Number(bod['CA']);
  const mg     = Number(bod['MG']);
  const org    = Number(bod['ORG_HMOTA']);
  const caPlus = Number(bod['Ca2+']);
  const mgPlus = Number(bod['Mg2+']);
  const kPlus  = Number(bod['K+']);

  const satCa  = Number(bod['nasycení Ca']);
  const satMg  = Number(bod['nasycení Mg']);
  const satK   = Number(bod['nasycení K']);

  if (isNaN(pH) || isNaN(kvk)) {
    return {
      vapnit: false,
      duvod: 'Chybí pH nebo KVK, nelze automaticky vyhodnotit vápnění.'
    };
  }

  const typ = urciTypPudy(kvk);
  const rada = urciIntervalovyRadek(pH);
  const zapis = vapnoTabulka[typ][rada];

  // 1) Bezpečnostní brzda – vysoké pH → nevápnit
  if (pH >= 7.0) {
    return {
      vapnit: false,
      duvod:
        `pH = ${pH.toFixed(1)} (vyšší/vysoké), typ půdy ${typ}. ` +
        `Ca ≈ ${ca.toFixed(0)} ppm, nasycení Ca ≈ ${isNaN(satCa) ? 'n/a' : satCa.toFixed(1)} %. ` +
        `Zásobní vápnění se při takto vysokém pH nedoporučuje kvůli riziku blokace P; řešit spíš plodinově a strukturou půdy.`
    };
  }

  // 2) Nasycení Ca
  const { deficitCa, silnyDeficitCa } = vyhodnotNasyceni(typ, satCa, satMg, satK);

  // 3) Silný deficit Ca z nasycení nebo z Ca2+ bodů
  const silnyDeficitCa2 = !isNaN(caPlus) && caPlus <= -200;
  const silnyDeficit = silnyDeficitCa || silnyDeficitCa2;

  // 4) Má tabulka nějakou dávku?
  const tabulkaMaDavku = !!(zapis && (zapis.prodA > 0 || zapis.prodB > 0));

  // Pokud není dávka a není ani deficit Ca → nevápnit
  if (!tabulkaMaDavku && !deficitCa && !silnyDeficit) {
    return {
      vapnit: false,
      duvod:
        `pH = ${pH.toFixed(1)}, typ půdy ${typ}. Tabulka „vapno objemy“ nedává zásobní dávku a ` +
        `nasycení Ca ≈ ${isNaN(satCa) ? 'n/a' : satCa.toFixed(1)} % je kolem optima, Ca2+ = ${isNaN(caPlus) ? 'n/a' : caPlus.toFixed(0)}. ` +
        `Zatím nevápnit, sledovat vývoj pH a organiky (ORG = ${isNaN(org) ? 'n/a' : org.toFixed(1)} %).`
    };
  }

  // 5) Výběr produktu
  const produktNazev = vyberProdukt(mgPlus);

  let davkaZTabulky = 0;
  if (zapis) {
    davkaZTabulky = mgPlus < 0 ? zapis.prodA : zapis.prodB;
  }

  let davka = davkaZTabulky;

  // Pokud je silný deficit (nasycení nebo Ca2+), dávka nesmí být nula → použij min. německé doporučení
  if (silnyDeficit && (!zapis || davka <= 0)) {
    davka = zapis && zapis.nemecko > 0 ? zapis.nemecko : 3.0;
  }

  // U silného deficitu lehce přitvrdit, ale držet se v rozmezí 0.5–5 t/ha
  if (silnyDeficit) {
    davka *= 1.2;
  }

  if (davka < 0.5) davka = 0.5;
  if (davka > 5.0) davka = 5.0;

  const interval = (zapis && zapis.interval) || 4;

  return {
    vapnit: true,
    produkt: produktNazev,
    davka_t_ha: Number(davka.toFixed(1)),
    interval_let: interval,
    duvod:
      `pH = ${pH.toFixed(1)}, typ půdy ${typ}. ` +
      `KVK ≈ ${kvk.toFixed(1)}, nasycení Ca ≈ ${isNaN(satCa) ? 'n/a' : satCa.toFixed(1)} %, ` +
      `Mg ≈ ${mg.toFixed(0)} ppm (nasycení Mg ≈ ${isNaN(satMg) ? 'n/a' : satMg.toFixed(1)} %), ` +
      `K+ = ${isNaN(kPlus) ? 'n/a' : kPlus.toFixed(0)} (nasycení K ≈ ${isNaN(satK) ? 'n/a' : satK.toFixed(1)} %). ` +
      (silnyDeficit
        ? `Ca je v deficitu (nasycení/Ca2+), proto zásobní dávka ${davka.toFixed(1)} t/ha produktu (${produktNazev}), ` +
          `opakovat zhruba každých ${interval} let. `
        : `Dávka ${davka.toFixed(1)} t/ha (${produktNazev}) vychází z tabulky „vapno objemy“ při daném pH a KVK ` +
          `s intervalem asi ${interval} let. `) +
      `Jde o zásobní vápnění, ne o jednorázové dorovnání na „ideální“ procenta.`
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
