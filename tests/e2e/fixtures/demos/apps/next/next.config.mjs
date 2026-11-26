// A static export, built for the path Mostra serves it at (D185 item 4); Next's `basePath` takes it
// without the trailing slash.
const base = (process.env.MOSTRA_DEMO_BASE ?? "/").replace(/\/$/, "");

export default { output: "export", basePath: base, trailingSlash: true };
