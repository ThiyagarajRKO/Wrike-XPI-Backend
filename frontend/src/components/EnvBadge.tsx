import { useEffect, useState } from "react";
import { envPalette, getEnvironment } from "../lib/envTheme";

/*
 * Small pill naming the current server environment (LOCAL / DEVELOPMENT /
 * UAT ...), tinted with --accent. Sits inline in the sidebar brand row.
 * Renders nothing on LIVE or any unrecognised NODE_ENV. The accent-colour
 * half of the same signal lives in lib/envTheme.ts.
 *
 * Self-contained on purpose: reuses envTheme's single shared fetch, so
 * dropping it into a page needs no prop threading.
 */
export default function EnvBadge() {
  const [env, setEnv] = useState("");

  useEffect(() => {
    let done = false;
    getEnvironment().then((e) => {
      if (!done) setEnv(e);
    });
    return () => {
      done = true;
    };
  }, []);

  if (!envPalette(env)) return null;

  return (
    <span
      title={`Environment: ${env}`}
      style={{
        flexShrink: 0,
        alignSelf: "center",
        padding: "2px 6px",
        borderRadius: 4,
        background: "var(--accent)",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.4,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {env}
    </span>
  );
}
