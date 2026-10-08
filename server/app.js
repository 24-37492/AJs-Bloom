const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const seedProducts = require("./products.json");

const isProd = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const COOKIE_NAME = "ajb_session";
const SESSION_DAYS = 7;
const CODE_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_PRODUCT_IMAGE_BYTES = 1024 * 1024;
const FULFILMENTS = ["Delivery", "Pickup", "Lalamove"];
const ORDER_STATUSES = ["Payment verification pending", "Preparing", "Out for delivery", "Completed", "Cancelled"];
const PRODUCT_CATEGORIES = ["Sweet", "Signature", "Statement"];
const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PRODUCT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const SEEDED_PRODUCT_IMAGE_PATHS = new Map(seedProducts.map(product => [product.id, product.image]));
SEEDED_PRODUCT_IMAGE_PATHS.set("bouquet-749b", "10.jpg");
SEEDED_PRODUCT_IMAGE_PATHS.set("bouquet-800b", "12.jpg");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";

class HttpError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function fail(res, status, code, message) {
    return res.status(status).json({ error: { code, message } });
}

const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ serveStatic = false } = {}) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error("Set DATABASE_URL (or POSTGRES_URL) to your Postgres connection string.");
    if (JWT_SECRET.length < 32) throw new Error("Set JWT_SECRET to a random string of at least 32 characters.");

    // Small pool: each serverless instance only needs a few connections.
    const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
    pool.on("error", error => console.error("Idle database connection error.", error.message));

    const gmailUser = String(process.env.GMAIL_USER || "").trim();
    const gmailPassword = String(process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
    const transporter = gmailUser && gmailPassword
        ? nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPassword } })
        : process.env.SMTP_HOST
        ? nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === "true",
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
        })
        : null;

    const app = express();
    app.set("trust proxy", 1);
    app.use(helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org"],
                connectSrc: ["'self'"],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                upgradeInsecureRequests: isProd ? [] : null
            }
        }
    }));
    app.use(cookieParser());
    app.use(express.json({ limit: "1400kb" }));

    // Block cross-site writes: same-origin requests only, JSON only.
    app.use("/api", (req, res, next) => {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
        const origin = req.get("origin");
        if (origin) {
            let sameOrigin = false;
            try { sameOrigin = new URL(origin).host === req.get("host"); } catch (error) { sameOrigin = false; }
            if (!sameOrigin) return fail(res, 403, "forbidden", "That request was blocked.");
        }
        if (!req.is("application/json")) return fail(res, 415, "bad_request", "Invalid request.");
        next();
    });

    const limiterHandler = (req, res) => fail(res, 429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
    const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, handler: limiterHandler });
    const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, handler: limiterHandler });
    const adminWriteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, handler: limiterHandler });

    // ---------- sessions ----------
    function startSession(res, userId) {
        const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
        res.cookie(COOKIE_NAME, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: isProd,
            maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
            path: "/"
        });
    }

    app.use(handle(async (req, res, next) => {
        const token = req.cookies[COOKIE_NAME];
        if (token) {
            let sub;
            try {
                ({ sub } = jwt.verify(token, JWT_SECRET));
            } catch (error) {
                res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isProd, path: "/" });
                return next();
            }
            const { rows } = await pool.query(
                "SELECT id, email, full_name, role FROM users WHERE id = $1 AND email_verified = true", [sub]);
            if (rows[0]) req.user = rows[0];
        }
        next();
    }));

    function requireUser(req, res, next) {
        if (!req.user) return fail(res, 401, "not_signed_in", "Please sign in first.");
        next();
    }

    function requireAdmin(req, res, next) {
        if (!req.user) return fail(res, 401, "not_signed_in", "Please sign in first.");
        if (req.user.role !== "admin") return fail(res, 403, "forbidden", "You don’t have access to that.");
        next();
    }

    function shapeProduct(row) {
        const seededImagePath = SEEDED_PRODUCT_IMAGE_PATHS.get(row.id);
        return {
            id: row.id,
            name: row.name,
            price: Number(row.price),
            image: row.image_data
                ? `/api/products/${encodeURIComponent(row.id)}/image`
                : seededImagePath || row.image_path,
            category: row.category,
            description: row.description,
            badge: row.badge || ""
        };
    }

    app.get("/api/products", handle(async (req, res) => {
        const { rows } = await pool.query(
            `SELECT id, name, price, image_path, image_data IS NOT NULL AS has_image_data, category, description, badge
             FROM products ORDER BY created_at, id`);
        res.json({ products: rows.map(row => shapeProduct({ ...row, image_data: row.has_image_data })) });
    }));

    app.get("/api/products/:id/image", handle(async (req, res) => {
        if (!PRODUCT_ID_PATTERN.test(req.params.id)) throw new HttpError(404, "not_found", "That product image wasn’t found.");
        const { rows } = await pool.query(
            "SELECT image_data, image_mime_type FROM products WHERE id = $1", [req.params.id]);
        if (!rows[0] || !rows[0].image_data) throw new HttpError(404, "not_found", "That product image wasn’t found.");
        res.set("Content-Type", rows[0].image_mime_type);
        res.set("Cache-Control", "public, max-age=300");
        res.set("X-Content-Type-Options", "nosniff");
        res.send(rows[0].image_data);
    }));

    function readProductDetails(body) {
        const name = String(body.name || "").trim();
        const price = Number(body.price);
        const category = String(body.category || "");
        const description = String(body.description || "").trim();
        if (!name || name.length > 80) throw new HttpError(400, "invalid_product", "Enter a product name (up to 80 characters).");
        if (!Number.isInteger(price) || price < 1 || price > 1000000) {
            throw new HttpError(400, "invalid_product", "Enter a whole-number price from ₱1 to ₱1,000,000.");
        }
        if (!PRODUCT_CATEGORIES.includes(category)) throw new HttpError(400, "invalid_product", "Choose a valid product category.");
        if (description.length > 300) throw new HttpError(400, "invalid_product", "The product description must be 300 characters or fewer.");
        return { name, price, category, description };
    }

    function readProductImage(body) {
        const imageData = String(body.imageData || "");
        const imageMimeType = String(body.imageMimeType || "");
        if (!PRODUCT_IMAGE_TYPES.includes(imageMimeType) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(imageData)) {
            throw new HttpError(400, "invalid_product_image", "Upload a valid JPEG, PNG, or WebP product photo.");
        }
        const imageBytes = Buffer.from(imageData, "base64");
        if (!imageBytes.length || imageBytes.length > MAX_PRODUCT_IMAGE_BYTES || imageBytes.toString("base64") !== imageData) {
            throw new HttpError(400, "invalid_product_image", "Product photos must be smaller than 1 MB.");
        }
        const isJpeg = imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff;
        const isPng = imageBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const isWebp = imageBytes.toString("ascii", 0, 4) === "RIFF" &&
            imageBytes.toString("ascii", 8, 12) === "WEBP";
        if (!(imageMimeType === "image/jpeg" && isJpeg) &&
            !(imageMimeType === "image/png" && isPng) &&
            !(imageMimeType === "image/webp" && isWebp)) {
            throw new HttpError(400, "invalid_product_image", "The uploaded file does not match its image type.");
        }
        return { imageBytes, imageMimeType };
    }

    app.post("/api/products", requireAdmin, adminWriteLimiter, handle(async (req, res) => {
        const body = req.body || {};
        const product = readProductDetails(body);
        const { imageBytes, imageMimeType } = readProductImage(body);
        const id = crypto.randomUUID();
        const { rows } = await pool.query(
            `INSERT INTO products (id, name, price, category, description, image_data, image_mime_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, price, category, description, badge`,
            [id, product.name, product.price, product.category, product.description, imageBytes, imageMimeType]);
        res.status(201).json({ product: shapeProduct({ ...rows[0], image_data: true }) });
    }));

    app.patch("/api/products/:id", requireAdmin, adminWriteLimiter, handle(async (req, res) => {
        const id = req.params.id;
        if (!PRODUCT_ID_PATTERN.test(id)) throw new HttpError(404, "not_found", "That product wasn’t found.");
        const product = readProductDetails(req.body || {});
        const imageData = (req.body || {}).imageData;
        const result = typeof imageData === "string" && imageData.length
            ? await pool.query(
                `UPDATE products SET name = $1, price = $2, category = $3, description = $4,
                        image_data = $5, image_mime_type = $6
                 WHERE id = $7
                 RETURNING id, name, price, image_path, image_data IS NOT NULL AS has_image_data, category, description, badge`,
                [product.name, product.price, product.category, product.description,
                    readProductImage(req.body).imageBytes, req.body.imageMimeType, id])
            : await pool.query(
                `UPDATE products SET name = $1, price = $2, category = $3, description = $4
                 WHERE id = $5
                 RETURNING id, name, price, image_path, image_data IS NOT NULL AS has_image_data, category, description, badge`,
                [product.name, product.price, product.category, product.description, id]);
        if (!result.rowCount) throw new HttpError(404, "not_found", "That product wasn’t found.");
        res.json({ product: shapeProduct({ ...result.rows[0], image_data: result.rows[0].has_image_data }) });
    }));

    app.delete("/api/products/:id", requireAdmin, adminWriteLimiter, handle(async (req, res) => {
        if (!PRODUCT_ID_PATTERN.test(req.params.id)) throw new HttpError(404, "not_found", "That product wasn’t found.");
        const result = await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
        if (!result.rowCount) throw new HttpError(404, "not_found", "That product wasn’t found.");
        res.json({ ok: true });
    }));

    function accountPayload(user) {
        return {
            user: { id: user.id, email: user.email },
            profile: { user_id: user.id, role: user.role, full_name: user.full_name }
        };
    }

    // ---------- email codes ----------
    const hashCode = code => crypto.createHash("sha256").update(`${code}:${JWT_SECRET}`).digest("hex");

    async function sendConfirmationCode(user) {
        const { rows } = await pool.query("SELECT last_sent_at FROM email_codes WHERE user_id = $1", [user.id]);
        if (rows[0] && Date.now() - new Date(rows[0].last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
            throw new HttpError(429, "rate_limited", "Please wait a moment before asking for another code.");
        }
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        await pool.query(
            `INSERT INTO email_codes (user_id, code_hash, expires_at, attempts, last_sent_at)
             VALUES ($1, $2, $3, 0, $4)
             ON CONFLICT (user_id) DO UPDATE
             SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
                 attempts = 0, last_sent_at = EXCLUDED.last_sent_at`,
            [user.id, hashCode(code), new Date(Date.now() + CODE_MINUTES * 60 * 1000), new Date()]);

        if (!transporter) {
            if (isProd) throw new HttpError(503, "email_unavailable", "Email sending isn’t set up yet. Please try again later.");
            console.log(`[dev] Confirmation code for ${user.email}: ${code}`);
            return;
        }
        try {
            await transporter.sendMail({
                from: process.env.SMTP_FROM || (gmailUser ? `"AJ’s Bloom" <${gmailUser}>` : process.env.SMTP_USER),
                to: user.email,
                subject: "Your AJ’s Bloom confirmation code",
                text: `Your AJ’s Bloom confirmation code is ${code}. It expires in ${CODE_MINUTES} minutes.\n\nIf you didn’t create an account, you can ignore this email.`,
                html: `<p>Your AJ’s Bloom confirmation code is:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>It expires in ${CODE_MINUTES} minutes. If you didn’t create an account, you can ignore this email.</p>`
            });
        } catch (error) {
            console.error("Could not send the confirmation email.", error);
            throw new HttpError(502, "email_failed", "We couldn’t send the confirmation email. Please try again.");
        }
    }

    // ---------- auth routes ----------
    function readEmail(body) {
        const email = String((body && body.email) || "").trim().toLowerCase();
        if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
            throw new HttpError(400, "invalid_email", "Please enter a valid email address.");
        }
        return email;
    }

    function readPassword(value) {
        const password = String(value || "");
        if (password.length < 8) throw new HttpError(400, "weak_password", "Your password needs at least 8 characters.");
        if (Buffer.byteLength(password) > 72) throw new HttpError(400, "weak_password", "That password is too long. Please use 72 characters or fewer.");
        return password;
    }

    const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);
    const alreadyExists = () => new HttpError(409, "user_already_exists", "An account with this email already exists. Try signing in instead.");

    app.get("/api/auth/me", (req, res) => {
        res.json(req.user ? accountPayload(req.user) : { user: null, profile: null });
    });

    app.post("/api/auth/signup", authLimiter, handle(async (req, res) => {
        const body = req.body || {};
        const email = readEmail(body);
        const password = readPassword(body.password);
        const fullName = String(body.fullName || "").trim().slice(0, 80);
        if (!fullName) throw new HttpError(400, "invalid_name", "Please enter your name.");

        // Housekeeping: drop sign-ups that were never confirmed.
        await pool.query("DELETE FROM users WHERE email_verified = false AND created_at < now() - interval '7 days'")
            .catch(error => console.error("Cleanup failed.", error.message));

        const passwordHash = await bcrypt.hash(password, 12);
        const { rows: existing } = await pool.query("SELECT id, email_verified FROM users WHERE email = $1", [email]);
        let userId;
        if (existing[0]) {
            if (existing[0].email_verified) throw alreadyExists();
            // Never confirmed: let the person start over with their new details.
            userId = existing[0].id;
            await pool.query("UPDATE users SET password_hash = $1, full_name = $2 WHERE id = $3", [passwordHash, fullName, userId]);
        } else {
            try {
                const { rows } = await pool.query(
                    "INSERT INTO users (email, password_hash, full_name, role, email_verified) VALUES ($1, $2, $3, 'customer', false) RETURNING id",
                    [email, passwordHash, fullName]);
                userId = rows[0].id;
            } catch (error) {
                if (error.code === UNIQUE_VIOLATION) throw alreadyExists();
                throw error;
            }
        }
        await sendConfirmationCode({ id: userId, email });
        res.json({ needsVerification: true });
    }));

    app.post("/api/auth/verify", authLimiter, handle(async (req, res) => {
        const body = req.body || {};
        const email = readEmail(body);
        const code = String(body.code || "").trim();
        const invalid = new HttpError(400, "invalid_code", "That code is wrong or has expired. Tap “Send a new code” and try again.");
        if (!/^\d{6}$/.test(code)) throw invalid;

        const { rows: users } = await pool.query(
            "SELECT id, email, full_name, role, email_verified FROM users WHERE email = $1", [email]);
        const user = users[0];
        if (!user || user.email_verified) throw invalid;

        const { rows } = await pool.query("SELECT code_hash, expires_at, attempts FROM email_codes WHERE user_id = $1", [user.id]);
        const record = rows[0];
        if (!record || new Date(record.expires_at).getTime() < Date.now()) throw invalid;
        if (record.attempts >= MAX_CODE_ATTEMPTS) {
            throw new HttpError(429, "rate_limited", "Too many wrong codes. Tap “Send a new code” to get a fresh one.");
        }

        const expected = Buffer.from(record.code_hash, "hex");
        const given = Buffer.from(hashCode(code), "hex");
        if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
            await pool.query("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = $1", [user.id]);
            throw invalid;
        }

        const role = ADMIN_EMAIL && email === ADMIN_EMAIL ? "admin" : user.role;
        await pool.query("UPDATE users SET email_verified = true, role = $2 WHERE id = $1", [user.id, role]);
        await pool.query("DELETE FROM email_codes WHERE user_id = $1", [user.id]);
        startSession(res, user.id);
        res.json(accountPayload({ ...user, role }));
    }));

    app.post("/api/auth/resend", authLimiter, handle(async (req, res) => {
        const email = readEmail(req.body || {});
        const { rows } = await pool.query("SELECT id, email, email_verified FROM users WHERE email = $1", [email]);
        // Same answer whether or not the account exists, so emails can't be probed.
        if (rows[0] && !rows[0].email_verified) await sendConfirmationCode(rows[0]);
        res.json({ ok: true });
    }));

    app.post("/api/auth/signin", authLimiter, handle(async (req, res) => {
        const body = req.body || {};
        const email = readEmail(body);
        const password = String(body.password || "");
        const { rows } = await pool.query(
            "SELECT id, email, password_hash, full_name, role, email_verified FROM users WHERE email = $1", [email]);
        const user = rows[0];
        const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
        if (!user || !matches) throw new HttpError(401, "invalid_credentials", "That email or password isn’t right. Please try again.");
        if (!user.email_verified) throw new HttpError(403, "email_not_confirmed", "Please confirm your email first. Check your inbox for the code.");
        if (ADMIN_EMAIL && email === ADMIN_EMAIL && user.role !== "admin") {
            await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
            user.role = "admin";
        }
        startSession(res, user.id);
        res.json(accountPayload(user));
    }));

    app.post("/api/auth/signout", (req, res) => {
        res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isProd, path: "/" });
        res.json({ ok: true });
    });

    app.post("/api/auth/password", requireUser, authLimiter, handle(async (req, res) => {
        const password = readPassword((req.body || {}).newPassword);
        await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await bcrypt.hash(password, 12), req.user.id]);
        res.json({ ok: true });
    }));

    // ---------- orders ----------
    const badOrder = message => new HttpError(400, "invalid_order", message);

    function getManilaDate() {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(new Date());
    }

    async function readOrder(body, database = pool) {
        const name = String(body.name || "").trim();
        const phone = String(body.phone || "").trim();
        const fulfilment = String(body.fulfilment || "");
        const deliveryDate = String(body.deliveryDate || "");
        const readCoordinate = value =>
            typeof value === "number" || (typeof value === "string" && value.trim() !== "")
                ? Number(value)
                : NaN;
        let deliveryLatitude = readCoordinate(body.deliveryLatitude);
        let deliveryLongitude = readCoordinate(body.deliveryLongitude);
        const note = String(body.note || "").trim();
        const paymentReference = String(body.paymentReference || "").trim();
        let address = String(body.address || "").trim();

        if (!name || name.length > 80) throw badOrder("Please enter your name.");
        if (!phone || phone.length > 24) throw badOrder("Please enter a valid mobile number.");
        if (!FULFILMENTS.includes(fulfilment)) throw badOrder("Please choose how you’d like your flowers.");
        const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)
            ? new Date(`${deliveryDate}T00:00:00.000Z`)
            : null;
        if (!selectedDate || Number.isNaN(selectedDate.getTime()) ||
            selectedDate.toISOString().slice(0, 10) !== deliveryDate || deliveryDate < getManilaDate()) {
            throw badOrder("Please choose today or a future date for your order.");
        }
        if (fulfilment === "Pickup") {
            address = "";
            deliveryLatitude = null;
            deliveryLongitude = null;
        } else if (!Number.isFinite(deliveryLatitude) || deliveryLatitude < -90 || deliveryLatitude > 90 ||
                   !Number.isFinite(deliveryLongitude) || deliveryLongitude < -180 || deliveryLongitude > 180) {
            throw badOrder("Please pin your delivery location on the map.");
        }
        if (address.length > 300) throw badOrder("That address is too long.");
        if (note.length > 600) throw badOrder("Your note is too long.");
        if (!paymentReference || paymentReference.length > 80) throw badOrder("Please enter your payment reference number.");

        if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
            throw badOrder("Your bag is empty.");
        }
        // Prices always come from the server's catalog, never from the browser.
        const quantities = new Map();
        for (const entry of body.items) {
            const id = String(entry && entry.id);
            const quantity = Number(entry && entry.quantity);
            if (!PRODUCT_ID_PATTERN.test(id) || !Number.isInteger(quantity) || quantity < 1) {
                throw badOrder("Something in your bag is no longer available. Please refresh and try again.");
            }
            quantities.set(id, (quantities.get(id) || 0) + quantity);
        }
        const { rows: catalogRows } = await database.query(
            "SELECT id, name, price FROM products WHERE id = ANY($1::text[])", [[...quantities.keys()]]);
        const catalog = new Map(catalogRows.map(product => [product.id, product]));
        if (catalog.size !== quantities.size) {
            throw badOrder("Something in your bag is no longer available. Please refresh and try again.");
        }
        const items = [];
        let total = 0;
        for (const [id, quantity] of quantities) {
            if (quantity > 99) throw badOrder("That’s a lot of bouquets! Please contact us for large orders.");
            const product = catalog.get(id);
            const price = Number(product.price);
            items.push({ id, name: product.name, price, quantity });
            total += price * quantity;
        }
        if (total > 99999999.99) throw badOrder("That order total is above the maximum supported amount.");
        return { name, phone, fulfilment, address, deliveryDate, deliveryLatitude, deliveryLongitude, note, paymentReference, items, total };
    }

    app.post("/api/orders", requireUser, orderLimiter, handle(async (req, res) => {
        const order = await readOrder(req.body || {});
        for (let attempt = 0; attempt < 5; attempt++) {
            const orderNumber = `AJ-${Date.now().toString().slice(-7)}${crypto.randomInt(10, 100)}`;
            try {
                await pool.query(
                    `INSERT INTO orders (order_number, customer_id, name, phone, fulfilment, address, delivery_date,
                                         delivery_latitude, delivery_longitude, note,
                                         payment_reference, items, total, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, 'Payment verification pending')`,
                    [orderNumber, req.user.id, order.name, order.phone, order.fulfilment, order.address,
                        order.deliveryDate, order.deliveryLatitude, order.deliveryLongitude, order.note,
                        order.paymentReference, JSON.stringify(order.items), order.total]);
                return res.status(201).json({ orderNumber, total: order.total });
            } catch (error) {
                if (error.code !== UNIQUE_VIOLATION) throw error;
            }
        }
        throw new HttpError(500, "server_error", "We couldn’t save your order. Please try again.");
    }));

    function shapeOrder(row, includePrivate) {
        let items = row.items;
        if (typeof items === "string") {
            try { items = JSON.parse(items); } catch (error) { items = []; }
        }
        const order = {
            id: row.id,
            order_number: row.order_number,
            fulfilment: row.fulfilment,
            address: row.address,
            delivery_date: row.delivery_date,
            delivery_latitude: row.delivery_latitude === null || row.delivery_latitude === undefined ? null : Number(row.delivery_latitude),
            delivery_longitude: row.delivery_longitude === null || row.delivery_longitude === undefined ? null : Number(row.delivery_longitude),
            note: row.note,
            items,
            total: Number(row.total),
            status: row.status,
            created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
        };
        if (includePrivate) {
            order.name = row.name;
            order.phone = row.phone;
            order.payment_reference = row.payment_reference;
        }
        return order;
    }

    app.get("/api/orders", requireUser, handle(async (req, res) => {
        const isAdmin = req.user.role === "admin";
        const { rows } = isAdmin
            ? await pool.query(
                `SELECT id, order_number, name, phone, fulfilment, address, delivery_date, delivery_latitude, delivery_longitude,
                        note, payment_reference, items, total, status, created_at
                 FROM orders ORDER BY created_at DESC LIMIT 1000`)
            : await pool.query(
                `SELECT id, order_number, name, phone, fulfilment, address, delivery_date,
                        delivery_latitude, delivery_longitude, note, payment_reference,
                        items, total, status, created_at
                 FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`, [req.user.id]);
        res.json({ orders: rows.map(row => shapeOrder(row, true)) });
    }));

    app.patch("/api/orders/:id/status", requireAdmin, handle(async (req, res) => {
        const status = String((req.body || {}).status || "");
        if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, "invalid_status", "That status isn’t valid.");
        if (!UUID_PATTERN.test(req.params.id)) throw new HttpError(404, "not_found", "That order wasn’t found.");
        const result = await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, req.params.id]);
        if (!result.rowCount) throw new HttpError(404, "not_found", "That order wasn’t found.");
        res.json({ ok: true });
    }));

    app.patch("/api/orders/:id", requireUser, orderLimiter, handle(async (req, res) => {
        if (req.user.role !== "customer") {
            throw new HttpError(403, "forbidden", "Only the customer who placed this order can change it.");
        }
        if (!UUID_PATTERN.test(req.params.id)) throw new HttpError(404, "not_found", "That order wasn’t found.");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const { rows } = await client.query(
                "SELECT customer_id, status FROM orders WHERE id = $1 FOR UPDATE", [req.params.id]);
            if (!rows[0] || rows[0].customer_id !== req.user.id) {
                throw new HttpError(404, "not_found", "That order wasn’t found.");
            }
            if (rows[0].status !== "Payment verification pending") {
                throw new HttpError(409, "order_locked", "This order can no longer be changed because it has been confirmed.");
            }
            const order = await readOrder(req.body || {}, client);
            await client.query(
                `UPDATE orders
                 SET name = $1, phone = $2, fulfilment = $3, address = $4, delivery_date = $5,
                     delivery_latitude = $6, delivery_longitude = $7, note = $8,
                     payment_reference = $9, items = $10::jsonb, total = $11
                 WHERE id = $12`,
                [order.name, order.phone, order.fulfilment, order.address, order.deliveryDate,
                    order.deliveryLatitude, order.deliveryLongitude, order.note, order.paymentReference,
                    JSON.stringify(order.items), order.total, req.params.id]);
            await client.query("COMMIT");
            res.json({ ok: true, total: order.total });
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Could not roll back customer order changes.", rollbackError);
            }
            throw error;
        } finally {
            client.release();
        }
    }));

    app.delete("/api/orders/:id", requireUser, adminWriteLimiter, handle(async (req, res) => {
        if (!UUID_PATTERN.test(req.params.id)) throw new HttpError(404, "not_found", "That order wasn’t found.");
        if (req.user.role === "admin") {
            const result = await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
            if (!result.rowCount) throw new HttpError(404, "not_found", "That order wasn’t found.");
            return res.json({ ok: true });
        }
        const result = await pool.query(
            `DELETE FROM orders
             WHERE id = $1 AND customer_id = $2 AND status = 'Payment verification pending'
             RETURNING id`,
            [req.params.id, req.user.id]);
        if (!result.rowCount) {
            const { rows } = await pool.query("SELECT customer_id, status FROM orders WHERE id = $1", [req.params.id]);
            if (!rows[0] || rows[0].customer_id !== req.user.id) {
                throw new HttpError(404, "not_found", "That order wasn’t found.");
            }
            throw new HttpError(409, "order_locked", "This order can no longer be deleted because it has been confirmed.");
        }
        res.json({ ok: true });
    }));

    app.use("/api", (req, res) => fail(res, 404, "not_found", "Not found."));

    // ---------- pages (local development only; Vercel serves /public itself) ----------
    if (serveStatic) {
        app.use(express.static(path.join(__dirname, "..", "public"), { dotfiles: "deny", extensions: ["html"] }));
        if (!transporter) console.warn("Gmail is not set up (GMAIL_USER / GMAIL_APP_PASSWORD): confirmation codes will be printed in this terminal.");
    }
    app.use((req, res) => res.status(404).type("text").send("Page not found."));

    app.use((error, req, res, next) => {
        if (error instanceof HttpError) return fail(res, error.status, error.code, error.message);
        if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
            return fail(res, 400, "bad_request", "Invalid request.");
        }
        console.error(error);
        fail(res, 500, "server_error", "Something went wrong. Please try again.");
    });

    return app;
}

module.exports = { createApp };
