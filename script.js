const API_URL = 'https://script.google.com/macros/s/AKfycbxPdGIduQhxL3ZVBh85jo7T8-fFb0botFxE8VesqRx3vc70jKAlgpQy0g3rxEOGdhq1/exec';

async function loadAnalyses() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Chyba při načítání dat: ' + res.status);
  return await res.json();
}

function getUniqueFields(rows) {
  const map = new Map();
  rows.forEach(row => {
    const key = row['Název'];                   // hlavička z Google Sheets
    if (!key) return;                           // přeskoč prázdné řádky

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
    label.textContent = f.název;               // jen název pole

    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  });
}

// napojení na tlačítko v index.html
document.getElementById('loadFieldsBtn').addEventListener('click', async () => {
  try {
    const rows = await loadAnalyses();
    const fields = getUniqueFields(rows);
    renderFields(fields);
  } catch (e) {
    alert('Chyba při načítání: ' + e.message);
  }
});

