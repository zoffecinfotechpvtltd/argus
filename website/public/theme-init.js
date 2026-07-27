// Applied before React mounts so there's no flash of the wrong theme on load. Dark is the default
// here (this site is built around the dark "Monolith Signal" brand concept) — light only applies
// if the visitor explicitly picked it last time.
if (localStorage.getItem("argus-site-theme") === "light") {
  document.documentElement.setAttribute("data-theme", "light");
} else {
  document.documentElement.setAttribute("data-theme", "dark");
}
