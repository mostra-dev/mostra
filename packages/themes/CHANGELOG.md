# @mostra/themes

## 0.14.0

### Minor Changes

- [#150](https://github.com/mostra-dev/mostra/pull/150) [`662f879`](https://github.com/mostra-dev/mostra/commit/662f8798d719446b15f583c3b285ce0fec097b89) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Artifacts have Studio's own type: `@mostra/themes` is in the warm set and ships `css/faces.css` (Figtree, Jost and Spline Sans Mono, SIL OFL 1.1), which the Skill's Studio stylesheet imports, so an artifact's build bundles the faces with no install and no third-party request.

- [#150](https://github.com/mostra-dev/mostra/pull/150) [`c909aa3`](https://github.com/mostra-dev/mostra/commit/c909aa323c6db9863e2797807ee792a474e0ee31) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A new package, `@mostra/themes`: Mostra's themes as data (`studio` and `mostra`, light and dark, checked for WCAG 2.2 AA by `defineTheme`), their stylesheets (`@mostra/themes/css/studio.css`, `css/mostra.css`) and self-hosted faces (Figtree, Jost, Spline Sans Mono), a template for the pages a server draws itself with no script (`createPages`), and one for mail (`renderMail`).
