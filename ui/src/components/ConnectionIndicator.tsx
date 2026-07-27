import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useWsConnectionState } from "../ws/WebSocketProvider";
import { Badge } from "./ui";

export function ConnectionIndicator() {
  const wsState = useWsConnectionState();
  const [lagging, setLagging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const status = await api.get<{ lagging: boolean }>("/engine/status");
        if (!cancelled) setLagging(status.lagging);
      } catch {
        /* transient — next poll will retry */
      }
    }
    poll();
    const interval = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (wsState === "reconnecting") {
    return (
      <Badge tone="critical">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Reconnecting…
      </Badge>
    );
  }

  if (lagging) {
    return (
      <Badge tone="warning">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Engine lagging
      </Badge>
    );
  }

  return (
    <Badge tone="success">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      Live
    </Badge>
  );
}
