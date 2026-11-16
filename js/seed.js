// Optional sample data so a new user can explore Fabriqon. Uses the same
// service functions as the UI, so every record is real and consistent.
import { createCustomer, saveMeasurement, saveDesign, createOrder, recordPayment, saveExpense, saveItem, saveSupplier, moveStock, saveAppointment, changeStage } from './services.js';
import { get, put, setSetting } from './database.js';
import { getState } from './state.js';
import { todayISO, addDays } from './utils.js';

const CUSTOMERS = [
  { name: 'Adebayo Ogunleye', phone: '08031234567', gender: 'Male', address: '14 Allen Avenue, Ikeja', notes: 'Prefers slim fit senator. Church events.' },
  { name: 'Chiamaka Eze', phone: '08029876543', gender: 'Female', address: 'Lekki Phase 1', notes: 'Likes mermaid gowns; allergic to wool.' },
  { name: 'Ibrahim Musa', phone: '08061122334', gender: 'Male', address: 'Wuse 2, Abuja', notes: 'Agbada with heavy embroidery.' },
  { name: 'Funmilayo Adeyemi', phone: '08097654321', gender: 'Female', address: 'Bodija, Ibadan' },
  { name: 'Tunde Bakare', phone: '08134455667', gender: 'Male', address: 'Yaba, Lagos', notes: 'Corporate suits, two-button.' },
  { name: 'Ngozi Okafor', phone: '07065544332', gender: 'Female', address: 'GRA, Enugu' },
  { name: 'Daniel Okon (child)', phone: '08023344556', gender: 'Child', address: 'Calabar', notes: 'Age 8. Parent: Mrs Okon.' },
  { name: 'Halima Bello', phone: '09012345678', gender: 'Female', address: 'Kano' },
];

const MEN = { chest: 102, shoulder: 47, sleeve: 63, roundSleeve: 36, wrist: 18, neck: 41, shirtLength: 78, waist: 88, hip: 100, thigh: 60, knee: 42, trouserLength: 104, inseam: 78, outseam: 104, ankle: 38, crotch: 27, armhole: 48 };
const WOMEN = { bust: 94, underBust: 80, waist: 76, hip: 104, shoulder: 39, sleeve: 58, roundSleeve: 30, dressLength: 140, blouseLength: 60, skirtLength: 100, armhole: 43, neck: 36, thigh: 60, knee: 39 };
const CHILD = { age: 8, chest: 64, waist: 58, shoulder: 31, sleeve: 44, shirtLength: 50, trouserLength: 72, hip: 68 };
const jitter = (vals, n) => Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, k === 'age' ? v : Math.round((v + (((n * 7 + k.length) % 9) - 4) * 0.5) * 10) / 10]));

export async function seedSampleData() {
  const t = todayISO();
  await setSetting('staff', [
    { id: 'staff-kunle', name: 'Kunle', role: 'Tailor', phone: '08030000001', active: true },
    { id: 'staff-amaka', name: 'Amaka', role: 'Tailor', phone: '08030000002', active: true },
    { id: 'staff-sani', name: 'Sani', role: 'Apprentice', phone: '08030000003', active: true },
  ]);
  getState().staff = [{ id: 'staff-kunle', name: 'Kunle', role: 'Tailor', active: true }, { id: 'staff-amaka', name: 'Amaka', role: 'Tailor', active: true }, { id: 'staff-sani', name: 'Sani', role: 'Apprentice', active: true }];

  const supA = await saveSupplier({ name: 'Balogun Market — Mama Titi Fabrics', phone: '08055550101', address: 'Balogun Market, Lagos Island' });
  const supB = await saveSupplier({ name: 'Ariaria Accessories', phone: '08055550202', address: 'Ariaria Market, Aba' });

  const atiku = await saveItem({ name: 'Navy Atiku', category: 'Fabric', unit: 'yards', quantity: 18, unitCost: 4500, minLevel: 6, supplierId: supA.id, color: 'Navy' });
  const cashmere = await saveItem({ name: 'Grey Cashmere', category: 'Fabric', unit: 'yards', quantity: 4, unitCost: 6500, minLevel: 5, supplierId: supA.id, color: 'Charcoal' });
  await saveItem({ name: 'Wine Cord Lace', category: 'Fabric', unit: 'yards', quantity: 10, unitCost: 9000, minLevel: 5, supplierId: supA.id, color: 'Wine' });
  await saveItem({ name: 'Polyester thread (black)', category: 'Thread', unit: 'cones', quantity: 12, unitCost: 900, minLevel: 4, supplierId: supB.id });
  await saveItem({ name: 'Invisible zips 22"', category: 'Zips', unit: 'pieces', quantity: 3, unitCost: 300, minLevel: 10, supplierId: supB.id });
  await saveItem({ name: 'Gold buttons 15mm', category: 'Buttons', unit: 'packs', quantity: 8, unitCost: 1500, minLevel: 2, supplierId: supB.id });
  await saveItem({ name: 'Fusible interfacing', category: 'Interfacing', unit: 'yards', quantity: 15, unitCost: 700, minLevel: 5, supplierId: supB.id });

  const dSen = await saveDesign({ name: 'Classic Senator 2-piece', category: 'Senator wear', description: 'Mandarin collar, concealed placket, side slits, straight trousers.', fabricYards: 4, productionDays: 7, basePrice: 35000, tags: ['senator', 'men'], requiredMeasurements: ['chest', 'shoulder', 'sleeve', 'shirtLength', 'waist', 'trouserLength'], images: [] });
  const dAgb = await saveDesign({ name: 'Embroidered Agbada set', category: 'Agbada', description: 'Three-piece agbada with chest embroidery, inner top and sokoto.', fabricYards: 9, productionDays: 14, basePrice: 120000, tags: ['agbada', 'wedding'], requiredMeasurements: ['chest', 'shoulder', 'shirtLength', 'trouserLength'], images: [] });
  const dGown = await saveDesign({ name: 'Mermaid lace gown', category: 'Dresses', description: 'Fitted bodice, flared mermaid skirt, illusion sleeves.', fabricYards: 5, productionDays: 10, basePrice: 85000, tags: ['owambe', 'lace'], requiredMeasurements: ['bust', 'waist', 'hip', 'dressLength'], images: [] });
  const dSuit = await saveDesign({ name: 'Two-button business suit', category: 'Suits', description: 'Notch lapel, half-lined, flat-front trousers.', fabricYards: 3.5, productionDays: 12, basePrice: 95000, tags: ['corporate'], requiredMeasurements: ['chest', 'shoulder', 'sleeve', 'waist', 'trouserLength'], images: [] });

  const cs = [];
  for (const c of CUSTOMERS) cs.push(await createCustomer(c, { allowDuplicate: true }));

  const ms = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const tpl = c.gender === 'Female' ? { id: 'tpl-women', name: 'Women', v: WOMEN } : c.gender === 'Child' ? { id: 'tpl-children', name: 'Children', v: CHILD } : { id: 'tpl-men', name: 'Men', v: MEN };
    if (i % 3 === 0) await saveMeasurement({ customerId: c.id, templateId: tpl.id, templateName: tpl.name, unit: 'cm', values: jitter(tpl.v, i + 11), notes: 'Earlier measurement', takenAt: new Date(Date.now() - 200 * 86400000).toISOString() });
    ms.push(await saveMeasurement({ customerId: c.id, templateId: tpl.id, templateName: tpl.name, unit: 'cm', values: jitter(tpl.v, i), notes: i === 0 ? 'Slightly forward shoulders.' : '' }));
  }

  // [customer, design, title, category, items, daysAgo, dueIn, status, deposit, extraPay, staff]
  const plan = [
    [0, dSen, 'Senator for thanksgiving', 'Senator wear', [['Senator 2-piece sewing', 1, 35000]], 170, -160, 'delivered', 20000, 15000, 'staff-kunle'],
    [2, dAgb, 'Wedding agbada (groom)', 'Agbada', [['Agbada 3-piece sewing', 1, 120000], ['Hand embroidery', 1, 30000]], 140, -125, 'delivered', 100000, 50000, 'staff-kunle'],
    [1, dGown, 'Lace gown for 40th birthday', 'Dresses', [['Mermaid gown sewing', 1, 85000]], 110, -98, 'delivered', 50000, 35000, 'staff-amaka'],
    [4, dSuit, 'Two suits for new job', 'Suits', [['Business suit', 2, 95000]], 80, -65, 'delivered', 100000, 90000, 'staff-kunle'],
    [3, null, 'Ankara skirt and blouse', 'Blouses', [['Skirt & blouse sewing', 1, 25000]], 50, -38, 'delivered', 25000, 0, 'staff-sani'],
    [5, dGown, 'Bridesmaid gowns', 'Dresses', [['Bridesmaid gown', 3, 55000]], 25, 4, 'sewing', 100000, 0, 'staff-amaka'],
    [0, dSen, 'Senator — navy atiku', 'Senator wear', [['Senator 2-piece sewing', 1, 38000]], 12, -1, 'finishing', 20000, 0, 'staff-kunle'],
    [6, null, "Boy's native set", "Children's clothing", [['Kids kaftan & trousers', 1, 15000]], 9, 2, 'ready', 8000, 0, 'staff-sani'],
    [7, null, 'Abaya with embellishment', 'Traditional clothing', [['Abaya sewing', 1, 45000], ['Stone embellishment', 1, 12000]], 6, 9, 'cutting', 30000, 0, 'staff-amaka'],
    [2, dAgb, 'Sallah agbada', 'Agbada', [['Agbada 3-piece sewing', 1, 130000]], 3, 18, 'sourcing', 60000, 0, 'staff-kunle'],
    [4, dSuit, 'Charcoal suit', 'Suits', [['Business suit', 1, 98000]], 1, 14, 'measured', 0, 0, ''],
  ];
  const orders = [];
  for (const [ci, design, title, cat, items, ago, dueIn, status, deposit, extra, staffId] of plan) {
    const orderDate = addDays(t, -ago);
    const o = await createOrder({
      customerId: cs[ci].id, designId: design?.id || '', measurementId: ms[ci].id, garmentCategory: cat, title,
      items: items.map(([description, qty, unitPrice]) => ({ description, qty, unitPrice })), discount: 0,
      orderDate, dueDate: addDays(t, dueIn), assignedTo: staffId, status, deposit, depositMethod: ago % 2 ? 'Bank transfer' : 'Cash',
      fabricType: cat === 'Dresses' ? 'Lace' : cat === 'Senator wear' ? 'Atiku' : '', fabricQty: design?.fabricYards || 0, fabricUnit: 'yards',
      fabricItemId: title.includes('navy atiku') ? atiku.id : '',
    });
    if (extra > 0) await recordPayment({ orderId: o.id, amount: extra, method: 'Bank transfer', date: addDays(orderDate, Math.min(ago - 1, 12)) });
    if (status === 'delivered') {
      const cur = await get('orders', o.id);
      await put('orders', { ...cur, deliveredAt: new Date(`${addDays(orderDate, Math.max(6, ago + dueIn - 1))}T15:00:00`).toISOString() });
    }
    orders.push(o);
  }
  // A production update and stock deduction on the atiku senator.
  const senator = orders[6];
  await moveStock({ itemId: atiku.id, type: 'out', quantity: 4, orderId: senator.id, note: `Used for ${senator.number}`, markOrderDeducted: true });
  await moveStock({ itemId: cashmere.id, type: 'out', quantity: 3.5, note: 'Used for suit samples', date: addDays(t, -60) });
  await changeStage(orders[7].id, 'ready', { note: 'Pressed and bagged. Waiting for parent to collect.' });

  const exp = [
    ['Rent', 60000, 3], ['Rent', 60000, 33], ['Rent', 60000, 63], ['Rent', 60000, 93], ['Rent', 60000, 123], ['Rent', 60000, 153],
    ['Electricity / fuel', 18000, 5], ['Electricity / fuel', 22000, 35], ['Electricity / fuel', 15000, 70], ['Electricity / fuel', 20000, 100],
    ['Wages', 45000, 20], ['Wages', 45000, 50], ['Wages', 45000, 80], ['Wages', 40000, 110],
    ['Machine repairs', 12000, 44], ['Transport', 6000, 15], ['Materials', 27000, 20], ['Marketing', 10000, 55],
  ];
  for (const [category, amount, ago] of exp) await saveExpense({ category, amount, date: addDays(t, -ago), description: category === 'Rent' ? 'Shop rent' : category === 'Wages' ? 'Apprentice & tailor wages' : category });

  const at = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const appt = (title, type, ci, days, h, mins, orderId = '') => saveAppointment({ title, type, customerId: cs[ci].id, orderId, start: at(days, h).toISOString(), end: new Date(at(days, h).getTime() + mins * 60000).toISOString(), notes: '' });
  await appt('Fitting — bridesmaid gowns', 'fitting', 5, 1, 11, 60, orders[5].id);
  await appt('Measure for Sallah agbada', 'measurement', 2, 0, 16, 30, orders[9].id);
  await appt('Collection — native set', 'collection', 6, 2, 10, 20, orders[7].id);
  await appt('Fitting — charcoal suit', 'fitting', 4, 5, 13, 45, orders[10].id);
}
