// Applied before React mounts so there's no flash of the wrong theme on load — light is the
// default, dark is only set if the operator explicitly chose it last time. A same-origin file,
// not an inline <script>, because the CSP's script-src is 'self' only (see api/server.ts).
if (localStorage.getItem("argus.theme") === "dark") {
  document.documentElement.setAttribute("data-theme", "dark");
}
