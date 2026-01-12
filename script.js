const API_URL = 'https://script.google.com/macros/s/AKfycbw8rB0B_ZOM0gYMLVXB7CMBqx2H2W-5DhBICHP_qVFQXhJt84-8KNOZ96nB2_evQAe9/exec';

async function loadAnalyses() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Chyba při načítání dat: ' + res.status);
  return await res.json();
}

function getUniqueFields(rows) {
  const map = new Map();
  rows.forEach(row => {
    const key = row.Název; // můžeš změnit na kombinaci
    if (!map.has(key)) {
      map.set(key, {
        key,
        čtverec: row.Čtverec,
        zkod: row.Zkod,
        název: row.Název
      });
    }
  });
  return Array.from(map.values());
}

function renderFields(fields) {
  const container = document.getElementById('fieldsContainer');
  container.innerHTML = '';

  fields.forEach((f, index) => {
    const id = `field-${index}`;
    const wrapper = document.createElement('div');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.value = f.key;          // klíč = název pole

    const label = document.createElement('label');
    label.htmlFor = id;
    // dříve: `${f.čtverec} | ${f.zkod} | ${f.název}`
    label.textContent = f.název;     // zobrazí se jen název

    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  });
}
