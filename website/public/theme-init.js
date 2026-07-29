// Applied before React mounts so there's no flash of the wrong theme on load. Dark is the
// default (a NOC command-center system built around the brand's signal/pulse mark) — light only
// applies if the visitor explicitly picked it last time.
if (localStorage.getItem("argus-site-theme") === "light") {
  document.documentElement.setAttribute("data-theme", "light");
} else {
  document.documentElement.setAttribute("data-theme", "dark");
}
