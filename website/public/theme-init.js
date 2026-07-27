// Applied before React mounts so there's no flash of the wrong theme on load. Light is the
// default (the site's editorial, Apple-inspired system) — dark only applies if the visitor
// explicitly picked it last time.
if (localStorage.getItem("argus-site-theme") === "dark") {
  document.documentElement.setAttribute("data-theme", "dark");
} else {
  document.documentElement.setAttribute("data-theme", "light");
}
