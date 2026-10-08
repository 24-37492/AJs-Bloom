// Local development server: API + the pages in /public.  Usage: npm run dev
const { createApp } = require("./app");

const port = Number(process.env.PORT || 3000);
try {
    createApp({ serveStatic: true }).listen(port, () => console.log(`AJ's Bloom is running at http://localhost:${port}`));
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
