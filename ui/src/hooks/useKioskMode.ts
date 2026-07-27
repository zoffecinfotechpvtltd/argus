import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const ACTIVE_KEY = "argus.kiosk.active";
const STEP_KEY = "argus.kiosk.step";
/** Dashboard -> Topology -> Alerts -> repeat — the three pages a NOC wall display actually wants
 * to cycle through; other pages (Inventory forms, admin settings) don't belong in a passive loop. */
const KIOSK_PATHS = ["/", "/map", "/alerts"];
const STEP_MS = 20_000;
/** Ignore wake-triggering events for a moment right after entering — some browsers fire a
 * synthetic mousemove when the DOM changes under an already-resting cursor, which would otherwise
 * exit kiosk mode the instant it started. */
const WAKE_GRACE_MS = 800;

/**
 * NOC/TV "kiosk" mode: fullscreen, auto-rotates through Dashboard/Topology/Alerts on a timer, no
 * interaction required — exits the instant any real input arrives (mouse move, key, click), same
 * as how a screensaver wakes. State lives in sessionStorage (not persisted across browser
 * restarts, and not synced across tabs) so it survives the page navigations kiosk mode itself
 * triggers without needing a React context wrapping the whole route tree.
 */
export function useKioskMode() {
  const [active, setActive] = useState(() => sessionStorage.getItem(ACTIVE_KEY) === "1");
  const navigate = useNavigate();
  const location = useLocation();
  const graceRef = useRef(false);

  const exit = useCallback(() => {
    sessionStorage.removeItem(ACTIVE_KEY);
    sessionStorage.removeItem(STEP_KEY);
    setActive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const enter = useCallback(() => {
    sessionStorage.setItem(ACTIVE_KEY, "1");
    sessionStorage.setItem(STEP_KEY, "0");
    setActive(true);
    document.documentElement.requestFullscreen().catch(() => {});
    if (location.pathname !== KIOSK_PATHS[0]) navigate(KIOSK_PATHS[0]!);
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (!active) return;

    const advance = setTimeout(() => {
      const step = (Number(sessionStorage.getItem(STEP_KEY) ?? "0") + 1) % KIOSK_PATHS.length;
      sessionStorage.setItem(STEP_KEY, String(step));
      navigate(KIOSK_PATHS[step]!);
    }, STEP_MS);

    graceRef.current = true;
    const graceTimer = setTimeout(() => {
      graceRef.current = false;
    }, WAKE_GRACE_MS);

    function wake() {
      if (graceRef.current) return;
      exit();
    }
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    window.addEventListener("click", wake);

    return () => {
      clearTimeout(advance);
      clearTimeout(graceTimer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("click", wake);
    };
  }, [active, location.pathname, navigate, exit]);

  return { active, enter, exit };
}
