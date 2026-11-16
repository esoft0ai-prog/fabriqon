# Fabriqon — TikTok launch kit

**Video:** `fabriqon-promo.mp4`: 1080×1920 (9:16), 40 s, 30 fps, H.264. It has no audio on purpose: add a trending sound in TikTok's editor, because sounds picked inside TikTok get more reach and avoid copyright mutes.
**Cover:** pick the logo frame at about 0:05 in TikTok's cover picker. It's also saved as `cover.jpg`.

## Caption options (pick one)

1. Tailors 🪡 how many measurements have you lost in a notebook? I built Fabriqon so you never lose one again: customers, measurements, orders, payments and fabric, all in your phone. Works even without internet. Comment "FABRIQON" for early access 👇
2. POV: your customer asks "is my agbada ready?" and you actually know the answer 😌✂️ Fabriqon tracks every order from cutting to collection. Comment "FABRIQON" to try it first.
3. Fashion designers, this one's for you 🇳🇬 Measurements, deposits, balances, invoices and how many yards to buy, sorted. No more "who still owes me?" 😅 #Fabriqon

## Hashtags

`#tailor #tailoring #fashiondesigner #lagostailor #nigeriantailor #asoebi #agbada #senatorwear #sewing #fashionbusiness #smallbusinessnigeria #tailoringbusiness #madeinnigeria #techforgood #fabriqon`

## On-screen text if you re-cut it in TikTok (optional)

- 0:00 "Still using a notebook? 📒"
- 0:11 "Measuring a customer 👇"
- 0:22 "Who owes you? Sorted."
- 0:31 "No data? Still works."

## Posting tips

- Post when your audience scrolls: evenings, 7–10 pm WAT.
- Pin a comment saying "Comment FABRIQON and I'll send you the link 🔗", then reply to everyone. Replies boost reach.
- Follow up with short clips showing one feature each (measuring screen, invoice, offline mode). Series do well.
- Before you add a real link anywhere, deploy the app (see the main README → Deployment).

## Re-rendering after edits

Captions and timing live in `promo.js` (`SCENES`) and `promo.html` (hook, logo and call-to-action text). With the app running (`npm start`):

```bash
npm install --prefix promo puppeteer ffmpeg-static
node promo/render.mjs --stills 3,10,20,38
node promo/render.mjs
```

The first `render.mjs` command saves a few still frames to check quickly. The second renders the full video to `promo/fabriqon-promo.mp4`. Preview it live in a browser at `http://localhost:5173/promo/promo.html?play`.
