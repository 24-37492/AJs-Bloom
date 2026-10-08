-- AJ's Bloom Postgres schema (Postgres 13+; works on Neon / Vercel Postgres). Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name text NOT NULL DEFAULT '' CHECK (char_length(full_name) <= 80),
    role text NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_codes (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    last_sent_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number text NOT NULL UNIQUE,
    customer_id uuid REFERENCES users (id) ON DELETE SET NULL,
    name text NOT NULL CHECK (char_length(name) <= 80),
    phone text NOT NULL CHECK (char_length(phone) <= 24),
    fulfilment text NOT NULL CHECK (fulfilment IN ('Delivery', 'Pickup', 'Lalamove')),
    address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 300),
    delivery_date date,
    delivery_latitude numeric(9, 6),
    delivery_longitude numeric(9, 6),
    note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 600),
    payment_reference text NOT NULL CHECK (char_length(payment_reference) <= 80),
    items jsonb NOT NULL,
    total numeric(10, 2) NOT NULL CHECK (total >= 0),
    status text NOT NULL DEFAULT 'Payment verification pending'
        CHECK (status IN ('Payment verification pending', 'Preparing', 'Out for delivery', 'Completed', 'Cancelled')),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude numeric(9, 6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude numeric(9, 6);

CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS products (
    id text PRIMARY KEY,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    price integer NOT NULL CHECK (price BETWEEN 1 AND 1000000),
    category text NOT NULL CHECK (category IN ('Sweet', 'Signature', 'Statement')),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
    badge text NOT NULL DEFAULT '' CHECK (char_length(badge) <= 30),
    image_path text NOT NULL DEFAULT '',
    image_data bytea,
    image_mime_type text CHECK (image_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((image_data IS NULL) = (image_mime_type IS NULL)),
    CHECK (image_data IS NULL OR octet_length(image_data) <= 1048576)
);

CREATE INDEX IF NOT EXISTS products_created_idx ON products (created_at, id);

CREATE TABLE IF NOT EXISTS app_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
