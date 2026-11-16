// First-run workspace setup wizard.
import { html, icon, field, raw, validateForm, readForm, toastError } from './ui.js';
import { transaction } from './database.js';
import { BUSINESS_TYPES, CURRENCIES, DEFAULT_TEMPLATES, DEFAULT_STAGES, DEFAULT_FABRIC_RULES } from './core/defaults.js';
import { readImage } from './utils.js';
import { hashPin } from './lock.js';

const TYPE_ICONS = ['scissors', 'palette', 'shopping-bag', 'factory', 'book-open'];

/** Writes the default configuration for a new workspace. */
export async function initWorkspace(business, { pin = null } = {}) {
  const pinRec = pin ? await hashPin(pin) : null;
  await transaction(['settings', 'measurementTemplates', 'activityLogs'], async (t) => {
    await t.put('settings', { key: 'business', value: { ...business, createdAt: new Date().toISOString() } });
    await t.put('settings', { key: 'stages', value: DEFAULT_STAGES });
    await t.put('settings', { key: 'fabricRules', value: DEFAULT_FABRIC_RULES });
    await t.put('settings', { key: 'staff', value: [] });
    await t.put('settings', { key: 'prefs', value: { backupReminderDays: 7, lockAfterMinutes: 10, browserNotifications: false } });
    if (pinRec) await t.put('settings', { key: 'pin', value: pinRec });
    for (const tpl of DEFAULT_TEMPLATES) {
      if (!(await t.get('measurementTemplates', tpl.id))) await t.add('measurementTemplates', tpl);
    }
    await t.add('activityLogs', { action: 'created', entity: 'workspace', entityId: '', summary: `Workspace created for ${business.name}`, at: new Date().toISOString() });
  });
}

export function runOnboarding(root) {
  return new Promise((resolve) => {
    const data = { type: BUSINESS_TYPES[0], currency: 'NGN', unit: 'cm', fabricUnit: 'yards', countryCode: '234' };
    let step = 0;
    let logo = '';

    const shell = (inner) => html`<div class="gate"><div class="gate-card">
      <div class="gate-brand"><img class="brand-mark" src="assets/icons/logo.svg" alt=""><strong>FABRI<span>QON</span></strong></div>
      <div class="steps" aria-hidden="true">${[0, 1, 2, 3].map(i => html`<span class="${i <= step ? 'on' : ''}"></span>`)}</div>
      ${inner}
      <p class="gate-credit">Developed by <strong>Abdullah</strong> · Esoft Dev</p>
    </div></div>`;

    const steps = [
      () => html`
        <h1 style="font-size:1.35rem">Set up your tailoring workspace</h1>
        <p class="muted small mt-2 mb-4">Step 1 of 4 · What best describes your business?</p>
        <form class="stack" data-step>
          <fieldset style="border:0;padding:0;margin:0">
            <legend class="sr-only">Business type</legend>
            <div class="option-cards">
              ${BUSINESS_TYPES.map((t, i) => html`<label class="option-card"><input type="radio" name="type" value="${t}" ${data.type === t ? raw('checked') : ''}>${icon(TYPE_ICONS[i], 22)}<span>${t}</span></label>`)}
            </div>
          </fieldset>
          <div class="row mt-4"><span class="spacer"></span><button class="btn btn-primary btn-lg">Continue ${icon('arrow-right', 18)}</button></div>
        </form>`,
      () => html`
        <h1 style="font-size:1.35rem">Business profile</h1>
        <p class="muted small mt-2 mb-4">Step 2 of 4 · Shown on invoices, receipts and customer messages.</p>
        <form class="form" data-step novalidate>
          ${field({ label: 'Business name', name: 'name', value: data.name, required: true, attrs: 'maxlength="80" autocomplete="organization"', full: true })}
          ${field({ label: 'Your full name', name: 'owner', value: data.owner, required: true, attrs: 'maxlength="80" autocomplete="name"' })}
          ${field({ label: 'Phone number', name: 'phone', type: 'tel', value: data.phone, required: true, attrs: 'maxlength="20" autocomplete="tel"' })}
          ${field({ label: 'Email', name: 'email', type: 'email', value: data.email, attrs: 'autocomplete="email"' })}
          ${field({ label: 'Country', name: 'country', value: data.country || 'Nigeria', attrs: 'autocomplete="country-name"' })}
          ${field({ label: 'State', name: 'state', value: data.state })}
          ${field({ label: 'City', name: 'city', value: data.city })}
          ${field({ label: 'Shop address', name: 'address', value: data.address, full: true })}
          <div class="field span-2"><label>Logo (optional)</label>
            <div class="row"><div class="photo-strip" id="logo-prev">${logo ? html`<div class="ph"><img src="${logo}" alt="Logo preview"></div>` : ''}</div>
            <label class="upload-tile" style="position:relative">${icon('upload', 18)}<span>Upload</span><input type="file" accept="image/png,image/jpeg,image/webp" id="logo-input"></label></div>
          </div>
          <div class="row span-2 mt-2"><button type="button" class="btn btn-ghost" data-back>Back</button><span class="spacer"></span><button class="btn btn-primary btn-lg">Continue ${icon('arrow-right', 18)}</button></div>
        </form>`,
      () => html`
        <h1 style="font-size:1.35rem">Preferences</h1>
        <p class="muted small mt-2 mb-4">Step 3 of 4 · You can change these later in Settings.</p>
        <form class="form" data-step novalidate>
          ${field({ label: 'Currency', name: 'currency', type: 'select', value: data.currency, options: CURRENCIES.map(c => ({ value: c.code, label: c.label })), full: true })}
          ${field({ label: 'Body measurement unit', name: 'unit', type: 'select', value: data.unit, options: [{ value: 'cm', label: 'Centimetres (cm)' }, { value: 'in', label: 'Inches (in)' }] })}
          ${field({ label: 'Fabric unit', name: 'fabricUnit', type: 'select', value: data.fabricUnit, options: [{ value: 'yards', label: 'Yards' }, { value: 'metres', label: 'Metres' }] })}
          ${field({ label: 'Phone country code (for WhatsApp links)', name: 'countryCode', value: data.countryCode, attrs: 'inputmode="numeric" pattern="\\d{1,4}"', hint: 'e.g. 234 for Nigeria' })}
          ${field({ label: 'App PIN (optional)', name: 'pin', type: 'password', attrs: 'inputmode="numeric" pattern="\\d{4,8}" autocomplete="new-password"', hint: '4–8 digits. Deters casual access only — it does not encrypt your data.' })}
          <div class="row span-2 mt-2"><button type="button" class="btn btn-ghost" data-back>Back</button><span class="spacer"></span><button class="btn btn-primary btn-lg">Continue ${icon('arrow-right', 18)}</button></div>
        </form>`,
      () => html`
        <h1 style="font-size:1.35rem">Where your data lives</h1>
        <p class="muted small mt-2 mb-4">Step 4 of 4</p>
        <form class="stack" data-step novalidate>
          <div class="alert alert-warn">${icon('hard-drive', 18)}<div><strong>Your records are stored only in this browser on this device.</strong>
            They are not uploaded anywhere and do not sync to your other devices. Clearing browser data, uninstalling the browser or losing the device can erase them.
            Download a backup regularly (Settings → Data &amp; backup) and keep it somewhere safe, such as email or a USB drive.</div></div>
          ${field({ label: 'I understand that I am responsible for backing up my data', name: 'ack', type: 'checkbox', attrs: 'required' })}
          ${field({ label: 'Add sample customers and orders so I can explore (you can delete them later)', name: 'seed', type: 'checkbox' })}
          <div class="row mt-2"><button type="button" class="btn btn-ghost" data-back>Back</button><span class="spacer"></span><button class="btn btn-gold btn-lg" data-finish>${icon('check', 18)} Create workspace</button></div>
        </form>`,
    ];

    const paint = () => {
      root.innerHTML = String(shell(steps[step]()));
      const form = root.querySelector('[data-step]');
      root.querySelector('[data-back]')?.addEventListener('click', () => { Object.assign(data, readForm(form)); step--; paint(); });
      root.querySelector('#logo-input')?.addEventListener('change', async (e) => {
        try {
          logo = await readImage(e.target.files[0], { maxDim: 400 });
          root.querySelector('#logo-prev').innerHTML = String(html`<div class="ph"><img src="${logo}" alt="Logo preview"></div>`);
        } catch (err) { toastError(err); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validateForm(form)) return;
        const vals = readForm(form);
        delete vals.undefined;
        if (vals['logo-input'] !== undefined) delete vals['logo-input'];
        Object.assign(data, vals);
        if (step < steps.length - 1) { step++; paint(); window.scrollTo(0, 0); return; }
        const btn = form.querySelector('[data-finish]');
        btn.disabled = true;
        btn.classList.add('loading');
        try {
          const { pin, ack, seed, ...rest } = data;
          const business = { ...rest, name: rest.name.trim(), logo };
          await initWorkspace(business, { pin: pin || null });
          resolve({ seed: !!seed });
        } catch (err) {
          toastError(err);
          btn.disabled = false;
          btn.classList.remove('loading');
        }
      });
      root.querySelector('input:not([type=radio]):not([type=file])')?.focus();
    };
    paint();
  });
}
