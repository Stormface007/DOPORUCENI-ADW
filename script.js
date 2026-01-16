const API_URL = 'https://script.google.com/macros/s/AKfycbxPdGIduQhxL3ZVBh85jo7T8-fFb0botFxE8VesqRx3vc70jKAlgpQy0g3rxEOGdhq1/exec';

let allRows = [];

// ========== Načtení a příprava dat ==========

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

// ========== Pomocné funkce ==========

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

// Tabulka zásobních dávek (t/ha produktu) z listu „vapno objemy“
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
    5_55:  { nemecko: 3.0, prodA: 2.3, prodB: 2.0, interval: 3 },
    55_60: { nemecko: 2.5, prodA: 1.9, prodB: 1.6, interval: 4 },
    60_65: { nemecko: 2.0, prodA: 1.5, prodB: 1.2, interval: 4 },
    nad65: { nemecko: 0.0, prodA: 0.0, prodB: 0.0, interval: 0 }
  },
  tezka: {
    do5:   { nemecko: 5.0, prodA: 4.0, prodB: 3.5, interval: 5 },
    5_55:  { nemecko: 4.0, prodA: 3.1, prodB: 2.7, interval: 5 },
    55_60: { nemecko: 3.0, prodA: 2.3, prodB: 2.0, interval: 5 },
    60_65: { nemecko: 2.5, prodA: 1.9, prodB: 1.6, interval: 6 },
    nad65: { nemecko: 0.0, prodA: 0.0, prodB: 0.0, interval: 0 }
  }
};

// Nasycení – hrubé cíle (literatura Ca 40–80 %, Mg 10–40 %, K 1–5 %) [web:119][web:177]
function vyhodnotNasyceni(typ, satCa, satMg, satK) {
  const optCaMin = 70;
  const optCaSilny = 55;

  let deficitCa = false;
  let silnyDeficitCa = false;

  if (!isNaN(satCa)) {
    if (satCa < optCaMin) deficitCa = true;
    if (satCa < optCaSilny) silnyDeficitCa = true;
  }

  // Mg a K jen pro rozhodnutí o produktu
  const mgMin = 10;
  const kMax = 5;

  const deficitMg = !isNaN(satMg) && satMg < mgMin;
  const vysokeK = !isNaN(satK) && satK > kMax;

  return { deficitCa, silnyDeficitCa, deficitMg, vysokeK };
}

// ========== Bodová logika vápnění ==========

function vyhodnotVapneniBod(bod) {
  const pH  = Number(bod['PH']);
  const kvk = Number(bod['KVK']);
  const mg  = Number(bod['MG']); // mg v půdě pro volbu produktu

  if (isNaN(pH) || isNaN(kvk)) {
    return {
      vapnit: false,
      caco3_t_ha: null,
      interval_text: 'Chybí pH nebo KVK',
      produktKod: null,
      davka_t_ha: null,
      mg_dodano: null,
      duvod: 'Chybí pH nebo KVK, nelze spočítat doporučení.'
    };
  }

  // 1) pH > 6.5 → nevápnit (stejně jako v Excelu – Vápnit? = false) [code_file:17]
  if (pH > 6.5) {
    return {
      vapnit: false,
      caco3_t_ha: null,
      interval_text: 'Bez vápnění – pH > 6,5',
      produktKod: null,
      davka_t_ha: 0,
      mg_dodano: 0,
      duvod: `pH = ${pH.toFixed(1)} > 6,5, zásobní vápnění se nedoporučuje.`
    };
  }

  // 2) typ půdy + pH třída → CaCO3 dávka + interval [code_file:16]
  const typPudy = urciTypPudy(kvk);      // Lehká / Střední / Těžká
  const phTrida = urciPhTridu(pH);

  const radek = nemeckaTabulka[typPudy] && nemeckaTabulka[typPudy][phTrida];

  if (!radek || !radek.caco3) {
    return {
      vapnit: false,
      caco3_t_ha: null,
      interval_text: 'Tabulka nemá doporučení',
      produktKod: null,
      davka_t_ha: 0,
      mg_dodano: 0,
      duvod: `Pro kombinaci ${typPudy}, pH třída ${phTrida} není v tabulce CaCO₃ dávka.`
    };
  }

  const caco3 = radek.caco3;          // t/ha CaCO3
  const intervalText = radek.interval;

  // 3) spočítat Ca_target (kg Ca/ha) z CaCO3 dávky [code_file:14]
  const Ca_target = caco3 * 360;      // 360 kg Ca/t referenčně

  // 4) vybrat produkt podle Mg v půdě [code_file:17]
  const prodKod = vyberProduktPodleMg(mg);
  const prod = produkty[prodKod];

  // 5) dávka produktu (t/ha) a Mg dodáno (kg/ha) [code_file:14]
  const davka = Ca_target / prod.Ca;
  const mgDodano = davka * prod.Mg;

  return {
    vapnit: true,
    caco3_t_ha: caco3,
    interval_text: intervalText,
    produktKod: prodKod,                     // 'A' / 'B' / 'C' / 'D'
    davka_t_ha: Number(davka.toFixed(2)),    // stejně jako v CSV [code_file:16]
    mg_dodano: Number(mgDodano.toFixed(1)),
    duvod:
      `Typ půdy ${typPudy}, pH ${pH.toFixed(1)} (třída ${phTrida}). ` +
      `Německé doporučení: ${caco3.toFixed(1)} t/ha CaCO₃ ` +
      `(${intervalText}). ` +
      `Přepočteno přes Ca ekvivalent na produkt ${prodKod}: ` +
      `${davka.toFixed(2)} t/ha, Mg dodáno cca ${mgDodano.toFixed(1)} kg/ha.`
  };
}


function vyhodnotVapneniPole(nazevPole) {
  const bodyPole = allRows.filter(r => r['Název'] === nazevPole);
  if (!bodyPole.length) {
    return '<p>Pro pole "' + nazevPole + '" nebyly nalezeny žádné body.</p>';
  }

  const vysledkyBodu = bodyPole.map(bod => {
    const res = vyhodnotVapneniBod(bod);
    return { bod, res };
  });

  // Hlasy pro produkt podle Mg – jen A/B/C/D, ale pole chceme jedním produktem
  const hlasy = { A: 0, B: 0, C: 0, D: 0 };
  vysledkyBodu.forEach(({ res }) => {
    if (res.vapnit && res.produktKod) {
      hlasy[res.produktKod] = (hlasy[res.produktKod] || 0) + 1;
    }
  });

  // Vyber produkt s nejvíce hlasy
  let vybranyKod = null;
  let maxHlasy = 0;
  Object.entries(hlasy).forEach(([k, v]) => {
    if (v > maxHlasy) {
      maxHlasy = v;
      vybranyKod = k;
    }
  });

  const produktNazev = vybranyKod
    ? `Produkt ${vybranyKod}`
    : 'Žádný produkt (pole se nyní nevápní)';

  // Přepočet průměrné dávky pro vybraný produkt
  let soucetD = 0;
  let pocet = 0;

  vysledkyBodu.forEach(({ res }) => {
    if (res.vapnit && res.produktKod === vybranyKod && res.davka_t_ha) {
      soucetD += res.davka_t_ha;
      pocet += 1;
    }
  });

  const prumerDavka = pocet ? (soucetD / pocet) : 0;

  const shrnutiPole = `
    <p><strong>Produkt pro celé pole:</strong> ${produktNazev}</p>
    ${pocet
      ? `<p>Průměrná zásobní dávka (jen body s vápněním a tímto produktem) ≈ ${prumerDavka.toFixed(2)} t/ha. 
         Konkrétní body jsou níže.</p>`
      : `<p>Pro žádný bod nevychází potřeba vápnit tímto produktem.</p>`}
  `;

  const items = vysledkyBodu.map(({ bod, res }) => {
    const cislo = bod['Číslo bodu'];
    const davkaText = res.vapnit
      ? `${res.davka_t_ha?.toFixed(2) || '0.00'} t/ha`
      : '0 t/ha (nevápnit)';

    const prodText = res.produktKod ? `Produkt ${res.produktKod}` : '---';

    return `
      <li>
        <strong>Bod ${cislo}</strong>: dávka ${davkaText}, produkt: ${prodText}, interval: ${res.interval_text || '---'}.<br>
        ${res.duvod}
      </li>
    `;
  });

  return shrnutiPole + `<ul>${items.join('')}</ul>`;
}


// ========== MODAL UI ==========

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

// ========== start ==========

document.addEventListener('DOMContentLoaded', () => {
  initModal();
});

// ========== Pomocné funkce ==========

function urciTypPudy(kvk) {
  if (kvk < 120) return 'Lehká';
  if (kvk <= 200) return 'Střední';
  return 'Těžká';
}

function urciPhTridu(pH) {
  if (pH < 5.0) return '<5,0';
  if (pH <= 5.5) return '5,0–5,5';
  if (pH <= 6.0) return '5,6–6,0';
  return '>6,0';
}

// Německé pevné dávky CaCO3 (t/ha) + intervaly – přímo z tabulky [code_file:16][file:2]
const nemeckaTabulka = {
  'Lehká': {
    '<5,0':   { caco3: 2.0, interval: 'každé 2 roky' },
    '5,0–5,5': { caco3: 1.5, interval: 'každé 2–3 roky' },
    '>5,5':   { caco3: 1.0, interval: 'každé 3 roky' }
  },
  'Střední': {
    '<5,0':   { caco3: 3.0, interval: 'každé 3 roky' },
    '5,0–5,5': { caco3: 2.5, interval: 'každé 3–4 roky' },
    '5,6–6,0': { caco3: 2.0, interval: 'každé 4 roky' },
    '>6,0':   { caco3: 1.5, interval: 'každé 4 roky' }
  },
  'Těžká': {
    '<5,0':   { caco3: 4.0, interval: 'každých 4–5 let' },
    '5,0–5,5': { caco3: 3.0, interval: 'každých 5 let' },
    '5,6–6,0': { caco3: 2.5, interval: 'každých 5–6 let' },
    '>6,0':   { caco3: 2.0, interval: 'každých 6 let' }
  }
};

// Obsah Ca a Mg v produktech (kg/t) – stejné jako v excelu [code_file:14]
const produkty = {
  A: { Ca: 360, Mg: 6 },
  B: { Ca: 256, Mg: 60 },
  C: { Ca: 200, Mg: 109 },
  D: { Ca: 220, Mg: 127 }
};

// Výběr produktu podle Mg v půdě – shodně s logikou v Excelu [code_file:17]
function vyberProduktPodleMg(mgSoil) {
  if (mgSoil < 50) return 'C';       // velmi nízký Mg → silně Mg produkt
  if (mgSoil <= 120) return 'B';     // střední Mg → balancovaný
  return 'A';                        // vysoký Mg → Ca bez Mg
}


