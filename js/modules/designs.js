// Design & style library with image gallery, search and category filter.
import { html, icon, raw, field, formModal, toast, toastError, emptyState, pageHeader, badge, delegate, skeleton, confirmDialog, openModal } from '../ui.js';
import { getAll } from '../database.js';
import { saveDesign, deleteDesign } from '../services.js';
import { GARMENT_CATEGORIES, MEASUREMENT_FIELDS } from '../core/defaults.js';
import { readImage, debounce, money } from '../utils.js';
import { getState } from '../state.js';

export async function openDesignForm(existing = null) {
  let images = existing?.images ? [...existing.images] : [];
  const unit = getState().business?.fabricUnit || 'yards';
  const res = await formModal({
    title: existing ? `Edit ${existing.name}` : 'Add design', size: 'lg', submitLabel: existing ? 'Save design' : 'Add design',
    body: html`
      ${field({ label: 'Design name', name: 'name', value: existing?.name, required: true, attrs: 'maxlength="100"' })}
      ${field({ label: 'Category', name: 'category', type: 'select', value: existing?.category || GARMENT_CATEGORIES[0], options: GARMENT_CATEGORIES, required: true })}
      ${field({ label: 'Description', name: 'description', type: 'textarea', value: existing?.description, full: true, placeholder: 'Cut, neckline, embroidery, closures…' })}
      <div class="field span-2"><label>Photos &amp; reference images</label>
        <div class="row-wrap"><div class="photo-strip" data-imgs></div><label class="upload-tile" style="position:relative">${icon('upload', 18)}<span>Add</span><input type="file" accept="image/*" multiple data-file></label></div>
        <p class="field-hint">JPEG, PNG or WebP up to 8 MB each. Images are resized and stored on this device.</p></div>
      ${field({ label: `Estimated fabric (${unit})`, name: 'fabricYards', type: 'number', value: existing?.fabricYards ?? '', attrs: 'min="0"' })}
      ${field({ label: 'Production time (days)', name: 'productionDays', type: 'number', value: existing?.productionDays ?? '', attrs: 'min="0" step="1"' })}
      ${field({ label: 'Typical price', name: 'basePrice', type: 'number', value: existing?.basePrice ?? '', attrs: 'min="0"' })}
      ${field({ label: 'Tags', name: 'tags', value: (existing?.tags || []).join(', '), hint: 'Comma-separated, e.g. wedding, embroidery' })}
      <fieldset class="field span-2" style="border:0;padding:0;margin:0"><legend class="small strong mb-2">Required measurements</legend>
        <div class="row-wrap">${Object.entries(MEASUREMENT_FIELDS).map(([k, f]) => html`<label class="chip" style="cursor:pointer"><input type="checkbox" name="rm_${k}" ${existing?.requiredMeasurements?.includes(k) ? raw('checked') : ''} style="accent-color:var(--primary)"> ${f.label}</label>`)}</div></fieldset>
      ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: existing?.notes, full: true })}`,
    onOpen: (form) => {
      const strip = form.querySelector('[data-imgs]');
      const paint = () => { strip.innerHTML = String(html`${images.map((src, i) => html`<div class="ph"><img src="${src}" alt="Design image ${i + 1}"><button type="button" data-rm="${i}" aria-label="Remove image">${icon('x', 12)}</button></div>`)}`); };
      paint();
      form.querySelector('[data-file]').addEventListener('change', async (e) => {
        for (const f of e.target.files) { try { images.push(await readImage(f)); } catch (err) { toastError(err); } }
        e.target.value = ''; paint();
      });
      strip.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { images.splice(Number(b.dataset.rm), 1); paint(); } });
    },
    onSubmit: (d) => saveDesign({
      ...(existing || {}), name: d.name, category: d.category, description: d.description, images, notes: d.notes,
      fabricYards: d.fabricYards, productionDays: d.productionDays, basePrice: d.basePrice,
      tags: (d.tags || '').split(',').map(t => t.trim()).filter(Boolean),
      requiredMeasurements: Object.keys(MEASUREMENT_FIELDS).filter(k => d[`rm_${k}`]),
    }),
  });
  if (res && res !== true) toast(existing ? 'Design saved.' : 'Design added to your library.', { type: 'success' });
  return res;
}

export async function render(el) {
  el.innerHTML = String(html`${pageHeader({ title: 'Designs & Styles' })}${skeleton(4)}`);
  const [designs, orders] = await Promise.all([getAll('designs'), getAll('orders')]);
  const usage = new Map();
  orders.forEach(o => o.designId && usage.set(o.designId, (usage.get(o.designId) || 0) + 1));
  const ui = { q: '', cat: '' };
  const cats = GARMENT_CATEGORIES.filter(c => designs.some(d => d.category === c));

  el.innerHTML = String(html`
    ${pageHeader({ title: 'Designs & Styles', subtitle: 'Your style library — reuse designs when creating orders', actions: html`<button class="btn btn-primary" data-act="add">${icon('plus', 16)} Add design</button>` })}
    <div class="toolbar"><div class="search">${icon('search', 16)}<label class="sr-only" for="d-q">Search designs</label><input id="d-q" class="input" type="search" placeholder="Search name, tag or description"></div></div>
    ${cats.length ? html`<div class="row-wrap mb-4" role="group" aria-label="Category filter"><button class="chip" data-cat="" aria-pressed="true">All</button>${cats.map(c => html`<button class="chip" data-cat="${c}" aria-pressed="false">${c}</button>`)}</div>` : ''}
    <div id="d-grid"></div>`);
  const grid = el.querySelector('#d-grid');
  const paint = () => {
    const q = ui.q.toLowerCase();
    const rows = designs.filter(d => (!ui.cat || d.category === ui.cat) && (!q || d.nameLower.includes(q) || (d.description || '').toLowerCase().includes(q) || (d.tags || []).some(t => t.toLowerCase().includes(q))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!designs.length) { grid.innerHTML = String(html`<div class="card">${emptyState({ icon: 'shirt', title: 'Build your style library', text: 'Save agbada, senator, kaftan, gown and suit styles with photos, fabric needs and production time. Reuse them when taking orders.', action: html`<button class="btn btn-primary" data-act="add">${icon('plus', 16)} Add first design</button>` })}</div>`); return; }
    if (!rows.length) { grid.innerHTML = String(html`<div class="card">${emptyState({ icon: 'search', title: 'No designs match' })}</div>`); return; }
    grid.innerHTML = String(html`<div class="gallery">${rows.map(d => html`<article class="card card-link design-card" data-id="${d.id}" tabindex="0" role="button" aria-label="Open ${d.name}">
      <div class="design-thumb">${d.images?.[0] ? html`<img src="${d.images[0]}" alt="" loading="lazy">` : icon('shirt', 40)}</div>
      <div class="design-meta"><strong>${d.name}</strong><div class="row-wrap">${badge(d.category, 'gold')}${usage.get(d.id) ? html`<span class="xs subtle">${usage.get(d.id)} order(s)</span>` : ''}</div>
      ${d.fabricYards || d.productionDays ? html`<span class="xs muted">${d.fabricYards ? `${d.fabricYards} ${getState().business?.fabricUnit || 'yd'}` : ''}${d.fabricYards && d.productionDays ? ' · ' : ''}${d.productionDays ? `${d.productionDays} days` : ''}</span>` : ''}</div>
    </article>`)}</div>`);
  };
  paint();

  const open = async (id) => {
    const d = designs.find(x => x.id === id);
    let i = 0;
    const m = openModal({
      title: d.name, size: 'lg',
      body: html`<div class="grid-2" style="align-items:start">
        <div class="stack-sm"><div class="design-thumb" style="border-radius:var(--r)" data-main>${d.images?.[0] ? html`<img src="${d.images[0]}" alt="${d.name}">` : icon('shirt', 48)}</div>
          ${d.images?.length > 1 ? html`<div class="photo-strip">${d.images.map((src, k) => html`<div class="ph"><img src="${src}" alt="View ${k + 1}" data-k="${k}"></div>`)}</div>` : ''}</div>
        <div class="stack"><div class="row-wrap">${badge(d.category, 'gold')}${(d.tags || []).map(t => badge(t, 'neutral'))}</div>
          ${d.description ? html`<p class="small" style="white-space:pre-wrap">${d.description}</p>` : ''}
          <dl class="kv"><dt>Fabric</dt><dd>${d.fabricYards ? `${d.fabricYards} ${getState().business?.fabricUnit || 'yards'} (estimate)` : '—'}</dd>
          <dt>Production</dt><dd>${d.productionDays ? `${d.productionDays} days` : '—'}</dd>
          <dt>Typical price</dt><dd>${d.basePrice ? money(d.basePrice) : '—'}</dd>
          <dt>Measurements</dt><dd>${(d.requiredMeasurements || []).map(k => MEASUREMENT_FIELDS[k]?.label || k).join(', ') || '—'}</dd>
          <dt>Used in</dt><dd>${usage.get(d.id) || 0} order(s)</dd></dl>
          ${d.notes ? html`<p class="small muted" style="white-space:pre-wrap">${d.notes}</p>` : ''}</div></div>`,
      footer: html`<button class="btn btn-danger-ghost" data-m="delete">${icon('trash-2', 16)} Delete</button><span class="spacer"></span><button class="btn btn-secondary" data-m="edit">${icon('pencil', 16)} Edit</button><a class="btn btn-primary" href="#/orders/new?design=${d.id}" data-close>${icon('plus', 16)} Use in order</a>`,
    });
    m.dialog.addEventListener('click', async (e) => {
      const img = e.target.closest('[data-k]');
      if (img) { i = Number(img.dataset.k); m.dialog.querySelector('[data-main]').innerHTML = String(html`<img src="${d.images[i]}" alt="${d.name}">`); }
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'edit') { m.close(); if (await openDesignForm(d)) render(el); }
      if (b.dataset.m === 'delete') {
        if (!(await confirmDialog({ title: `Delete ${d.name}?`, message: 'The design and its images will be removed. Orders keep their own details.', confirmLabel: 'Delete', danger: true }))) return;
        try { await deleteDesign(d.id); m.close(); toast('Design deleted.', { type: 'success' }); render(el); } catch (err) { toastError(err); }
      }
    });
  };

  el.querySelector('#d-q').addEventListener('input', debounce(e => { ui.q = e.target.value.trim(); paint(); }, 120));
  const offs = [
    delegate(el, 'click', '[data-act="add"]', async () => { if (await openDesignForm()) render(el); }),
    delegate(el, 'click', '[data-cat]', (e, b) => { ui.cat = b.dataset.cat; el.querySelectorAll('[data-cat]').forEach(c => c.setAttribute('aria-pressed', c === b)); paint(); }),
    delegate(el, 'click', '.design-card', (e, c) => open(c.dataset.id)),
    delegate(el, 'keydown', '.design-card', (e, c) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(c.dataset.id); } }),
  ];
  return () => offs.forEach(f => f());
}
