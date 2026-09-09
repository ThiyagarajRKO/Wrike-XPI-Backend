import { useEffect, useState } from "react";
import { buildTitle, getAppInfo } from "../lib/envTheme";
import { DEFAULT_CONFIG, type AppConfig } from "../lib/appConfig";

/*
 * App build version, rendered just after the "Xtend Backend" brand name in
 * the sidebar ("Xtend Backend  v1.0.0"): product name + version is the
 * meaningful pairing. Dim and normal-weight so the brand still leads; the
 * full commit / build time / branch sit in the hover tooltip. Renders
 * nothing until the version is known (e.g. API unreachable). The
 * sidebar-less pages get an injected equivalent from lib/envTheme.ts.
 */
export default function BuildTag() {
  const [info, setInfo] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let done = false;
    getAppInfo().then((c) => {
      if (!done) setInfo(c);
    });
    return () => {
      done = true;
    };
  }, []);

  if (!info.version) return null;

  return (
    <span
      title={buildTitle(info)}
      style={{
        marginLeft: 7,
        fontSize: "0.78em",
        fontWeight: 400,
        letterSpacing: 0,
        color: "var(--text-muted)",
        whiteSpace: "nowrap",
      }}
    >
      v{info.version}
    </span>
  );
}
