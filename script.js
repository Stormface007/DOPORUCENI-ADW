const API_URL = 'https://script.google.com/macros/s/AKfycbxPdGIduQhxL3ZVBh85jo7T8-fFb0botFxE8VesqRx3vc70jKAlgpQy0g3rxEOGdhq1/exec';

let allRows = [];   // sem uložíme všechna data z listu DATA

async function loadAnalyses() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Chyba při načítání dat: ' + res.status);
  return await res.json(); // A3:AA10000 jako objekty
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

function urciTypPudy(kvk) {
  if (kvk <= 120) return 'lehká';
  if (kvk <= 180) return 'střední';
  return 'těžká';
}

// orientační přepočet relativního Ca2+ deficitu na kg Ca/ha (hodně zjednodušené)
function odhadCaDeficitKgHa(caPlus, kvk) {
  // caPlus je rozdíl proti cíli v "relativních bodech" z listu DATA (sloupec Ca2+).
  // pro hrubý odhad vezmeme, že 100 bodů ≈ 400 kg Ca/ha u střední půdy
  const base = 400; // kg Ca/ha pro 100 bodů u střední půdy
  let faktorPudy = 1.0;
  if (kvk <= 120) faktorPudy = 0.7;     // lehká – menší zásoba v profilu
  else if (kvk > 180) faktorPudy = 1.3; // těžká – vyšší zásoba

  const deficitBody = Math.abs(caPlus); // caPlus je záporný při deficitu
  return (deficitBody / 100) * base * faktorPudy;
}

// strategické vyhodnocení vápnění pro jeden bod
function vyhodnotVapneniBod(bod) {
  const pH   = Number(bod['PH']);
  const ca   = Number(bod['CA']);
  const mg   = Number(bod['MG']);
  const kvk  = Number(bod['KVK']);
  const org  = Number(bod['ORG_HMOTA']);

  const kPlus   = Number(bod['K+']);    // nadbytek/deficit K (relativní)
  const caPlus  = Number(bod['Ca2+']);  // nadbytek/deficit Ca (relativní)
  const mgPlus  = Number(bod['Mg2+']);  // nadbytek/deficit Mg (relativní)

  const typPudy = urciTypPudy(kvk);

  // 0) pokud chybí klíčová data, nic nepočítat
  if (isNaN(pH) || isNaN(kvk) || isNaN(caPlus) || isNaN(mgPlus)) {
    return {
      vapnit: false,
      duvod: `Chybí údaje pro výpočet (pH/KVK/Ca2+/Mg2+). Rozhodnutí je nutné udělat individuálně.`
    };
  }

  // 1) Vysoké pH – zásadně NEVÁPNIT, i když je Ca2+ v deficitu
  if (pH >= 7.0) {
    return {
      vapnit: false,
      duvod:
        `pH = ${pH.toFixed(1)} (vyšší/vysoké), typ půdy ${typPudy}. ` +
        `Ca2+ = ${caPlus.toFixed(0)}, Mg2+ = ${mgPlus.toFixed(0)}, K+ = ${kPlus.toFixed(0)} (kladné = nadbytek, záporné = deficit). ` +
        `V této reakci se vápnění zásobně neprovádí; Ca řešit jen plodinově a hlídat blokace P – zásobní P se nedává.`
    };
  }

  // 2) Ca2+ zhruba v cíli – nevápnit, jen sledovat trend
  if (caPlus > -50 && caPlus < 50) {
    return {
      vapnit: false,
      duvod:
        `pH = ${pH.toFixed(1)}, typ půdy ${typPudy}. ` +
        `Ca2+ blízko cílového zastoupení (${caPlus.toFixed(0)}), Mg2+ = ${mgPlus.toFixed(0)}, K+ = ${kPlus.toFixed(0)}. ` +
        `Strategie: nevápnit, spíš sledovat trend pH a organické hmoty (ORG = ${org.toFixed(1)} %).`
    };
  }

  // 3) Nadbytek Ca2+ – rozhodně nevápnit
  if (caPlus >= 50) {
    return {
      vapnit: false,
      duvod:
        `pH = ${pH.toFixed(1)}, typ půdy ${typPudy}. ` +
        `Ca2+ v nadbytku (+${caPlus.toFixed(0)}), Mg2+ = ${mgPlus.toFixed(0)}. ` +
        `Vápnění by nadbytek Ca ještě zvyšovalo; strategie je Ca dál nezvyšovat a zaměřit se spíš na Mg/K a organiku.`
    };
  }

  // 4) Deficit Ca2+ – zvažujeme zásobní vápnění na několik let
  if (caPlus <= -50) {
    // základ: odhad aktuálního deficitu Ca v kg/ha
    const caDeficitKg = odhadCaDeficitKgHa(caPlus, kvk); // kladné číslo v kg Ca/ha
    const roky = 5; // plánované období zásobního efektu

    const rocniUbytekCa = 150; // kg Ca/ha/rok
    const rocniUbytekMg = 15;  // kg Mg/ha/rok

    const zasobaCaKg = roky * rocniUbytekCa; // zásoba Ca na X let
    const zasobaMgKg = roky * rocniUbytekMg; // zásoba Mg na X let

    const celkemCaKg = caDeficitKg + zasobaCaKg;

    // hrubý přepočet na t/ha vápence:
    // 1 t vápence ~ 300 kg CaO → ~ 215 kg Ca (přibližně)
    const kgCaNaTunu = 215;
    let davka = celkemCaKg / kgCaNaTunu; // t/ha

    // mírná korekce podle typu půdy
    if (typPudy === 'lehká') davka *= 0.8;
    if (typPudy === 'těžká') davka *= 1.2;

    // omezení na rozumné rozmezí
    if (davka < 1) davka = 1;
    if (davka > 5) davka = 5;

    // volba typu produktu – jen kostra podle Mg2+
    let produkt = 'vápenec Ca (bez Mg)';
    if (mgPlus <= -30) {
      produkt = 'dolomitický vápenec (Ca + Mg)';
    }

    return {
      vapnit: true,
      produkt,
      davka_t_ha: Number(davka.toFixed(1)),
      duvod:
        `pH = ${pH.toFixed(1)}, typ půdy ${typPudy}. ` +
        `Ca2+ v deficitu (${caPlus.toFixed(0)}), Mg2+ = ${mgPlus.toFixed(0)}, K+ = ${kPlus.toFixed(0)}. ` +
        `Dávka ${davka.toFixed(1)} t/ha je spočítaná jako zásobní – pokrývá aktuální deficit Ca ` +
        `a zhruba ${roky} let očekávaného úbytku (≈ ${rocniUbytekCa} kg Ca/ha/rok a ${rocniUbytekMg} kg Mg/ha/rok). ` +
        `Nejde o jednorázové dorovnání na cílové procento, ale o dlouhodobou strategii.`
    };
  }

  // fallback – Ca2+ trochu v mínusu, ale ne výrazně
  return {
    vapnit: false,
    duvod:
      `pH = ${pH.toFixed(1)}, typ půdy ${typPudy}. ` +
      `Ca2+ lehce pod cílem (${caPlus.toFixed(0)}), Mg2+ = ${mgPlus.toFixed(0)}. ` +
      `Zásobní vápnění se zatím neprovádí, rozhodnutí lze doladit podle plodiny a plánovaného osevního postupu.`
  };
}

function vyhodnotVapneniPole(nazevPole) {
  const bodyPole = allRows.filter(r => r['Název'] === nazevPole);
  if (!bodyPole.length) {
    return '<p>Pro pole "' + nazevPole + '" nebyly nalezeny žádné body.</p>';
  }

  const items = bodyPole.map(bod => {
    const cislo = bod['Číslo bodu'];
    const res = vyhodnotVapneniBod(bod);

    if (res.vapnit) {
      return `<li><strong>Bod ${cislo}</strong>: VÁPNIT – produkt: ${res.produkt}, dávka: ${res.davka_t_ha} t/ha.<br>Důvod: ${res.duvod}</li>`;
    } else {
      return `<li><strong>Bod ${cislo}</strong>: NEVÁPNIT – ${res.duvod}</li>`;
    }
  });

  return `<ul>${items.join('')}</ul>`;
}

// MODAL – otevření / zavření
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

// inicializace po načtení
document.addEventListener('DOMContentLoaded', () => {
  initModal();
});
