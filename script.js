const API_URL = 'https://script.google.com/macros/library/d/1h4CW6BlhINqJYJatyaOAcbp377iB-UI9v93CVYw5ox1-7XGeF8uNS1vK/1';

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
    checkbox.value = f.key;

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = `${f.čtverec} | ${f.zkod} | ${f.název}`;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  });
}

document.getElementById('loadFieldsBtn').addEventListener('click', async () => {
  try {
    const rows = await loadAnalyses();
    const fields = getUniqueFields(rows);
    renderFields(fields);
  } catch (e) {
    alert('Chyba při načítání: ' + e.message);
  }
});
