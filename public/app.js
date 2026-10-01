const $ = (sel) => document.querySelector(sel);

const DEFAULT_COLORS = ['#1f2a44', '#c2553d', '#f4efe6'];
const DEFAULT_MEDIUMS = new Set(['billboard', 'newspaper', 'social']);
const CONCURRENCY = 3;

const state = {
  config: null,
  brief: null,
  reference: null, // { mimeType, data }
  cards: new Map(), // mediumId -> card element
};

const dataUrl = (img) => `data:${img.mimeType};base64,${img.data}`;
const ext = (mime) => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' })[mime] || 'png';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// --- Form setup -------------------------------------------------------------

function renderSwatches() {
  const wrap = $('#swatches');
  DEFAULT_COLORS.forEach((c, i) => {
    const input = Object.assign(document.createElement('input'), { type: 'color', value: c, name: `color${i}` });
    input.setAttribute('aria-label', `Brand colour ${i + 1}`);
    wrap.append(input);
  });
}

function renderMediumChips() {
  const wrap = $('#mediumChips');
  for (const m of state.config.mediums) {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" name="medium" value="${m.id}"><span>${m.label}<small>${m.aspectRatio}</small></span>`;
    label.querySelector('input').checked = DEFAULT_MEDIUMS.has(m.id);
    wrap.append(label);
  }
}

function readBrief() {
  const f = new FormData($('#briefForm'));
  return {
    brandName: f.get('brandName'),
    productName: f.get('productName'),
    description: f.get('description'),
    tagline: f.get('tagline'),
    style: f.get('style'),
    colors: [...document.querySelectorAll('#swatches input')].map((i) => i.value),
  };
}

const selectedMediums = () => [...document.querySelectorAll('input[name="medium"]:checked')].map((i) => i.value);

function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const [, mimeType, data] = /^data:(.+?);base64,(.*)$/.exec(r.result);
      resolve({ mimeType, data });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// --- Rendering ---------------------------------------------------------------

function showReference(img, brief) {
  $('#emptyState').classList.add('hidden');
  $('#referenceCard').classList.remove('hidden');
  $('#referenceImg').src = dataUrl(img);
  $('#referenceTitle').textContent = [brief.brandName, brief.productName].filter(Boolean).join(' — ');
}

function showReferenceLoading() {
  $('#emptyState').classList.add('hidden');
  $('#referenceCard').classList.remove('hidden');
  $('#referenceCard').classList.add('loading');
  $('#referenceImg').removeAttribute('src');
  $('#referenceTitle').textContent = 'Designing your product…';
}

function ensureCard(mediumId) {
  if (state.cards.has(mediumId)) return state.cards.get(mediumId);
  const medium = state.config.mediums.find((m) => m.id === mediumId);
  const card = $('#cardTpl').content.firstElementChild.cloneNode(true);
  card.dataset.medium = mediumId;
  card.style.setProperty('--ar', medium.aspectRatio.replace(':', ' / '));
  if (['21:9', '16:9'].includes(medium.aspectRatio)) card.classList.add('wide');
  card.querySelector('.title').textContent = medium.label;
  card.querySelector('.meta').textContent = medium.aspectRatio;
  card.querySelector('.tweak').addEventListener('click', () => card.querySelector('.tweak-box').classList.toggle('hidden'));
  card.querySelector('.tweak-box button').addEventListener('click', () => {
    const note = card.querySelector('.tweak-box input').value;
    generateMedium(mediumId, note);
  });
  card.querySelector('.frame').addEventListener('click', () => {
    const img = card.querySelector('img');
    if (card.dataset.state === 'done') openLightbox(img.src, medium.label);
  });
  $('#grid').append(card);
  state.cards.set(mediumId, card);
  return card;
}

function setCard(card, status, text) {
  card.dataset.state = status;
  card.querySelector('.loader').lastChild.textContent = text ?? '';
}

function openLightbox(src, alt) {
  const img = $('#lightboxImg');
  img.src = src;
  img.alt = alt;
  $('#lightbox').showModal();
}

// --- Generation --------------------------------------------------------------

async function generateMedium(mediumId, variationNote) {
  const card = ensureCard(mediumId);
  setCard(card, 'loading', 'Generating with Nano-Banana…');
  try {
    const { image, attempts, peopleCheck } = await api('/api/medium', {
      brief: state.brief,
      mediumId,
      referenceImage: state.reference,
      variationNote,
    });
    const img = card.querySelector('img');
    img.src = dataUrl(image);
    img.alt = `${state.brief.brandName} — ${mediumId}`;
    const dl = card.querySelector('.download');
    dl.href = img.src;
    dl.download = `${slug(state.brief.brandName)}-${mediumId}.${ext(image.mimeType)}`;
    const badge = { passed: '✓ no people', unverified: 'unverified', skipped: '' }[peopleCheck] ?? '';
    const medium = state.config.mediums.find((m) => m.id === mediumId);
    card.querySelector('.meta').textContent = [medium.aspectRatio, badge, attempts > 1 ? `${attempts} tries` : '']
      .filter(Boolean)
      .join(' · ');
    setCard(card, 'done');
  } catch (err) {
    setCard(card, 'error', err.message);
  }
}

async function runPool(ids, worker) {
  const queue = [...ids];
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

async function generateAllMediums(ids) {
  // Drop cards for mediums that were deselected.
  for (const [id, card] of state.cards) {
    if (!ids.includes(id)) {
      card.remove();
      state.cards.delete(id);
    }
  }
  ids.forEach((id) => setCard(ensureCard(id), 'pending', 'Queued…'));
  await runPool(ids, (id) => generateMedium(id));
}

async function generateReference() {
  showReferenceLoading();
  try {
    const { image } = await api('/api/reference', { brief: state.brief });
    state.reference = image;
    showReference(image, state.brief);
    return true;
  } catch (err) {
    $('#referenceTitle').textContent = `Couldn't design the product: ${err.message}`;
    return false;
  } finally {
    $('#referenceCard').classList.remove('loading');
  }
}

function setBusy(busy) {
  for (const id of ['#goBtn', '#newRefBtn', '#rerunAllBtn']) $(id).disabled = busy;
  $('#goBtn').textContent = busy ? 'Building…' : 'Build campaign';
}

async function build({ newReference }) {
  const ids = selectedMediums();
  if (!ids.length) return alert('Pick at least one medium.');
  setBusy(true);
  try {
    state.brief = readBrief();
    const mode = document.querySelector('input[name="refMode"]:checked').value;
    if (mode === 'upload') {
      const file = $('#refUpload').files[0];
      if (!file) {
        $('#refUpload').click();
        return;
      }
      state.reference = await readFileAsImage(file);
      showReference(state.reference, state.brief);
    } else if (newReference || !state.reference) {
      if (!(await generateReference())) return;
    }
    await generateAllMediums(ids);
  } finally {
    setBusy(false);
  }
}

// --- Wiring --------------------------------------------------------------------

async function init() {
  state.config = await api('/api/config');
  $('#modelPill').innerHTML = `Nano-Banana<span class="model-id"> · ${state.config.model}</span>${state.config.mock ? ' · mock' : ''}`;
  renderSwatches();
  renderMediumChips();

  // Any change to the product itself invalidates the current reference.
  const productFields = ['brandName', 'productName', 'description', 'style'];
  $('#briefForm').addEventListener('input', (e) => {
    if (productFields.includes(e.target.name) || e.target.type === 'color') state.reference = null;
  });

  $('#briefForm').addEventListener('submit', (e) => {
    e.preventDefault();
    build({ newReference: false });
  });
  $('#newRefBtn').addEventListener('click', () => {
    document.querySelector('input[name="refMode"][value="generate"]').checked = true;
    build({ newReference: true });
  });
  $('#rerunAllBtn').addEventListener('click', async () => {
    if (!state.reference) return build({ newReference: true });
    setBusy(true);
    try {
      state.brief = readBrief();
      await generateAllMediums(selectedMediums());
    } finally {
      setBusy(false);
    }
  });

  document.querySelectorAll('input[name="refMode"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.reference = null;
      if (r.value === 'upload' && r.checked) $('#refUpload').click();
    }),
  );
  $('#refUpload').addEventListener('change', () => {
    if ($('#refUpload').files[0]) $('#goBtn').textContent = 'Build campaign with my photo';
  });
}

init().catch((err) => {
  document.body.insertAdjacentHTML('afterbegin', `<div class="banner">Failed to start: ${err.message}</div>`);
});
