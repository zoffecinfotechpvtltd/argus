import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";

// M2: transport is SSE (EventSource), not a real WebSocket, despite the file/export names staying
// "Ws*" — every page already consumes events through useWsMessages()/useWsConnectionState(), so
// keeping those names is what let this swap happen without touching a single consumer. SSE is
// one-way (server -> client), which is all this was ever really used for; the old /ws route's
// client->server direction was an unused echo, not a real feature.
export type WsConnectionState = "connecting" | "open" | "reconnecting";
type Handler = (data: unknown) => void;

interface WsContextValue {
  state: WsConnectionState;
  subscribe: (handler: Handler) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

const RECONNECT_DELAY_MS = 2000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  // Mounted for every route, including public ones with no session yet (login, signup, the
  // status page) — without this check, EventSource would try /api/events/stream immediately,
  // get 401, and retry forever on pages that will never have anything to subscribe to.
  const { user } = useAuth();
  const [state, setState] = useState<WsConnectionState>("connecting");
  const handlersRef = useRef(new Set<Handler>());

  useEffect(() => {
    if (!user) return;
    let closedByUs = false;
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      // Cookies (the session) travel automatically with same-origin EventSource requests — no
      // token/header needed, same trust model the old WS upgrade request relied on.
      es = new EventSource("/api/events/stream");
      es.onopen = () => setState("open");
      es.addEventListener("message", (evt: MessageEvent<string>) => {
        let data: unknown;
        try {
          data = JSON.parse(evt.data);
        } catch {
          return;
        }
        handlersRef.current.forEach((h) => h(data));
      });
      // "keepalive" events (see api/server.ts) are deliberately not listened for here — EventSource
      // dispatches unrecognized named events nowhere unless something adds a listener for them, so
      // they're already invisible to consumers without any filtering on this end.
      es.onerror = () => {
        if (closedByUs) return;
        es.close();
        setState("reconnecting");
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [user]);

  function subscribe(handler: Handler) {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }

  return <WsContext.Provider value={{ state, subscribe }}>{children}</WsContext.Provider>;
}

export function useWsConnectionState(): WsConnectionState {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWsConnectionState must be used within WebSocketProvider");
  return ctx.state;
}

/** Subscribes to every SSE message. Also re-fires `onMessage({type:"__reconnected"})` when the connection recovers, so pages can resync. */
export function useWsMessages(onMessage: (data: unknown) => void) {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWsMessages must be used within WebSocketProvider");
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const prevState = useRef(ctx.state);
  useEffect(() => {
    if (prevState.current === "reconnecting" && ctx.state === "open") {
      handlerRef.current({ type: "__reconnected" });
    }
    prevState.current = ctx.state;
  }, [ctx.state]);

  useEffect(() => ctx.subscribe((data) => handlerRef.current(data)), [ctx]);
}
