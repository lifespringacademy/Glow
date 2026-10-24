# Glow — setup guide

Glow is a web app at **letsglowwww.com**. People open it in their phone's browser and add it to their home screen. There's no App Store step.

It runs on the same services as your lunch app: **Vercel** (hosting) and **Supabase** (database). It also uses **Stripe** for payments and the **Claude API** for checking Family Hunt photos.

Plan on about 1–2 hours for the whole setup. Do the steps in order.

---

## What's in this folder

| Path | What it is |
|---|---|
| `public/index.html` | The app people use (map, tour, Family Hunt, add a display) |
| `public/admin.html` | Your admin page at letsglowwww.com/admin |
| `public/privacy.html` | Privacy & terms page |
| `public/manifest.webmanifest`, `public/sw.js`, `public/icons/` | Home-screen app setup and icons |
| `api/` | Server functions (database, payments, photo checks) |
| `lib/` | Shared server code. `lib/finds.js` is the Family Hunt photo list |
| `supabase/schema.sql` | Creates the database tables |
| `vercel.json`, `package.json` | Vercel settings. No packages to install |

---

## Step 1 — Create the database (Supabase)

1. Go to **supabase.com** and click **New project**. Name it `glow` and pick the US East region. Save the database password somewhere safe.
2. When the project is ready, open **SQL Editor → New query**.
3. Open `supabase/schema.sql`, copy all of it, paste it in, and click **Run**. You should see "Success. No rows returned."
4. Go to **Project Settings → API** and copy two values for Step 3:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **service_role** key (under "Project API keys". Click **Reveal**.) This key is secret. Only ever paste it into Vercel.

> Free Supabase projects pause after a week with no visitors. Before launch, open the app now and then, or upgrade to Pro ($25/month) for the season.

## Step 2 — Put the code on GitHub

1. On your Chromebook, unzip `glow.zip` in the Files app.
2. Go to **github.com → New repository**. Name it `glow`, set it to **Private**, and click **Create repository**.
3. Click **uploading an existing file**. Open the unzipped `glow` folder, select everything inside it (`api`, `lib`, `public`, `supabase`, `package.json`, `vercel.json`, `SETUP.md`), and drag it all onto the page. The folders upload with their structure.
4. Click **Commit changes**.

## Step 3 — Deploy on Vercel

1. In Vercel, click **Add New → Project** and import the `glow` repository.
2. **Framework Preset:** Other. Leave the build settings empty, then click **Deploy**.
3. Open the project's **Settings → Environment Variables** and add these:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL from Step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from Step 1 |
| `ADMIN_KEY` | A password you make up, 12+ characters, for the admin page |
| `SITE_URL` | `https://letsglowwww.com` |
| `STRIPE_SECRET_KEY` | From Step 5 |
| `STRIPE_WEBHOOK_SECRET` | From Step 5 |
| `ANTHROPIC_API_KEY` | From Step 6 |

4. After adding variables, go to **Deployments**, click the **⋯** on the latest deployment, and choose **Redeploy**. Variables only apply to new deployments.

> **Vercel plan:** Vercel's free Hobby plan is for non-commercial use only. Since Glow takes payments, use **Pro** ($20/month). Your lunch app's team may already be on Pro.

## Step 4 — Connect letsglowwww.com

1. In the Vercel project, go to **Settings → Domains** and add `letsglowwww.com`. Also add `www.letsglowwww.com` and let Vercel redirect it to the main domain.
2. If you bought the domain through Vercel, you're done. If you bought it somewhere else, Vercel shows one or two DNS records. Add them at your registrar, the same way you did for your school subdomains.
3. Wait until Vercel shows a green check. It can take a few minutes to a few hours.

## Step 5 — Payments (Stripe)

Start in **Test mode** (the toggle at the top of the Stripe dashboard) so you can try everything with fake cards first.

1. **Developers → API keys**: copy the **Secret key** (`sk_test_...`) into Vercel as `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**:
   - Endpoint URL: `https://letsglowwww.com/api/stripe-webhook`
   - Event: `checkout.session.completed`
   - Save, then copy the **Signing secret** (`whsec_...`) into Vercel as `STRIPE_WEBHOOK_SECRET`.
3. Redeploy (Step 3.4).
4. Test: start a Family Hunt team and pay with card `4242 4242 4242 4242`, any future date and any CVC. Your team should switch to "Hunt Pass active" within a few seconds.
5. **When you're ready to go live:** turn off Test mode, copy the **live** secret key, create the same webhook in live mode, put both live values into Vercel, and redeploy.

There's no need to create products in Stripe. The app sends the prices with each checkout:
- Family Hunt Pass $4.99 · Spotlight boost $5 · Featured listing $49

To change a price, add `PRICE_HUNT_CENTS`, `PRICE_SPOTLIGHT_CENTS` or `PRICE_FEATURED_CENTS` in Vercel (for example `PRICE_FEATURED_CENTS = 7900` for $79). Also update the price shown on the page in `public/index.html` (search for `$49` or `$4.99`).

Stripe promotion codes work at checkout. That's an easy way to give a sponsor or friend a free Featured listing.

## Step 6 — AI photo checks (Claude API)

1. Go to **console.anthropic.com**, create an account, and add a payment method.
2. **API Keys → Create Key**. Copy it into Vercel as `ANTHROPIC_API_KEY` and redeploy.
3. **Set a monthly spending limit** (for example $25) under Billing so costs can't surprise you.

Each photo check uses Claude's smallest, fastest model and costs a fraction of a cent. Each team is capped at 30 photo checks a day. Photos are never saved.

## Step 7 — Add your first displays

1. Go to **letsglowwww.com/admin** and sign in with your `ADMIN_KEY`.
2. Use **Add a display** to put real displays on the map before you announce the app. Leave latitude and longitude empty and the address is looked up automatically. Displays you add here go live right away.
3. Submissions from the public show up under **Waiting for review**. Approve, edit or reject them there.
4. **All displays** lets you feature a business, give a home the Spotlight, or mark "Lights off" if a display goes dark.

## Step 8 — Final checks before launch

- [ ] The home page loads at letsglowwww.com and shows your displays on the map
- [ ] On an iPhone in Safari: Share → **Add to Home Screen** → the Glow wreath icon appears
- [ ] On Android in Chrome: the **Install Glow** banner appears
- [ ] Rate a display and post a wait time
- [ ] Build a tour and tap **Open route in Google Maps**
- [ ] Submit a test display from **Add a display**, then approve it in admin
- [ ] Start a Family Hunt team (test card), take a photo of a find, and check in at a display while you're there
- [ ] Switch Stripe to live keys
- [ ] Set up the email **hello@letsglowwww.com** (most registrars offer free email forwarding), or change `CONTACT_EMAIL` near the top of the script in `public/index.html` and the address in `public/privacy.html`

---

## Changing things later

| To change | Edit |
|---|---|
| Family Hunt photo list and points | `lib/finds.js` |
| Prize text, contact email | Top of the `<script>` section in `public/index.html` |
| Check-in distance (default 0.3 miles) | Vercel variable `CHECKIN_MILES` |
| Photo checks per team per day (default 30) | Vercel variable `PHOTO_TRIES_PER_DAY` |
| Map tiles | `TILE_URL` near the top of the script in `public/index.html` |

To update a file: open it on GitHub, click the pencil icon, paste in the new version and commit. Vercel redeploys automatically in about a minute.

**About the map:** the map uses free OpenStreetMap tiles, which are fine for a local launch. If Glow gets very popular (thousands of visitors a night), switch to a paid tile service such as Stadia Maps or MapTiler (about $20/month) by changing `TILE_URL`.

## How the pieces fit

- **Ratings and wait times** are anonymous. Each phone gets a random ID, so one phone gets one rating per display, and wait reports are limited to one per 10 minutes. Wait times older than 3 hours disappear.
- **Family Hunt check-ins** use the phone's location and only count within 0.3 miles of the display. One check-in per display per day. Featured businesses give +5 points and Homeowner Picks give 20.
- **Weekly challenge:** +30 points each week a team checks in at displays in 3 different towns.
- **Leaderboards** only show teams with a paid Hunt Pass, and only show team names.
- **Spotlight and Featured** turn on automatically when Stripe confirms payment. The listing still needs your approval to appear.
