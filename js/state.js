// In-memory cache of workspace configuration loaded from IndexedDB.
// Module-scoped (no globals); refreshed whenever settings change.
import { DEFAULT_STAGES, DEFAULT_FABRIC_RULES, MESSAGE_TEMPLATES } from './core/defaults.js';

const state = {
  business: null,      // profile: name, phone, email, address, logo, currency, unit, fabricUnit, countryCode, type
  stages: DEFAULT_STAGES,
  staff: [],           // [{id, name, role, phone, active}]
  fabricRules: DEFAULT_FABRIC_RULES,
  messageTemplates: MESSAGE_TEMPLATES,
  prefs: { backupReminderDays: 7, lockAfterMinutes: 10, browserNotifications: false },
  pin: null,           // { salt, hash, iterations } or null
  aiEndpoint: '',
};

export const getState = () => state;

export async function loadState(getSetting) {
  const [business, stages, staff, rules, templates, prefs, pin, ai] = await Promise.all([
    getSetting('business'), getSetting('stages'), getSetting('staff'), getSetting('fabricRules'),
    getSetting('messageTemplates'), getSetting('prefs'), getSetting('pin'), getSetting('aiEndpoint'),
  ]);
  state.business = business;
  state.stages = Array.isArray(stages) && stages.length >= 2 ? stages : DEFAULT_STAGES;
  state.staff = Array.isArray(staff) ? staff : [];
  state.fabricRules = Array.isArray(rules) && rules.length ? rules : DEFAULT_FABRIC_RULES;
  state.messageTemplates = Array.isArray(templates) && templates.length ? templates : MESSAGE_TEMPLATES;
  state.prefs = { ...state.prefs, ...(prefs || {}) };
  state.pin = pin || null;
  state.aiEndpoint = ai || '';
  return state;
}

export const stageLabel = (key) => state.stages.find(s => s.key === key)?.label || key;
export const stageIndex = (key) => state.stages.findIndex(s => s.key === key);
export const staffName = (id) => state.staff.find(s => s.id === id)?.name || '';
