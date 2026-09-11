import { useEffect, useState } from "react";
import {
  disableTotp,
  enableTotp,
  getTotpSetup,
  getTotpStatus,
  revealTotp,
  type TotpSetup,
} from "../lib/authApi";
import { Badge } from "../components/ui/Badge";
import { CopyButton } from "../components/ui/CopyButton";
import { toast } from "../lib/notify";
import "./MfaSettings.css";

type ViewState =
  | "loading"
  | "enabled"
  | "disabled"
  | "enrolling"
  | "disabling"
  | "revealing"
  | "revealed";

export default function MfaSettings() {
  const [view, setView] = useState<ViewState>("loading");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = () => {
    setView("loading");
    getTotpStatus()
      .then((enabled) => setView(enabled ? "enabled" : "disabled"))
      .catch((err: any) => {
        toast(err?.message || "Failed to load MFA status", "error");
        setView("disabled");
      });
  };

  useEffect(loadStatus, []);

  const startEnrollment = () => {
    setError(null);
    setTotpCode("");
    setBusy(true);
    getTotpSetup()
      .then((data) => {
        setSetup(data);
        setView("enrolling");
      })
      .catch((err: any) => setError(err?.message || "Failed to start MFA setup"))
      .finally(() => setBusy(false));
  };

  const confirmEnrollment = () => {
    if (!setup || totpCode.length !== 6) return;
    setError(null);
    setBusy(true);
    enableTotp(setup.secret, totpCode)
      .then(() => {
        toast("MFA enabled", "success");
        setSetup(null);
        setTotpCode("");
        setView("enabled");
      })
      .catch((err: any) => setError(err?.message || "Invalid code, try again"))
      .finally(() => setBusy(false));
  };

  const cancelEnrollment = () => {
    setSetup(null);
    setTotpCode("");
    setError(null);
    setView("disabled");
  };

  const startDisable = () => {
    setError(null);
    setPassword("");
    setDisableCode("");
    setView("disabling");
  };

  const confirmDisable = () => {
    if (!password || disableCode.length !== 6) return;
    setError(null);
    setBusy(true);
    disableTotp(password, disableCode)
      .then(() => {
        toast("MFA disabled", "success");
        setPassword("");
        setDisableCode("");
        setView("disabled");
      })
      .catch((err: any) => setError(err?.message || "Failed to disable MFA"))
      .finally(() => setBusy(false));
  };

  const cancelDisable = () => {
    setPassword("");
    setDisableCode("");
    setError(null);
    setView("enabled");
  };

  const startReveal = () => {
    setError(null);
    setPassword("");
    setSetup(null);
    setView("revealing");
  };

  const confirmReveal = () => {
    if (!password) return;
    setError(null);
    setBusy(true);
    revealTotp(password)
      .then((data) => {
        setSetup(data);
        setPassword("");
        setView("revealed");
      })
      .catch((err: any) => setError(err?.message || "Invalid password"))
      .finally(() => setBusy(false));
  };

  const cancelReveal = () => {
    setPassword("");
    setSetup(null);
    setError(null);
    setView("enabled");
  };

  return (
    <div className="mfa-card">
      <div className="mfa-switch-card">
        <div className="mfa-switch-info">
          <div className="mfa-switch-title">
            <i className="fa-solid fa-shield-halved" aria-hidden="true" /> Authenticator app (TOTP)
          </div>
          <div className="mfa-switch-desc">
            Require a 6-digit code from an app like Google Authenticator when signing in.
          </div>
        </div>
        {view === "loading" ? (
          <Badge tone="neutral">Checking…</Badge>
        ) : view === "enrolling" || view === "disabling" || view === "revealing" || view === "revealed" ? null : (
          <Badge tone={view === "enabled" ? "success" : "neutral"} dot>
            {view === "enabled" ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>

      {view === "disabled" && (
        <div className="mfa-action-row">
          <button className="btn btn-primary" disabled={busy} onClick={startEnrollment}>
            <i className="fa-solid fa-qrcode" /> Enable MFA
          </button>
        </div>
      )}

      {view === "enabled" && (
        <div className="mfa-action-row">
          <button className="btn btn-ghost" onClick={startReveal}>
            <i className="fa-solid fa-eye" /> View QR / Secret
          </button>
          <button className="btn btn-danger" onClick={startDisable}>
            <i className="fa-solid fa-lock-open" /> Disable MFA
          </button>
        </div>
      )}

      {view === "enrolling" && setup && (
        <div className="mfa-enroll">
          <div className="mfa-enroll-step">
            <div className="mfa-step-title">1. Scan this QR code</div>
            <div className="mfa-qr-wrap">
              <img src={setup.qrCodeImage} alt="TOTP QR code" width={180} height={180} />
            </div>
            <div className="mfa-secret-row">
              <span className="mfa-secret-label">Or enter this key manually:</span>
              <code className="mfa-secret-value">{setup.secret}</code>
              <CopyButton value={setup.secret} title="Copy setup key" />
            </div>
          </div>

          <div className="mfa-enroll-step">
            <div className="mfa-step-title">2. Enter the 6-digit code</div>
            <div className="form-group">
              <input
                className="form-control mfa-code-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && confirmEnrollment()}
              />
            </div>
            {error && <div className="mfa-error">{error}</div>}
            <div className="mfa-enroll-actions">
              <button className="btn btn-ghost" disabled={busy} onClick={cancelEnrollment}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || totpCode.length !== 6}
                onClick={confirmEnrollment}
              >
                {busy ? "Verifying…" : "Confirm & Enable"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "disabling" && (
        <div className="mfa-enroll">
          <div className="mfa-enroll-step">
            <div className="mfa-step-title">Confirm your password and current code</div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-control"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Authenticator code</label>
              <input
                className="form-control mfa-code-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && confirmDisable()}
              />
            </div>
            {error && <div className="mfa-error">{error}</div>}
            <div className="mfa-enroll-actions">
              <button className="btn btn-ghost" disabled={busy} onClick={cancelDisable}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={busy || !password || disableCode.length !== 6}
                onClick={confirmDisable}
              >
                {busy ? "Disabling…" : "Disable MFA"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "revealing" && (
        <div className="mfa-enroll">
          <div className="mfa-enroll-step">
            <div className="mfa-step-title">Confirm your password to view your MFA secret</div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-control"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmReveal()}
              />
            </div>
            {error && <div className="mfa-error">{error}</div>}
            <div className="mfa-enroll-actions">
              <button className="btn btn-ghost" disabled={busy} onClick={cancelReveal}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !password}
                onClick={confirmReveal}
              >
                {busy ? "Verifying…" : "View"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "revealed" && setup && (
        <div className="mfa-enroll">
          <div className="mfa-enroll-step">
            <div className="mfa-step-title">Your MFA QR code</div>
            <div className="mfa-qr-wrap">
              <img src={setup.qrCodeImage} alt="TOTP QR code" width={180} height={180} />
            </div>
            <div className="mfa-secret-row">
              <span className="mfa-secret-label">Setup key:</span>
              <code className="mfa-secret-value">{setup.secret}</code>
              <CopyButton value={setup.secret} title="Copy setup key" />
            </div>
          </div>

          <div className="mfa-enroll-step">
            <div className="mfa-step-title">&nbsp;</div>
            <p className="mfa-switch-desc">
              Scan this on another device to use the same account there, or re-add it if you lost
              access to your authenticator app.
            </p>
            <div className="mfa-enroll-actions">
              <button className="btn btn-ghost" onClick={cancelReveal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
