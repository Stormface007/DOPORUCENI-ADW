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
  // 1) Načtení vstupů z analýzy
  const pH  = Number(bod['PH']);
  const kvk = Number(bod['KVK']);
  const mg  = Number(bod['MG']); // Mg v půdě (mg/kg) – pro volbu produktu

  // 2) Bez pH nebo KVK nelze doporučení spočítat
  if (isNaN(pH) || isNaN(kvk)) {
    return {
      vapnit: false,
      caco3_t_ha: null,
      interval_text: 'Chybí pH nebo KVK',
      produktKod: null,
      davka_t_ha: null,
      mg_dodano: null,
      typPudy: null,
      pHtxt: isNaN(pH) ? 'n/a' : pH.toFixed(1),
      duvod: 'Chybí pH nebo KVK, nelze spočítat doporučení.'
    };
  }

  // 3) pH > 6,5 → zásobní vápnění se nedoporučuje (shodně s Excelem)
  if (pH > 6.5) {
    const typPudy = urciTypPudy(kvk);  // Lehká / Střední / Těžká
    return {
      vapnit: false,
      caco3_t_ha: null,
      interval_text: 'Bez vápnění – pH > 6,5',
      produktKod: null,
      davka_t_ha: 0,
      mg_dodano: 0,
      typPudy,
      pHtxt: pH.toFixed(1),
      duvod: `pH = ${pH.toFixed(1)} je vyšší než 6,5, u typu půdy ${typPudy} se zásobní vápnění nedoporučuje.`
    };
  }

  // 4) Určení typu půdy (podle KVK) a pH třídy
  const typPudy = urciTypPudy(kvk);      // 'Lehká' / 'Střední' / 'Těžká'
  const phTrida = urciPhTridu(pH);       // '<5,0' / '5,0–5,5' / '5,6–6,0' / '>6,0'

  // 5) Vytažení německé dávky CaCO3 a intervalu z tabulky
  const radek = nemeckaTabulka[typPudy] && nemeckaTabulka[typPudy][phTrida];

  if (!radek || !radek.caco3) {
    return {
      vapnit: false,
      caco3_t_ha: null,
      interval_text: 'Tabulka nemá doporučení',
      produktKod: null,
      davka_t_ha: 0,
      mg_dodano: 0,
      typPudy,
      pHtxt: pH.toFixed(1),
      duvod: `Pro kombinaci typu půdy ${typPudy} a pH třídy ${phTrida} není v tabulce CaCO₃ dávka.`
    };
  }

  const caco3 = radek.caco3;          // t/ha CaCO3
  const intervalText = radek.interval;

  // 6) Přepočet CaCO3 → cílový přísun Ca (kg Ca/ha)
  // 1 t CaCO3 odpovídá 360 kg Ca
  const Ca_target = caco3 * 360;

  // 7) Volba produktu A/B/C/D podle Mg v půdě
  const prodKod = vyberProduktPodleMg(mg);  // 'A' / 'B' / 'C' / 'D'
  const prod = produkty[prodKod];          // např. { Ca: 360, Mg: 6 }

  // 8) Výpočet dávky produktu (t/ha) a dodaného Mg (kg/ha)
  const davka = Ca_target / prod.Ca;
  const mgDodano = davka * prod.Mg;

  // 9) Výstup – strukturované doporučení pro daný bod
  return {
    vapnit: true,
    caco3_t_ha: caco3,                          // referenční CaCO3 dávka (t/ha)
    interval_text: intervalText,               // text intervalu z německé tabulky
    produktKod: prodKod,                       // zvolený produkt A/B/C/D
    davka_t_ha: Number(davka.toFixed(2)),      // dávka produktu (t/ha)
    mg_dodano: Number(mgDodano.toFixed(1)),    // dodaný Mg (kg/ha)
    typPudy,                                   // Lehká / Střední / Těžká
    pHtxt: pH.toFixed(1),                      // pH jako text
    duvod:
      `Německé doporučení: ${caco3.toFixed(1)} t/ha CaCO₃ (${intervalText}). ` +
      `Přepočteno přes Ca ekvivalent na produkt ${prodKod}: ` +
      `${davka.toFixed(2)} t/ha, Mg dodáno cca ${mgDodano.toFixed(1)} kg/ha.`
  };
}

function popisMg(mg) {
  if (isNaN(mg)) return 'zásoba Mg neznámá';
  if (mg < 50) return 'velmi nízká zásoba Mg – hodí se produkt s více hořčíkem';
  if (mg <= 120) return 'střední zásoba Mg – volen vyvážený Ca + Mg';
  return 'dobrá zásoba Mg – stačí převážně Ca';
}

function formatujLidsky(bod, res) {
  const cislo = bod['Číslo bodu'];
  const mg = Number(bod['MG']);
  const mgText = popisMg(mg);

  if (!res.vapnit) {
    return (
      `Bod ${cislo}: Nevápnit. ` +
      `Typ půdy ${res.typPudy || ''}, pH ${res.pHtxt}. ` +
      `Půda je pro Ca v pořádku, zásobní vápnění nyní není potřeba.`
    );
  }

  return (
    `Bod ${cislo}: aplikovat ${res.davka_t_ha.toFixed(2)} t/ha produktu ${res.produktKod}, ` +
    `${res.interval_text}. ` +
    `Typ půdy ${res.typPudy}, pH ${res.pHtxt}, ${mgText}.`
  );
}
// Vrátí kód produktu (A/B/C/D) zvolený pro celé pole podle Mg v půdě
// ===== 1) Výběr produktu pro celé pole podle Mg v půdě =====

// Projde všechny body na poli, spočítá „hlasy“ pro A/B/C/D podle Mg
function vyberProduktProPole(bodyPole) {
  const hlasy = { A: 0, B: 0, C: 0, D: 0 };

  bodyPole.forEach(bod => {
    const mg = Number(bod['MG']);          // zásoba Mg v půdě (mg/kg)
    const kod = vyberProduktPodleMg(mg);   // A/B/C podle tvé funkce pro Mg
    if (kod) {
      hlasy[kod] = (hlasy[kod] || 0) + 1; // přičti jeden hlas pro daný produkt
    }
  });

  // vyber produkt s největším počtem hlasů
  let vybranyKod = null;
  let maxHlasy = 0;
  Object.entries(hlasy).forEach(([k, v]) => {
    if (v > maxHlasy) {
      maxHlasy = v;
      vybranyKod = k;
    }
  });

  // může vrátit null, pokud žádný bod nedal hlas (např. chybí Mg)
  return vybranyKod;
}

// Krátký lidský popis zvoleného produktu pro celé pole
function popisProduktuPole(kod) {
  if (kod === 'A') return 'Produkt A – převážně Ca, minimum Mg (pro pole s dobrým Mg)';
  if (kod === 'B') return 'Produkt B – vyvážený Ca + Mg (pro pole se středním Mg)';
  if (kod === 'C') return 'Produkt C – více Mg (pro pole s nízkým Mg)';
  if (kod === 'D') return 'Produkt D – velmi vysoký Mg (pro extrémní nedostatek Mg)';
  return 'Žádný produkt – pole se aktuálně nevápní';
}

// Jednoduchý popis bodu pro člověka (1–2 věty)
function popisBoduLidsky(bod, res) {
  const cislo = bod['Číslo bodu'];

  if (!res.vapnit || !res.davka_t_ha) {
    return `Bod ${cislo}: Nevápnit. pH ${res.pHtxt}, typ půdy ${res.typPudy}.`;
  }

  return (
    `Bod ${cislo}: ${res.davka_t_ha.toFixed(2)} t/ha produktu ${res.produktKod}, ` +
    `${res.interval_text}. pH ${res.pHtxt}, typ půdy ${res.typPudy}.`
  );
}

// ===== 2) Vyhodnocení vápnění pro celé pole =====

function vyhodnotVapneniPole(nazevPole) {
  // všechny body patřící k danému poli
  const bodyPole = allRows.filter(r => r['Název'] === nazevPole);
  if (!bodyPole.length) {
    return '<p>Pro pole "' + nazevPole + '" nebyly nalezeny žádné body.</p>';
  }

  // 1) nejdřív zvolíme JEDEN produkt pro celé pole (podle Mg)
  const produktKodPole = vyberProduktProPole(bodyPole);
  const produktPopis = popisProduktuPole(produktKodPole);

  // Pokud se nepodařilo určit produkt (např. žádný Mg), jen to odkomentuj a nevypisuj dávky
  if (!produktKodPole) {
    return `
      <p><strong>Doporučený produkt pro pole:</strong> ${produktPopis}</p>
      <p>Nelze vybrat produkt, protože chybí údaje o Mg v půdě.</p>
    `;
  }

  // 2) spočítáme doporučení pro každý bod – už s pevně zvoleným produktem pro pole
 // musí být:
const vysledkyBodu = bodyPole.map(bod => {
  const res = vyhodnotVapneniBod(bod, produktKodPole); // vynutit produkt pro pole
  return { bod, res };
});

  // 3) průměrná dávka (jen body, kde se má vápnit)
  let soucetD = 0;
  let pocet = 0;
  vysledkyBodu.forEach(({ res }) => {
    if (res.vapnit && res.davka_t_ha) {
      soucetD += res.davka_t_ha;
      pocet += 1;
    }
  });
  const prumerDavka = pocet ? (soucetD / pocet) : 0;

  const shrnutiPole = `
    <p><strong>Doporučený produkt pro celé pole:</strong> ${produktPopis}</p>
    ${pocet
      ? `<p>Vápnit pouze body s pH ≤ 6,5. Průměrná zásobní dávka pro tyto body ≈ ${prumerDavka.toFixed(2)} t/ha.</p>`
      : `<p>Pro žádný bod nevychází potřeba zásobního vápnění.</p>`}
  `;

  // 4) vypíšeme jen body, kde se vápní (aby seznam nebyl zahlcen „nevápnit“)
  const items = vysledkyBodu
    .filter(({ res }) => res.vapnit && res.davka_t_ha > 0)
    .map(({ bod, res }) => {
      const lidsky = popisBoduLidsky(bod, res);
      const detail = res.duvod || '';
      return `
        <li>
          ${lidsky}
          ${detail
            ? `<br><small><em>Detail výpočtu:</em> ${detail}</small>`
            : ''}
        </li>
      `;
    });

  if (!items.length) {
    return shrnutiPole + '<p>Na tomto poli není žádný bod, kde by bylo potřeba vápnit.</p>';
  }

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


