import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateFabric, calibrationFromLogs } from '../js/core/fabric-engine.js';
import { DEFAULT_FABRIC_RULES } from '../js/core/defaults.js';

const shirt = DEFAULT_FABRIC_RULES.find(r => r.id === 'rule-shirt'); // 2×shirtLength + sleeve + 20cm, 150cm ref, 10% waste

test('estimate follows the rule formula at reference width', () => {
  const r = estimateFabric(shirt, { measurements: { shirtLength: 78, sleeve: 63 }, unit: 'cm', fabricWidthCm: 150, outputUnit: 'm' });
  // 2*78 + 63 + 20 = 239 cm per garment; +10% waste = 262.9 cm -> rounded up to 2.75 m
  assert.equal(r.perGarment, 2.39);
  assert.equal(r.waste, 0.24);
  assert.equal(r.quantity, 2.75);
  assert.equal(r.usedFallback, false);
  assert.equal(r.widthFactor, 1);
});

test('narrower fabric needs proportionally more length', () => {
  const wide = estimateFabric(shirt, { measurements: { shirtLength: 78, sleeve: 63 }, fabricWidthCm: 150, outputUnit: 'm' });
  const narrow = estimateFabric(shirt, { measurements: { shirtLength: 78, sleeve: 63 }, fabricWidthCm: 112, outputUnit: 'm' });
  assert.ok(narrow.perGarment > wide.perGarment);
  assert.equal(narrow.widthFactor, 1.34);
  const wider = estimateFabric(shirt, { measurements: { shirtLength: 78, sleeve: 63 }, fabricWidthCm: 160, outputUnit: 'm' });
  assert.equal(wider.widthFactor, 1, 'wider fabric is never assumed to save fabric');
});

test('inches are converted before applying the rule', () => {
  const cm = estimateFabric(shirt, { measurements: { shirtLength: 76.2, sleeve: 63.5 }, unit: 'cm', outputUnit: 'yd' });
  const inch = estimateFabric(shirt, { measurements: { shirtLength: 30, sleeve: 25 }, unit: 'in', outputUnit: 'yd' });
  assert.equal(cm.quantity, inch.quantity);
});

test('missing measurements fall back to the typical size and say so', () => {
  const r = estimateFabric(shirt, { measurements: { shirtLength: 78 }, outputUnit: 'm' });
  assert.equal(r.usedFallback, true);
  assert.deepEqual(r.missing, ['sleeve']);
  assert.equal(r.perGarment, 2.3); // fallbackCm 230
});

test('multiple garments, fit adjustment, allowance and cost', () => {
  const r = estimateFabric(shirt, { measurements: { shirtLength: 78, sleeve: 63 }, garments: 3, sizeAdjustPct: 10, extraAllowanceCm: 5, outputUnit: 'yd', pricePerUnit: 4500 });
  // per garment: (239 * 1.1 + 5) = 267.9 cm; net 803.7 cm; +10% = 884.07 cm = 9.668 yd -> 9.75
  assert.equal(r.quantity, 9.75);
  assert.equal(r.cost, 43875);
});

test('rule calibration scales the estimate', () => {
  const base = estimateFabric(shirt, { measurements: { shirtLength: 78, sleeve: 63 }, outputUnit: 'm' });
  const cal = estimateFabric({ ...shirt, calibration: 1.1 }, { measurements: { shirtLength: 78, sleeve: 63 }, outputUnit: 'm' });
  assert.equal(cal.perGarment, Math.round(base.perGarment * 1.1 * 100) / 100);
});

test('invalid input is rejected', () => {
  assert.throws(() => estimateFabric(shirt, { fabricWidthCm: 0 }), /width/);
  assert.throws(() => estimateFabric(null, {}));
});

test('calibration needs at least three logs and uses the median', () => {
  assert.equal(calibrationFromLogs([{ estimated: 2, actual: 2.2 }, { estimated: 2, actual: 2.2 }]), null);
  const c = calibrationFromLogs([{ estimated: 2, actual: 2.2 }, { estimated: 2, actual: 2.4 }, { estimated: 2, actual: 5 }]);
  assert.deepEqual(c, { factor: 1.2, samples: 3 }, 'outlier does not dominate');
  const undo = calibrationFromLogs([{ estimated: 2.2, actual: 2.2, calibrationAtTime: 1.1 }, { estimated: 2.2, actual: 2.2, calibrationAtTime: 1.1 }, { estimated: 2.2, actual: 2.2, calibrationAtTime: 1.1 }]);
  assert.equal(undo.factor, 1.1, 'estimates already calibrated are normalised back to the raw rule');
});
