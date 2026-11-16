// Offline tailoring guidance used by the assistant when no AI provider is
// configured. General guidance only — not a guaranteed diagnosis.

export const KNOWLEDGE = [
  // ---- Sewing machine problems ----
  { id: 'skipped', cat: 'Sewing problems', title: 'Skipped stitches', k: ['skip', 'skipped', 'skipping', 'missing stitch', 'miss'],
    a: `Common causes, most likely first:
• Wrong or dull needle — change it. Use ballpoint/stretch needles for knits, sharp/microtex for tightly woven fabrics, and a size that suits the fabric thickness.
• Needle inserted incorrectly — flat side to the back (on most domestic machines), pushed fully up.
• Timing slightly off after a needle strike — if a new needle doesn't help, the hook timing may need a technician.
• Thread too thick for the needle eye.
• Fabric lifting with the needle — check presser-foot pressure.` },
  { id: 'breaking', cat: 'Sewing problems', title: 'Thread keeps breaking', k: ['thread break', 'breaking', 'snap', 'thread cut', 'shred'],
    a: `Check in this order:
• Re-thread the machine completely with the presser foot UP so the thread seats in the tension discs.
• Top tension too tight — loosen slightly and test on a scrap.
• Burr or rough spot on the needle, plate or hook — change the needle; feel the throat plate for nicks.
• Old or poor-quality thread — it becomes brittle.
• Needle eye too small for the thread.
• Thread catching on the spool notch or spool cap.` },
  { id: 'pucker', cat: 'Sewing problems', title: 'Seam puckering', k: ['pucker', 'puckering', 'wrinkle', 'gather', 'ripple'],
    a: `Likely causes:
• Tension too tight — reduce top tension.
• Stitch length too short for the fabric — lengthen slightly (2.5–3 mm for most wovens).
• Needle too large or blunt for fine fabric (chiffon, silk) — use a fine sharp needle (60/8–70/10) and fine thread.
• Fabric pulled or pushed while sewing — let the feed dogs do the work.
• Seam on the bias stretching — stabilise with stay tape or interfacing.
• Mixing threads/fabrics that shrink differently — pre-wash fabric.` },
  { id: 'loops', cat: 'Sewing problems', title: 'Loops or a “bird’s nest” under the fabric', k: ['loop', 'loops', 'nest', 'birds nest', 'tangle', 'bunch underneath', 'underneath'],
    a: `Loops on the underside almost always mean the TOP thread has no tension:
• Re-thread with the presser foot raised so the thread goes between the tension discs.
• Make sure the take-up lever is threaded.
• Hold both thread tails for the first few stitches.
• Check the bobbin is wound evenly and inserted the right way.` },
  { id: 'needle-break', cat: 'Sewing problems', title: 'Needle breaking', k: ['needle break', 'needle broke', 'needle breaking', 'broken needle'],
    a: `• Needle too fine for thick layers (denim, aso-oke seams) — use 100/16 or larger.
• Pulling the fabric while sewing bends the needle onto the plate.
• Sewing over pins — remove pins as you reach them.
• Loose needle clamp screw.
• Presser foot not suited to the stitch (e.g. zigzag with a straight-stitch foot).` },
  { id: 'feed', cat: 'Sewing problems', title: 'Fabric not moving / uneven feeding', k: ['not feeding', 'not moving', 'stuck', 'uneven feed', 'layers shift', 'feed'],
    a: `• Feed dogs lowered (darning mode) — raise them.
• Stitch length set to 0.
• Lint packed under the throat plate — remove plate and brush out.
• Presser foot pressure too light/heavy for the fabric.
• For slippery or layered fabrics, use a walking foot or tissue paper underneath.` },
  { id: 'uneven', cat: 'Sewing problems', title: 'Uneven or wavy stitches on stretch fabric', k: ['wavy', 'stretch', 'knit', 'jersey', 'lettuce', 'stretched seam'],
    a: `• Use a ballpoint/stretch needle and a narrow zigzag or stretch stitch.
• Reduce presser-foot pressure; consider a walking foot.
• Don’t pull the fabric through.
• Stabilise shoulder seams with clear elastic or stay tape.` },
  // ---- Measurements ----
  { id: 'ease', cat: 'Measurements', title: 'What is ease?', k: ['ease', 'allowance', 'how loose', 'fit allowance', 'wearing ease'],
    a: `Ease is the extra room added to a body measurement so a garment can be worn and moved in. Wearing ease is the minimum for comfort (often around 5–10 cm at the chest for fitted wovens); design ease is extra fullness for the style (kaftans and agbadas have a lot). Seam allowance is different — it is the fabric beyond the stitching line.` },
  { id: 'inseam', cat: 'Measurements', title: 'Inseam vs outseam', k: ['inseam', 'outseam', 'inside leg', 'outside leg', 'trouser length'],
    a: `Inseam: crotch to the desired hem along the inside leg. Outseam: waist to the hem along the outside of the leg. The difference between them is roughly the crotch depth (rise).` },
  { id: 'crotch', cat: 'Measurements', title: 'Crotch / rise', k: ['crotch', 'rise', 'crotch depth', 'seat'],
    a: `Crotch depth (rise) is measured seated: from the waist down to the chair seat at the side. Full crotch length is measured from centre-front waist, between the legs, to centre-back waist. Getting this right prevents trousers that pull or sag.` },
  { id: 'round-sleeve', cat: 'Measurements', title: 'Round sleeve, armhole and shoulder', k: ['round sleeve', 'bicep', 'armhole', 'shoulder', 'arm round'],
    a: `Round sleeve: around the fullest part of the upper arm (bicep), usually with the arm relaxed — add ease for comfort. Armhole: around the arm at the shoulder joint, passing under the armpit. Shoulder: across the back from one shoulder point (where the shoulder bone ends) to the other.` },
  { id: 'bust', cat: 'Measurements', title: 'Bust, under-bust and bust point', k: ['bust', 'under bust', 'underbust', 'bust point', 'nipple', 'apex'],
    a: `Bust: around the fullest part of the chest, tape level across the back. Under-bust: directly under the breasts, snug. Bust point (apex) and shoulder-to-bust-point measurements help place darts correctly on fitted gowns and blouses.` },
  { id: 'measure-tips', cat: 'Measurements', title: 'Tips for accurate measuring', k: ['measure tips', 'accurate', 'how to measure', 'measuring tips', 'tape'],
    a: `• Measure over light clothing, never over thick jackets.
• Keep the tape level and snug but not tight — you should slip one finger under it.
• Ask the customer to stand naturally, not hold their breath.
• Note posture (forward shoulders, sway back) in the notes field.
• Re-measure customers for important outfits; Fabriqon keeps every version so you can compare.` },
  // ---- Construction ----
  { id: 'agbada', cat: 'Garment construction', title: 'Agbada — typical construction order', k: ['agbada', 'grand boubou', 'babanriga'],
    a: `A common order for a 3-piece agbada:
1. Confirm measurements, design and embroidery placement.
2. Cut the agbada body (usually from a wide panel folded at the shoulder), the inner top (buba/dashiki) and the sokoto (trousers).
3. Do embroidery on the agbada before assembling, if any.
4. Finish neckline (often with a facing), side seams and the wide sleeve openings.
5. Sew the inner top: shoulders, neck, sleeves, side seams, hem.
6. Sew trousers: crotch, inseams, waistband (drawstring or elastic), hems.
7. Press everything and do a final fitting.
Fabric needs vary a lot with width and design — use the Fabric Calculator and adjust from your own experience.` },
  { id: 'senator', cat: 'Garment construction', title: 'Senator wear — typical construction order', k: ['senator', 'native top', 'kaftan top'],
    a: `1. Cut top (front, back, sleeves, collar/placket) and trousers.
2. Interface collar, placket and cuffs.
3. Sew shoulders, attach placket, then collar.
4. Attach sleeves, sew side seams, add cuffs.
5. Hem top; add buttons/embellishments.
6. Trousers: darts or pleats, pockets, side and inseams, crotch, waistband, hem.
7. Press and fit.` },
  { id: 'trousers', cat: 'Garment construction', title: 'Trousers — construction order', k: ['trouser', 'pants', 'sokoto', 'slacks'],
    a: `1. Cut fronts, backs, pockets, waistband; mark darts and pleats.
2. Sew darts/pleats and back pockets.
3. Make side pockets, then sew side seams.
4. Insert the fly zip.
5. Sew inseams, then the crotch seam.
6. Attach waistband and belt loops; buttonhole.
7. Try on, mark and sew hems.` },
  { id: 'dress-zip', cat: 'Garment construction', title: 'Fitted gown with zip — construction order', k: ['gown', 'dress', 'zip', 'zipper', 'invisible zip'],
    a: `1. Cut bodice, skirt, lining and facings; mark darts.
2. Sew darts on bodice and skirt.
3. Sew shoulders, then side seams (leave zip opening).
4. Join bodice to skirt.
5. Insert the invisible zip before closing the centre-back seam below it.
6. Attach lining or facings, then sleeves.
7. Fit, then hem.` },
  // ---- Fabrics ----
  { id: 'combos', cat: 'Fabrics', title: 'Fabric combinations that work well', k: ['combination', 'combine', 'match', 'pair', 'mix fabric', 'fabric combo'],
    a: `Popular pairings (always check colour and weight together in daylight):
• Aso-oke with lace — aso-oke for gele/ipele, lace for the blouse or iro.
• Ankara with plain cotton or lace trims — calm a busy print with a solid colour.
• Atiku or cashmere for senator/agbada with contrasting piping or embroidery thread.
• Brocade (guinea) with embroidery in a matching or metallic thread.
• Chiffon or organza overlays on satin or crepe for gowns.
Match fabric weights: very heavy fabrics pull light ones out of shape.` },
  { id: 'shrink', cat: 'Fabrics', title: 'Pre-washing and shrinkage', k: ['shrink', 'shrinkage', 'prewash', 'pre-wash', 'wash before'],
    a: `Cotton, linen and many Ankara prints can shrink when first washed. Pre-wash or steam-shrink washable fabric before cutting, especially for fitted garments. Don't pre-wash dry-clean-only fabrics (many laces, brocades, wools) — steam them instead. Add a little allowance when you can't pre-shrink.` },
  { id: 'lace', cat: 'Fabrics', title: 'Sewing lace', k: ['lace', 'cord lace', 'french lace', 'sewing lace'],
    a: `• Use a sharp, fine needle and slightly longer stitches.
• Underline or line lace so the body isn't visible unless that is the design.
• Use lapped (appliqué) seams around motifs for invisible joins on fine lace.
• Plan motif placement before cutting — lace usually needs extra fabric for matching.` },
  // ---- Business ----
  { id: 'pricing', cat: 'Business', title: 'How to price a garment', k: ['price', 'pricing', 'charge', 'how much', 'cost', 'quote', 'quotation'],
    a: `A simple, defensible method:
1. Materials: fabric (if you supply it), lining, interfacing, buttons, zips, thread.
2. Labour: estimated hours × your hourly rate (include cutting, fitting and finishing).
3. Overheads: rent, electricity/fuel, machine maintenance — often 10–30% on top.
4. Profit margin on top of the total.
Use the Pricing tool on this page, then compare with your local market. Remember rush jobs and heavy embroidery deserve more.` },
  { id: 'schedule', cat: 'Business', title: 'Planning production', k: ['schedule', 'plan', 'deadline', 'workload', 'prioritise', 'priority', 'organise', 'organize'],
    a: `• Work backwards from the delivery date: leave time for a fitting and corrections.
• Batch similar tasks — cut several orders in one session, then sew.
• Start the jobs with the least slack first (due soonest relative to the work left).
• Keep 1–2 days buffer for festive seasons when orders spike.
The Schedule tool on this page ranks your active orders by urgency using your real data.` },
  { id: 'deposit', cat: 'Business', title: 'Deposits and balances', k: ['deposit', 'advance', 'balance', 'owe', 'payment terms'],
    a: `Many tailors take 50–70% upfront, especially when buying fabric for the customer. Record every deposit in Fabriqon so the balance is always correct, and send a payment reminder from the order page when the outfit is ready.` },
];

const tokenize = (s) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 1);

/** Returns the best-matching guidance entries for a free-text question. */
export function searchKnowledge(query, limit = 3) {
  const q = query.toLowerCase();
  const words = new Set(tokenize(q));
  const scored = KNOWLEDGE.map(e => {
    let score = 0;
    for (const k of e.k) {
      if (q.includes(k)) score += k.split(' ').length * 3;
      else for (const w of tokenize(k)) if (words.has(w)) score += 1;
    }
    for (const w of tokenize(e.title)) if (words.has(w)) score += 1;
    return { e, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.e);
}
