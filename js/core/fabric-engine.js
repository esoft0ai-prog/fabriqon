// Configurable fabric estimation. Results are ESTIMATES: real consumption
// depends on the pattern, nap/print direction, cutting layout and technique.
import { convertLength, CM_PER_YARD } from './calc.js';

const roundUpTo = (n, step) => Math.ceil(n / step - 1e-9) * step;

/**
 * @param {object} rule  fabric rule (see DEFAULT_FABRIC_RULES)
 * @param {object} opts  { measurements: {key: value}, unit: 'cm'|'in', fabricWidthCm,
 *                         garments, sizeAdjustPct, extraAllowanceCm, outputUnit: 'yd'|'m', pricePerUnit }
 */
export function estimateFabric(rule, opts = {}) {
  const {
    measurements = {}, unit = 'cm', fabricWidthCm = rule.refWidthCm || 150, garments = 1,
    sizeAdjustPct = 0, extraAllowanceCm = 0, outputUnit = 'yd', pricePerUnit = 0,
  } = opts;
  if (!rule) throw new Error('Choose a garment rule.');
  const width = Number(fabricWidthCm);
  if (!(width > 0)) throw new Error('Fabric width must be greater than zero.');
  const count = Math.max(1, Math.floor(Number(garments) || 1));

  const used = [];
  const missing = [];
  let lengthCm = 0;
  for (const t of rule.terms || []) {
    const raw = measurements[t.key];
    if (raw === undefined || raw === null || raw === '' || !(Number(raw) > 0)) { missing.push(t.key); continue; }
    const cm = convertLength(Number(raw), unit, 'cm');
    used.push({ key: t.key, factor: t.factor, cm });
    lengthCm += cm * Number(t.factor || 0);
  }

  const usedFallback = missing.length > 0;
  let base = usedFallback ? Number(rule.fallbackCm || 0) : lengthCm + Number(rule.allowanceCm || 0);
  base *= 1 + Number(sizeAdjustPct || 0) / 100;
  base += Number(extraAllowanceCm || 0);

  // Narrower fabric => proportionally more length (rounded to whole panels is
  // left to the tailor; we scale continuously and say so).
  const widthFactor = Math.max(1, (rule.refWidthCm || 150) / width);
  const perGarmentCm = base * widthFactor * Number(rule.calibration || 1);
  const netCm = perGarmentCm * count;
  const wasteCm = netCm * Number(rule.wastePct || 0) / 100;
  const totalCm = netCm + wasteCm;

  const toOut = (cm) => outputUnit === 'm' ? cm / 100 : cm / CM_PER_YARD;
  const quantity = roundUpTo(toOut(totalCm), 0.25);
  return {
    garment: rule.garment,
    outputUnit,
    perGarment: Math.round(toOut(perGarmentCm) * 100) / 100,
    net: Math.round(toOut(netCm) * 100) / 100,
    waste: Math.round(toOut(wasteCm) * 100) / 100,
    quantity, // rounded up to the nearest quarter unit — what to buy
    cost: Math.round(quantity * Number(pricePerUnit || 0) * 100) / 100,
    widthFactor: Math.round(widthFactor * 100) / 100,
    usedFallback,
    missing,
    used,
    calibration: Number(rule.calibration || 1),
  };
}

/**
 * Learns a calibration factor from logged actual consumption.
 * Each log: { estimated, actual } in the same unit. Returns null if there is
 * not enough evidence (fewer than `min` logs).
 */
export function calibrationFromLogs(logs = [], currentCalibration = 1, min = 3) {
  const valid = logs.filter(l => Number(l.estimated) > 0 && Number(l.actual) > 0);
  if (valid.length < min) return null;
  // Logs record estimates made WITH the calibration in force at the time;
  // undo it so the ratio is against the raw rule.
  const ratios = valid.map(l => (Number(l.actual) / Number(l.estimated)) * Number(l.calibrationAtTime || currentCalibration || 1));
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { factor: Math.round(median * 100) / 100, samples: valid.length };
}
