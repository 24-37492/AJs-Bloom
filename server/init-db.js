// Creates the tables from database/schema.sql.  Usage: npm run db:init
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { Client } = require("pg");
const products = require("./products.json");
const productImageAliases = new Map([
    ["bouquet-749b", "10.jpg"],
    ["bouquet-800b", "12.jpg"]
]);

(async () => {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error("Set DATABASE_URL (or POSTGRES_URL) first.");
    const client = new Client({ connectionString });
    await client.connect();
    try {
        await client.query("BEGIN");
        await client.query(fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8"));
        const { rows: seedState } = await client.query(
            "SELECT 1 FROM app_migrations WHERE name = 'initial_product_catalog'");
        if (!seedState.length) {
            for (const product of products) {
                await client.query(
                    `INSERT INTO products (id, name, price, category, description, badge, image_path)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (id) DO NOTHING`,
                    [product.id, product.name, product.price, product.category, product.description, product.badge || "", product.image]);
            }
            await client.query("INSERT INTO app_migrations (name) VALUES ('initial_product_catalog')");
        }
        for (const product of products) {
            const imagePath = productImageAliases.get(product.id) || product.image;
            await client.query(
                `UPDATE products SET image_path = $2
                 WHERE id = $1 AND image_data IS NULL AND image_path IS DISTINCT FROM $2`,
                [product.id, imagePath]);
        }
        for (const [id, imagePath] of productImageAliases) {
            await client.query(
                `UPDATE products SET image_path = $2
                 WHERE id = $1 AND image_data IS NULL AND image_path IS DISTINCT FROM $2`,
                [id, imagePath]);
        }
        await client.query("COMMIT");
        console.log("Database tables are ready; the initial catalog was seeded if needed.");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        await client.end();
    }
})().catch(error => {
    console.error("Could not set up the database:", error.message);
    process.exit(1);
});
