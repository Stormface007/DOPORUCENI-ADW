const API_URL = 'https://script.google.com/macros/s/AKfycbw8rB0B_ZOM0gYMLVXB7CMBqx2H2W-5DhBICHP_qVFQXhJt84-8KNOZ96nB2_evQAe9/exec';

async function loadAnalyses() {
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error('Chyba při načítání dat: ' + res.status);
  }
  return await res.json();
}

function vyhodnotVapneni(bod) {
  const pH  = Number(bod.PH);
  const ca  = Number(bod.CA);
  const mg  = Number(bod.MG);
  const kvk = Number(bod.KVK);
  const org = Number(bod.ORG_HMOTA);

  // TODO: sem budeme postupně psát tvoje reálná pravidla
  return {
    vapnit: false,
    produkt: null,
    davka_t_ha: 0,
    komentar: 'Logika vápnění zatím není nastavená.'
  };
}

document.getElementById('loadBtn').addEventListener('click', async () => {
  const out = document.getElementById('output');
  out.textContent = 'Načítám...';
  try {
    const data = await loadAnalyses();
    out.textContent = JSON.stringify(data.slice(0, 5), null, 2);
  } catch (e) {
    out.textContent = 'Chyba: ' + e.message;
  }
});

document.getElementById('evalBtn').addEventListener('click', () => {
  const bod = {
    PH:        document.getElementById('phInput').value,
    CA:        document.getElementById('caInput').value,
    MG:        document.getElementById('mgInput').value,
    KVK:       document.getElementById('kvkInput').value,
    ORG_HMOTA: document.getElementById('orgInput').value
  };
  const res = vyhodnotVapneni(bod);
  document.getElementById('result').textContent = JSON.stringify(res, null, 2);
});

