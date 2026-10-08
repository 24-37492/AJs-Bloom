# AJ's Bloom (Vercel + Postgres)

Pages live in `public/` (served as static files). The API is one Express app (`server/app.js`) that Vercel runs as a serverless function through `api/index.js`.

## Deploy on Vercel
1. Push this folder to a GitHub repo and import it in Vercel (Framework Preset: **Other**; leave build settings empty).
2. In the project: **Storage → Create → Postgres (Neon)** and connect it. Vercel adds `POSTGRES_URL` automatically.
3. **Settings → Environment Variables**, add: `JWT_SECRET` (32+ random characters), `ADMIN_EMAIL`, and `GMAIL_USER` and `GMAIL_APP_PASSWORD` (they send the 6-digit confirmation codes, see below).
4. Initialize the database and seed the shop catalog: run `vercel env pull .env.local`, then `npm run db:init`. This creates the tables and seeds the initial products once; admin changes and deletions are preserved if you rerun it.
5. Deploy (or Redeploy after adding variables).

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `JWT_SECRET` (a free Neon database works fine).
3. `npm run db:init`, then `npm run dev` and open http://localhost:3000
   Without the Gmail settings, confirmation codes are printed in the terminal.

## Gmail confirmation codes
1. Sign in to the Gmail account that should send the codes and turn on **2-Step Verification** (Google Account -> Security).
2. Open **App passwords** (search for it in your Google Account), create one named "AJ's Bloom", and copy the 16-character password.
3. Set `GMAIL_USER` to that Gmail address and `GMAIL_APP_PASSWORD` to the 16 characters (spaces are fine).
Customers then receive an email from that Gmail with their 6-digit code. A regular Gmail account can send about 500 emails per day.

## Good to know
- Prices are enforced by the server using the database catalog. The first `npm run db:init` seeds products from `server/products.json`; later admin changes are saved in the database.
- Admins can add products with JPEG, PNG, or WebP photos up to 1 MB. Product photos are stored in Postgres. Deleting a product removes it from the shop but preserves item details already recorded in orders.
- Admins can edit a product’s name, price, category, and description from the Products section of the dashboard; replacing the photo is optional.
- Checkout asks customers for a requested delivery or pickup date and lets them zoom, click, and drag a delivery pin on an OpenStreetMap map. Rerun `npm run db:init` after deployment to add the date and map-coordinate fields to an existing orders table.
- Delivery map tiles are loaded from OpenStreetMap and require an internet connection.
- Customers can edit or delete their own orders while the status is still `Payment verification pending`. The server recalculates prices from the live catalog and rejects changes once an admin updates the order status.
- The admin is whoever signs up (and confirms their email) with `ADMIN_EMAIL`. The admin sign-in page also supports creating that initial account; the server grants admin access only to the configured email.
