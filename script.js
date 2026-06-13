const STORAGE_KEY = 'irongateInspection_v2';

const lists = {
  gate: document.getElementById('gatesList'),
  fence: document.getElementById('fencesList'),
  ncz: document.getElementById('nczList'),
  boundary: document.getElementById('boundaryList'),
  opening: document.getElementById('openingsList')
};

const counters = { gate: 0, fence: 0, ncz: 0, boundary: 0, opening: 0 };

const locationOptions = [
  'Main Entry', 'Front Boundary', 'Rear Boundary', 'Left Boundary', 'Right Boundary',
  'House Side', 'House Wall', 'Side Access', 'Pool Equipment Area', 'Patio / Alfresco',
  'Deck', 'Garden / Landscaping Area', 'Neighbour Boundary', 'Garage Side', 'Other'
];

const referenceText = {
  gate: {
    summary: 'Gate should open away from the pool area, self-close and self-latch from open/rest positions, with latch and release located so young children cannot readily operate it.',
    cite: 'Reference: AS 1926.1-2007 cl 2.5 and Section 3.4; QDC MP 3.4.'
  },
  fence: {
    summary: 'Barrier should be permanent, have effective height not less than 1200mm, control ground clearance and openings, and maintain the non-climbable zone.',
    cite: 'Reference: AS 1926.1-2007 cl 2.1, 2.3 and 2.4; QDC MP 3.4.'
  },
  ncz: {
    summary: 'Maintain a 900mm non-climbable zone. Objects, projections, taps, vegetation or fixtures must not provide a climbable path through the barrier.',
    cite: 'Reference: AS 1926.1-2007 cl 1.3.9 and 2.1; QLD Pool Safety Inspector Guideline 2024.'
  },
  boundary: {
    summary: 'Boundary fence used as a pool barrier should be at least 1800mm high, with the required NCZ assessed on the relevant side/top of the barrier.',
    cite: 'Reference: AS 1926.1-2007 cl 2.3.1; QDC MP 3.4.'
  },
  opening: {
    summary: 'Doors, windows and balconies forming part of the barrier must be child-resistant, restricted or otherwise compliant so they do not allow access to the pool area.',
    cite: 'Reference: AS 1926.1-2007 cl 2.7, 2.8 and 2.9; QDC MP 3.4.'
  }
};

const templates = {
  gate: {
    prefix: 'G',
    title: 'Gate',
    locations: ['Main Entry Gate', 'Side Gate', 'House Access Gate', 'Pool Equipment Gate', ...locationOptions],
    fields: [
      ['Location Type', 'select', null],
      ['Specific Location Notes', 'text', 'e.g. beside garage / near pool pump'],
      ['Self Closing', 'select', ['Pass', 'Fail', 'N/A']],
      ['Self Latching', 'select', ['Pass', 'Fail', 'N/A']],
      ['Gate Swings Away From Pool', 'select', ['Pass', 'Fail', 'N/A']],
      ['Latch Height (mm)', 'number', ''],
      ['Gap Under Gate (mm)', 'number', ''],
      ['Comments / Recommendation', 'textarea', '']
    ]
  },
  fence: {
    prefix: 'F',
    title: 'Fence Section',
    locations: locationOptions,
    fields: [
      ['Location Type', 'select', null],
      ['Specific Location Notes', 'text', 'e.g. section beside shed'],
      ['Fence Type', 'select', ['Aluminium', 'Glass', 'Timber', 'Chainwire / mesh', 'Masonry', 'Other']],
      ['Height (mm)', 'number', ''],
      ['Ground Clearance (mm)', 'number', ''],
      ['Openings / Gaps Compliant', 'select', ['Pass', 'Fail', 'N/A']],
      ['Comments / Recommendation', 'textarea', '']
    ]
  },
  ncz: {
    prefix: 'NCZ',
    title: 'NCZ Check',
    locations: locationOptions,
    fields: [
      ['Location Type', 'select', null],
      ['Specific Location Notes', 'text', 'e.g. tap on brick wall'],
      ['Object Type', 'select', ['None observed', 'Tree / vegetation', 'Pot plant', 'Furniture', 'Pool equipment', 'Retaining wall', 'Tap / power outlet', 'Other']],
      ['Distance From Barrier (mm)', 'number', ''],
      ['NCZ Compliant', 'select', ['Pass', 'Fail', 'N/A']],
      ['Comments / Recommendation', 'textarea', '']
    ]
  },
  boundary: {
    prefix: 'B',
    title: 'Boundary Fence',
    locations: ['Rear Boundary', 'Left Boundary', 'Right Boundary', 'Front Boundary', 'Neighbour Boundary', 'Other'],
    fields: [
      ['Location Type', 'select', null],
      ['Specific Location Notes', 'text', 'e.g. behind pool pump'],
      ['Height (mm)', 'number', ''],
      ['NCZ Side Checked', 'select', ['Inside', 'Outside', 'Both', 'N/A']],
      ['Climbable Objects Present', 'select', ['No', 'Yes', 'N/A']],
      ['Compliant', 'select', ['Pass', 'Fail', 'N/A']],
      ['Comments / Recommendation', 'textarea', '']
    ]
  },
  opening: {
    prefix: 'O',
    title: 'Door / Window / Balcony',
    locations: ['House Wall', 'Living Room', 'Dining Room', 'Bedroom', 'Bathroom', 'Patio / Alfresco', 'Deck', 'Other'],
    fields: [
      ['Type', 'select', ['Door', 'Window', 'Balcony', 'Other']],
      ['Location Type', 'select', null],
      ['Specific Location Notes', 'text', 'e.g. window facing pool'],
      ['Opening Restricted', 'select', ['Pass', 'Fail', 'N/A']],
      ['Self Closing / Latching', 'select', ['Pass', 'Fail', 'N/A']],
      ['Opening Size (mm)', 'number', ''],
      ['Comments / Recommendation', 'textarea', '']
    ]
  }
};

function setSaveStatus(text) { document.getElementById('saveStatus').textContent = text; }
function markUnsaved() { setSaveStatus('Not saved yet — tap Save before leaving Safari.'); }

function fieldHtml(field, cfg) {
  const [label, type, value] = field;
  const options = label === 'Location Type' ? cfg.locations : value;
  if (type === 'select') return `<label>${label}<select data-save>${options.map(v => `<option>${v}</option>`).join('')}</select></label>`;
  if (type === 'textarea') return `<label>${label}<textarea data-save rows="3" placeholder="Notes..."></textarea></label>`;
  return `<label>${label}<input data-save type="${type}" placeholder="${value || ''}"></label>`;
}

function referenceBox(type) {
  const r = referenceText[type];
  return `<div class="reference-box"><strong>Requirement:</strong> ${r.summary}<small>${r.cite}</small></div>`;
}

function addItem(type, data = null) {
  counters[type]++;
  const cfg = templates[type];
  const itemCode = `${cfg.prefix}${counters[type]}`;
  const card = document.createElement('article');
  card.className = 'item-card';
  card.dataset.type = type;
  card.dataset.code = itemCode;
  card.innerHTML = `
    <div class="item-head">
      <div><h3>${itemCode} - ${cfg.title}</h3><p class="item-location-line">Location not selected</p></div>
      <button class="remove-btn no-print" type="button">Remove</button>
    </div>
    <div class="status-row">${cfg.fields.map(f => fieldHtml(f, cfg)).join('')}</div>
    <div class="photo-mount"></div>
    ${referenceBox(type)}
  `;
  card.querySelector('.remove-btn').addEventListener('click', () => {
    if (confirm('Remove this checklist item?')) { card.remove(); refreshSummary(); markUnsaved(); }
  });
  lists[type].appendChild(card);
  mountPhotoWidget(card.querySelector('.photo-mount'));
  card.querySelectorAll('[data-save]').forEach(el => {
    el.addEventListener('input', () => { updateLocationLine(card); refreshSummary(); markUnsaved(); });
    el.addEventListener('change', () => { updateLocationLine(card); refreshSummary(); markUnsaved(); });
  });
  if (data) restoreCard(card, data);
  updateLocationLine(card);
  return card;
}

function updateLocationLine(card) {
  const fields = [...card.querySelectorAll('[data-save]')];
  let locIndex = card.dataset.type === 'opening' ? 1 : 0;
  let noteIndex = card.dataset.type === 'opening' ? 2 : 1;
  const loc = fields[locIndex]?.value || '';
  const note = fields[noteIndex]?.value || '';
  card.querySelector('.item-location-line').textContent = [card.dataset.code, loc, note].filter(Boolean).join(' - ');
}

function mountPhotoWidget(target) {
  const tpl = document.getElementById('photoTemplate').content.cloneNode(true);
  const input = tpl.querySelector('input[type=file]');
  const btn = tpl.querySelector('.camera-btn');
  const grid = tpl.querySelector('.photo-grid');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', e => {
    [...e.target.files].forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => { addPhoto(grid, ev.target.result); markUnsaved(); };
      reader.readAsDataURL(file);
    });
    input.value = '';
  });
  target.appendChild(tpl);
  updatePhotoCount(target.querySelector('.photo-widget'));
}

function updatePhotoCount(widget) {
  if (!widget) return;
  widget.querySelector('.photo-count span').textContent = widget.querySelectorAll('.photo-box').length;
}

function addPhoto(grid, src, savedStamp = null) {
  const box = document.createElement('div');
  box.className = 'photo-box';
  const stamp = savedStamp || new Date().toLocaleString();
  box.dataset.stamp = stamp;
  box.innerHTML = `<img src="${src}" alt="inspection photo"><button class="delete-photo no-print" type="button" aria-label="Delete photo">×</button><div class="timestamp">${stamp}<br>IronGate Pool Inspections</div>`;
  box.querySelector('.delete-photo').addEventListener('click', e => {
    e.stopPropagation();
    if (confirm('Delete this photo?')) { box.remove(); updatePhotoCount(grid.closest('.photo-widget')); markUnsaved(); }
  });
  grid.appendChild(box);
  updatePhotoCount(grid.closest('.photo-widget'));
}

function getFieldValue(el) { return el.type === 'checkbox' ? el.checked : el.value; }
function setFieldValue(el, value) { if (el.type === 'checkbox') el.checked = Boolean(value); else el.value = value ?? ''; }
function getStaticFields() { return [...document.querySelectorAll('main > section:not(.repeat-section) [data-save]')].map(getFieldValue); }
function setStaticFields(values = []) { const els = [...document.querySelectorAll('main > section:not(.repeat-section) [data-save]')]; values.forEach((v,i) => { if (els[i]) setFieldValue(els[i], v); }); }
function getPhotosFromGrid(grid) { return [...grid.querySelectorAll('.photo-box')].map(box => ({ src: box.querySelector('img')?.src || '', stamp: box.dataset.stamp || '' })); }

function gatherData() {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    staticFields: getStaticFields(),
    sectionPhotos: [...document.querySelectorAll('main > section:not(.repeat-section) .photo-area .photo-grid')].map(getPhotosFromGrid),
    cards: [...document.querySelectorAll('.item-card')].map(card => ({ type: card.dataset.type, values: [...card.querySelectorAll('[data-save]')].map(getFieldValue), photos: getPhotosFromGrid(card.querySelector('.photo-grid')) }))
  };
}

function saveInspection() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gatherData()));
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setSaveStatus(`Saved on this iPhone/browser at ${time}`);
  } catch (err) {
    alert('Save failed. The inspection may be too large because of the number or size of photos. Delete duplicate photos or reduce photo size, then save again.');
    console.error(err);
  }
}

function loadInspection() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('irongateInspection_v1');
  if (!raw) { alert('No saved inspection found on this device/browser.'); return; }
  try {
    const data = JSON.parse(raw);
    document.querySelectorAll('.item-card').forEach(c => c.remove());
    Object.keys(counters).forEach(k => counters[k] = 0);
    document.querySelectorAll('.photo-grid').forEach(grid => grid.innerHTML = '');
    document.querySelectorAll('.photo-widget').forEach(updatePhotoCount);
    setStaticFields(data.staticFields);
    const sectionGrids = [...document.querySelectorAll('main > section:not(.repeat-section) .photo-area .photo-grid')];
    data.sectionPhotos?.forEach((photos, i) => photos?.forEach(photo => addPhoto(sectionGrids[i], photo.src, photo.stamp)));
    data.cards?.forEach(c => addItem(c.type, c));
    refreshSummary(); updatePrintCover();
    const savedTime = data.savedAt ? new Date(data.savedAt).toLocaleString() : 'previous session';
    setSaveStatus(`Loaded saved inspection from ${savedTime}`);
  } catch (err) { alert('Saved inspection could not be loaded.'); console.error(err); }
}

function clearInspection() { if (confirm('Clear the saved inspection and reset the screen?')) { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem('irongateInspection_v1'); location.reload(); } }
function restoreCard(card, data) { const els = [...card.querySelectorAll('[data-save]')]; data.values?.forEach((v,i) => { if (els[i]) setFieldValue(els[i], v); }); const grid = card.querySelector('.photo-grid'); data.photos?.forEach(photo => addPhoto(grid, photo.src, photo.stamp)); updateLocationLine(card); }

function markFailures() {
  document.querySelectorAll('.item-card').forEach(card => {
    const fail = [...card.querySelectorAll('select')].some(s => {
      const label = s.closest('label')?.childNodes[0]?.textContent?.trim() || '';
      return s.value === 'Fail' || (label === 'Climbable Objects Present' && s.value === 'Yes');
    });
    card.classList.toggle('fail-highlight', fail);
  });
}

function refreshSummary() {
  markFailures();
  const ol = document.getElementById('failureSummary'); ol.innerHTML = '';
  document.querySelectorAll('.item-card').forEach(card => {
    const failed = [...card.querySelectorAll('select')].filter(s => {
      const label = s.closest('label')?.childNodes[0]?.textContent?.trim() || '';
      return s.value === 'Fail' || (label === 'Climbable Objects Present' && s.value === 'Yes');
    });
    if (failed.length) {
      const comments = [...card.querySelectorAll('textarea')].map(t => t.value).filter(Boolean).join(' ');
      const li = document.createElement('li');
      li.textContent = `${card.querySelector('h3').textContent} - ${card.querySelector('.item-location-line').textContent}: ${failed.map(f => f.closest('label').childNodes[0].textContent.trim()).join(', ')}. ${comments}`;
      ol.appendChild(li);
    }
  });
  if (!ol.children.length) { const li = document.createElement('li'); li.textContent = 'No failed checklist items recorded yet.'; ol.appendChild(li); }
  updatePrintCover();
}

function updatePrintCover() {
  document.getElementById('printAddress').textContent = document.getElementById('propertyAddress').value || 'Property address not entered';
  document.getElementById('printDate').textContent = 'Date: ' + (document.getElementById('inspectionDate').value || 'Not entered');
  document.getElementById('printResult').textContent = 'Result: ' + (document.getElementById('inspectionResult').value || 'Not selected');
}

document.querySelectorAll('.photo-area').forEach(mountPhotoWidget);
document.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => { addItem(btn.dataset.add); markUnsaved(); }));
document.getElementById('refreshSummary').addEventListener('click', refreshSummary);
document.getElementById('saveBtn').addEventListener('click', saveInspection);
document.getElementById('loadBtn').addEventListener('click', loadInspection);
document.getElementById('clearBtn').addEventListener('click', clearInspection);
document.getElementById('printBtn').addEventListener('click', () => { refreshSummary(); window.print(); });
document.querySelectorAll('[data-save]').forEach(el => { el.addEventListener('input', () => { refreshSummary(); markUnsaved(); }); el.addEventListener('change', () => { refreshSummary(); markUnsaved(); }); });

addItem('gate'); addItem('fence'); addItem('ncz'); addItem('boundary'); addItem('opening');
if (!document.getElementById('inspectionDate').value) document.getElementById('inspectionDate').valueAsDate = new Date();
refreshSummary();
setSaveStatus((localStorage.getItem(STORAGE_KEY) || localStorage.getItem('irongateInspection_v1')) ? 'Saved inspection found on this device — tap Load to restore it.' : 'Not saved yet');
