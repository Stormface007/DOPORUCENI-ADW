const API_URL = 'https://script.google.com/macros/s/AKfycbxPdGIduQhxL3ZVBh85jo7T8-fFb0botFxE8VesqRx3vc70jKAlgpQy0g3rxEOGdhq1/exec';

let allRows = [];   // sem uložíme všechna data z DATA

async function loadAnalyses() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Chyba při načítání dat: ' + res.status);
  return await res.json(); // A3:AA10000 jako objekty [file:44]
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

// jednoduché vyhodnocení vápnění pro jeden bod – kostra
function vyhodnotVapneniBod(bod) {
  const pH  = Number(bod['PH']);
  const ca  = Number(bod['CA']);
  const mg  = Number(bod['MG']);
  const kvk = Number(bod['KVK']);
  const org = Number(bod['ORG_HMOTA']);

  // ZÁKLADNÍ PRAVIDLO – lze později zpřesnit:
  //  - pokud pH >= 6.8 → nevápnit, vysvětlit proč
  if (pH >= 6.8) {
    return {
      vapnit: false,
      duvod: `pH = ${pH.toFixed(1)} (nad optimem), vysoká zásoba Ca (${ca.toFixed(0)} ppm), vápnit by zbytečně zvyšovalo pH.`
    };
  }

  // do budoucna sem přidáme další větve (kyselé půdy, Mg deficit atd.)

  return {
    vapnit: false,
    duvod: `Pravidla vápnění zatím nejsou plně nastavená (pH = ${pH.toFixed(1)}).`
  };
}

function vyhodnotVapneniPole(nazevPole) {
  const bodyPole = allRows.filter(r => r['Název'] === nazevPole);
  if (!bodyPole.length) {
    return `Pro pole "${nazevPole}" nebyly nalezeny žádné body.`;
  }

  const lines = bodyPole.map(bod => {
    const cislo = bod['Číslo bodu'];
    const res = vyhodnotVapneniBod(bod);

    if (res.vapnit) {
      return `Bod ${cislo}: VÁPNIT – produkt: ${res.produkt}, dávka: ${res.davka_t_ha} t/ha. Důvod: ${res.duvod}`;
    } else {
      return `Bod ${cislo}: NEVÁPNIT – ${res.duvod}`;
    }
  });

  return lines.join('\n');          // každý bod na svůj řádek
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

    const text = vyhodnotVapneniPole(nazevPole);
    resultsDiv.textContent = text;
  });
}

// inicializace po načtení
document.addEventListener('DOMContentLoaded', () => {
  initModal();
});
