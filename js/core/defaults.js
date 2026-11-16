// Domain defaults for Fabriqon. Pure data: safe to import from Node tests.

export const APP_NAME = 'Fabriqon';

/** Canonical measurement fields. Keys are shared across templates so the
 * fabric engine and comparisons can read any template consistently. */
export const MEASUREMENT_FIELDS = {
  age: { label: 'Age', unit: 'years' },
  chest: { label: 'Chest' },
  bust: { label: 'Bust' },
  underBust: { label: 'Under bust' },
  shoulder: { label: 'Shoulder' },
  sleeve: { label: 'Sleeve length' },
  roundSleeve: { label: 'Round sleeve (bicep)' },
  wrist: { label: 'Wrist / cuff' },
  neck: { label: 'Neck' },
  shirtLength: { label: 'Shirt / top length' },
  waist: { label: 'Waist' },
  hip: { label: 'Hip' },
  thigh: { label: 'Thigh' },
  knee: { label: 'Knee' },
  trouserLength: { label: 'Trouser length' },
  inseam: { label: 'Inseam' },
  outseam: { label: 'Outseam' },
  ankle: { label: 'Ankle / bottom' },
  crotch: { label: 'Crotch (rise)' },
  armhole: { label: 'Armhole' },
  dressLength: { label: 'Dress length' },
  blouseLength: { label: 'Blouse length' },
  skirtLength: { label: 'Skirt length' },
};

export const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-men', name: 'Men', group: 'men', builtIn: true,
    fields: ['chest', 'shoulder', 'sleeve', 'roundSleeve', 'wrist', 'neck', 'shirtLength', 'waist', 'hip', 'thigh', 'knee',
      'trouserLength', 'inseam', 'outseam', 'ankle', 'crotch', 'armhole'],
  },
  {
    id: 'tpl-women', name: 'Women', group: 'women', builtIn: true,
    fields: ['bust', 'underBust', 'waist', 'hip', 'shoulder', 'sleeve', 'roundSleeve', 'dressLength', 'blouseLength',
      'skirtLength', 'armhole', 'neck', 'thigh', 'knee', 'inseam', 'trouserLength'],
  },
  {
    id: 'tpl-children', name: 'Children', group: 'children', builtIn: true,
    fields: ['age', 'chest', 'waist', 'shoulder', 'sleeve', 'shirtLength', 'trouserLength', 'dressLength', 'hip'],
  },
];

export const DEFAULT_STAGES = [
  { key: 'received', label: 'Order received' },
  { key: 'measured', label: 'Measurements completed' },
  { key: 'sourcing', label: 'Fabric sourcing' },
  { key: 'cutting', label: 'Cutting' },
  { key: 'sewing', label: 'Sewing' },
  { key: 'finishing', label: 'Finishing' },
  { key: 'qc', label: 'Quality inspection' },
  { key: 'ready', label: 'Ready for collection' },
  { key: 'delivered', label: 'Delivered' },
];

/** Stage keys used for dashboard groupings. Custom stages fall into
 * "in production" by position (between the first and the "ready" stage). */
export const STAGE_GROUPS = {
  awaiting: ['received', 'measured', 'sourcing'],
  sewing: ['cutting', 'sewing', 'finishing', 'qc'],
  ready: ['ready'],
  done: ['delivered'],
};

export const GARMENT_CATEGORIES = [
  'Native wear', 'Agbada', 'Kaftan', 'Senator wear', 'Suits', 'Shirts', 'Trousers', 'Dresses', 'Skirts',
  'Blouses', 'Wedding outfits', "Children's clothing", 'Corporate wear', 'Traditional clothing', 'Custom designs',
];

export const INVENTORY_CATEGORIES = ['Fabric', 'Thread', 'Buttons', 'Zips', 'Needles', 'Lining', 'Interfacing', 'Accessories', 'Other'];
export const INVENTORY_UNITS = ['yards', 'metres', 'pieces', 'spools', 'packs', 'rolls', 'cones', 'pairs'];
export const EXPENSE_CATEGORIES = ['Materials', 'Rent', 'Wages', 'Electricity / fuel', 'Machine repairs', 'Transport', 'Marketing', 'Other'];
export const PAYMENT_METHODS = ['Cash', 'Bank transfer', 'Card / POS', 'Other'];
export const APPOINTMENT_TYPES = [
  { key: 'measurement', label: 'Measurement' },
  { key: 'fitting', label: 'Fitting' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'collection', label: 'Collection' },
  { key: 'other', label: 'Other' },
];

export const CURRENCIES = [
  { code: 'NGN', label: 'Nigerian Naira (₦)' },
  { code: 'GHS', label: 'Ghanaian Cedi (GH₵)' },
  { code: 'KES', label: 'Kenyan Shilling (KSh)' },
  { code: 'ZAR', label: 'South African Rand (R)' },
  { code: 'XOF', label: 'West African CFA (CFA)' },
  { code: 'USD', label: 'US Dollar ($)' },
  { code: 'GBP', label: 'British Pound (£)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'CAD', label: 'Canadian Dollar (CA$)' },
];

export const BUSINESS_TYPES = ['Independent tailor', 'Fashion designer', 'Tailoring shop', 'Fashion production company', 'Tailoring apprentice'];

/**
 * Fabric estimation rules. Every rule is editable by the business.
 * lengthCm = Σ(term.factor × measurement[term.key]) + allowanceCm, computed at
 * the rule's reference fabric width. Narrower fabric scales length up.
 * fallbackCm is used when the needed measurements are missing.
 */
export const DEFAULT_FABRIC_RULES = [
  { id: 'rule-shirt', garment: 'Shirt / native top', terms: [{ key: 'shirtLength', factor: 2 }, { key: 'sleeve', factor: 1 }], allowanceCm: 20, refWidthCm: 150, fallbackCm: 230, wastePct: 10, calibration: 1 },
  { id: 'rule-trouser', garment: 'Trousers', terms: [{ key: 'trouserLength', factor: 1 }], allowanceCm: 25, refWidthCm: 150, fallbackCm: 130, wastePct: 10, calibration: 1 },
  { id: 'rule-senator', garment: 'Senator (top + trousers)', terms: [{ key: 'shirtLength', factor: 2 }, { key: 'sleeve', factor: 1 }, { key: 'trouserLength', factor: 1 }], allowanceCm: 40, refWidthCm: 150, fallbackCm: 360, wastePct: 10, calibration: 1 },
  { id: 'rule-kaftan', garment: 'Kaftan', terms: [{ key: 'shirtLength', factor: 2 }, { key: 'sleeve', factor: 1 }], allowanceCm: 35, refWidthCm: 150, fallbackCm: 300, wastePct: 10, calibration: 1 },
  { id: 'rule-agbada', garment: 'Agbada (3-piece)', terms: [{ key: 'shirtLength', factor: 4 }, { key: 'trouserLength', factor: 1 }], allowanceCm: 120, refWidthCm: 150, fallbackCm: 730, wastePct: 12, calibration: 1 },
  { id: 'rule-suit', garment: 'Suit (jacket + trousers)', terms: [{ key: 'shirtLength', factor: 2 }, { key: 'sleeve', factor: 1 }, { key: 'trouserLength', factor: 1 }], allowanceCm: 45, refWidthCm: 150, fallbackCm: 320, wastePct: 12, calibration: 1 },
  { id: 'rule-dress', garment: 'Dress', terms: [{ key: 'dressLength', factor: 2 }, { key: 'sleeve', factor: 1 }], allowanceCm: 30, refWidthCm: 150, fallbackCm: 280, wastePct: 12, calibration: 1 },
  { id: 'rule-skirt', garment: 'Skirt', terms: [{ key: 'skirtLength', factor: 2 }], allowanceCm: 20, refWidthCm: 150, fallbackCm: 180, wastePct: 10, calibration: 1 },
  { id: 'rule-blouse', garment: 'Blouse', terms: [{ key: 'blouseLength', factor: 2 }, { key: 'sleeve', factor: 1 }], allowanceCm: 15, refWidthCm: 150, fallbackCm: 180, wastePct: 10, calibration: 1 },
  { id: 'rule-child', garment: "Children's outfit", terms: [{ key: 'shirtLength', factor: 2 }, { key: 'trouserLength', factor: 1 }], allowanceCm: 20, refWidthCm: 150, fallbackCm: 160, wastePct: 10, calibration: 1 },
];

export const FABRIC_WIDTHS = [
  { cm: 90, label: '36" (90 cm)' },
  { cm: 112, label: '44" (112 cm)' },
  { cm: 150, label: '58–60" (150 cm)' },
  { cm: 160, label: '63" (160 cm)' },
];

export const FABRIC_TYPES = ['Ankara / wax print', 'Cotton', 'Lace', 'Aso-oke', 'Guinea brocade', 'Atiku', 'Cashmere / wool', 'Linen', 'Chiffon', 'Satin', 'Silk', 'Denim', 'Other'];

/** Customer message templates. Placeholders: {customer} {business} {order} {due} {balance} {garment} {date} {time} {phone} */
export const MESSAGE_TEMPLATES = [
  { key: 'order_received', label: 'Order received', text: 'Hello {customer}, thank you for your order ({order} – {garment}) with {business}. Expected ready date: {due}. We will keep you updated.' },
  { key: 'production_started', label: 'Production started', text: 'Hello {customer}, work has started on your {garment} (order {order}). We are on track for {due}. – {business}' },
  { key: 'ready', label: 'Ready for collection', text: 'Good news {customer}! Your {garment} (order {order}) is ready for collection at {business}. Outstanding balance: {balance}. Call {phone} with any questions.' },
  { key: 'delivery_reminder', label: 'Delivery reminder', text: 'Hello {customer}, a reminder that your order {order} is due for delivery on {due}. – {business}' },
  { key: 'payment_reminder', label: 'Payment reminder', text: 'Hello {customer}, this is a friendly reminder that a balance of {balance} remains on order {order}. Thank you. – {business}' },
  { key: 'appointment_reminder', label: 'Appointment reminder', text: 'Hello {customer}, a reminder of your appointment with {business} on {date} at {time}. Reply to confirm or reschedule.' },
];
