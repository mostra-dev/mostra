/** Stylesheets a module imports for their side effect (a library's own CSS): the bundler takes them. */
declare module "*.css";

/** A worker the bundler builds beside the page, as its URL (Vite's `?worker&url`). */
declare module "*?worker&url" {
  const url: string;
  export default url;
}
