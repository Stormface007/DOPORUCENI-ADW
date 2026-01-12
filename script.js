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
      davka_t_ha: 0,
      interval_let: 0,
      potrebujeMg: false,
      duvod: 'Chybí pH nebo KVK, nelze spočítat doporučení vápnění.'
    };
  }

  const typ = urciTypPudy(kvk);
  const rada = urciIntervalovyRadek(pH);
  const zapis = vapnoTabulka[typ][rada];

  // 1) Bezpečnostní brzda – pH příliš vysoké
  if (pH >= 7.0) {
    return {
      vapnit: false,
      davka_t_ha: 0,
      interval_let: 0,
      potrebujeMg: false,
      duvod:
        `pH = ${pH.toFixed(1)} (vysoké), typ půdy ${typ}. ` +
        `Nasycení Ca ≈ ${isNaN(satCa) ? 'n/a' : satCa.toFixed(1)} %. ` +
        `Zásobní vápnění by mohlo zhoršit dostupnost P i stav bioty, proto se nedoporučuje.`
    };
  }

  const nas = vyhodnotNasyceni(typ, satCa, satMg, satK);

  const silnyDeficitCa2 = !isNaN(caPlus) && caPlus <= -200;
  const silnyDeficit = nas.silnyDeficitCa || silnyDeficitCa2;

  const tabulkaMaDavku = !!(zapis && (zapis.prodA > 0 || zapis.prodB > 0));

  // Produkt preferovaný bodem – jen podle Mg
  const potrebujeMg =
    nas.deficitMg ||
    (!isNaN(mgPlus) && mgPlus < 0) ||
    (!isNaN(kPlus) && kPlus > 0 && nas.deficitMg); // K se bude doplňovat, Mg je nízko

  // 2) Když tabulka nemá dávku a není ani deficit Ca → nevápnit
  if (!tabulkaMaDavku && !nas.deficitCa && !silnyDeficit) {
    return {
      vapnit: false,
      davka_t_ha: 0,
      interval_let: 0,
      potrebujeMg,
      duvod:
        `pH = ${pH.toFixed(1)}, typ ${typ}. Tabulka „vapno objemy“ nedává zásobní dávku ` +
        `a nasycení Ca ≈ ${isNaN(satCa) ? 'n/a' : satCa.toFixed(1)} % není výrazně pod optimem.`
    };
  }

  // 3) Základní dávka z tabulky – nezávislá na volbě konkrétního produktu; jen A/B mají jiné NV
  let davka = 0;
  if (zapis) {
    // použijeme střed mezi A a B jako „chemickou“ dávku CaCO3
    const prumer = (zapis.prodA + zapis.prodB) / 2 || zapis.nemecko || 0;
    davka = prumer;
  }

  // 4) Silný deficit Ca → nesmí být nula, případně dávku lehce navýšit
  if (silnyDeficit && (!zapis || davka <= 0)) {
    davka = (zapis && zapis.nemecko > 0) ? zapis.nemecko : 3.0;
  }
  if (silnyDeficit) {
    davka *= 1.2;
  }

  // 5) Ořezání na rozumné meze
  if (davka < 0.5) davka = 0.5;
  if (davka > 5.0) davka = 5.0;

  const interval = (zapis && zapis.interval) || (typ === 'tezka' ? 5 : typ === 'lehka' ? 3 : 4);

  return {
    vapnit: true,
    davka_t_ha: Number(davka.toFixed(1)),
    interval_let: interval,
    potrebujeMg,
    duvod:
      `pH = ${pH.toFixed(1)}, KVK ≈ ${kvk.toFixed(1)} (${typ} půda). ` +
      `Nasycení Ca ≈ ${isNaN(satCa) ? 'n/a' : satCa.toFixed(1)} %, Mg ≈ ${isNaN(satMg) ? 'n/a' : satMg.toFixed(1)} %, ` +
      `K ≈ ${isNaN(satK) ? 'n/a' : satK.toFixed(1)} %. ` +
      `Ca²⁺ = ${isNaN(caPlus) ? 'n/a' : caPlus.toFixed(0)}, Mg²⁺ = ${isNaN(mgPlus) ? 'n/a' : mgPlus.toFixed(0)}, ` +
      `K⁺ = ${isNaN(kPlus) ? 'n/a' : kPlus.toFixed(0)}. ` +
      (silnyDeficit
        ? `Ca je v silném deficitu, proto zásobní dávka ${davka.toFixed(1)} t/ha. `
        : `Dávka ${davka.toFixed(1)} t/ha vychází z tabulky „vapno objemy“ pro dané pH a KVK. `) +
      `Interval opakování orientačně ${interval} let; jde o zásobní vápnění, ne jednorázové dorovnání ideálních procent.`
  };
}

// ========== Vyhodnocení pro celé pole (výběr produktu) ==========

function vyhodnotVapneniPole(nazevPole) {
  const bodyPole = allRows.filter(r => r['Název'] === nazevPole);
  if (!bodyPole.length) {
    return '<p>Pro pole "' + nazevPole + '" nebyly nalezeny žádné body.</p>';
  }

  const vysledkyBodu = bodyPole.map(bod => {
    const res = vyhodnotVapneniBod(bod);
    return { bod, res };
  });

  // Hlasy pro produkt A (Ca+Mg) vs B (Ca)
  let hlasyA = 0;
  let hlasyB = 0;

  vysledkyBodu.forEach(({ res }) => {
    if (res.potrebujeMg) hlasyA += 1;
    else hlasyB += 1;
  });

  const pocetBodu = vysledkyBodu.length;
  const podilA = pocetBodu ? hlasyA / pocetBodu : 0;

  // Rozhodovací pravidlo: pokud je výraznější potřeba Mg, vezmeme A pro celé pole
  // – stačí buď podíl > 0.3, nebo aspoň jeden bod s velmi nízkým Mg (už obsaženo v potrebujeMg)
  const zvolProduktA = podilA > 0.3 || (hlasyA > 0 && hlasyB === 0);
  const produktNazev = zvolProduktA
    ? 'Produkt A (dolomitický – Ca + Mg)'
    : 'Produkt B (vápenec – převážně Ca)';

  // Z pole spočítáme orientační průměrnou dávku a interval (jen info do shrnutí)
  let soucetDávek = 0;
  let soucetIntervalu = 0;
  let pocetVapnenych = 0;

  vysledkyBodu.forEach(({ res }) => {
    if (res.vapnit && res.davka_t_ha > 0) {
      soucetDávek += res.davka_t_ha;
      soucetIntervalu += res.interval_let;
      pocetVapnenych += 1;
    }
  });

  const prumerDavka = pocetVapnenych ? (soucetDávek / pocetVapnenych) : 0;
  const prumerInterval = pocetVapnenych ? Math.round(soucetIntervalu / pocetVapnenych) : 0;

  const shrnutiPole = `
    <p><strong>Produkt pro celé pole:</strong> ${produktNazev}</p>
    ${pocetVapnenych
      ? `<p>Na části bodů vychází vápnění s průměrnou zásobní dávkou přibližně ${prumerDavka.toFixed(1)} t/ha a intervalem kolem ${prumerInterval} let. 
         Konkrétní dávky pro body jsou níže; pole se ale vždy vápní jedním produktem.</p>`
      : `<p>Pro žádný bod nevychází jednoznačná potřeba zásobního vápnění – pole se nyní nevápní.</p>`}
  `;

  const items = vysledkyBodu.map(({ bod, res }) => {
    const cislo = bod['Číslo bodu'];
    const davkaText = res.vapnit
      ? `${res.davka_t_ha.toFixed(1)} t/ha`
      : '0 t/ha (nevápnit)';

    return `
      <li>
        <strong>Bod ${cislo}</strong>: dávka ${davkaText}, produkt: ${produktNazev}, interval: ${res.interval_let || '---'} let.<br>
        Důvod: ${res.duvod}
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

