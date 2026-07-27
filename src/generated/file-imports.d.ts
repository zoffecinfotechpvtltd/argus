// Ambient module declarations for `import x from "./file.ext" with { type: "file" }` — Bun's file
// loader always yields a string path (real path in `bun run`, embedded-blob handle once compiled
// with `bun build --compile`), but TypeScript has no built-in typing for asset extensions besides
// the handful bun-types declares itself (.txt, .toml, .yaml, .html, etc. — see
// node_modules/bun-types/extensions.d.ts). Those pre-declared ones (notably *.html, which
// bun-types types as HTMLBundle for its unrelated native HTML-bundling feature) are handled with a
// cast at the import site in the generated manifest instead of being redeclared here, since two
// ambient declarations for the same wildcard specifier conflict.
declare module "*.css" {
  const path: string;
  export default path;
}
declare module "*.js" {
  const path: string;
  export default path;
}
declare module "*.mjs" {
  const path: string;
  export default path;
}
declare module "*.svg" {
  const path: string;
  export default path;
}
declare module "*.png" {
  const path: string;
  export default path;
}
declare module "*.jpg" {
  const path: string;
  export default path;
}
declare module "*.jpeg" {
  const path: string;
  export default path;
}
declare module "*.ico" {
  const path: string;
  export default path;
}
declare module "*.woff" {
  const path: string;
  export default path;
}
declare module "*.woff2" {
  const path: string;
  export default path;
}
declare module "*.ttf" {
  const path: string;
  export default path;
}
declare module "*.map" {
  const path: string;
  export default path;
}
declare module "*.sql" {
  const contents: string;
  export default contents;
}
