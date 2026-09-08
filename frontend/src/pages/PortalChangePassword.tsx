import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { changePortalPassword, getPortalRole, getPortalToken, portalHomeFor } from "../lib/portalAuthApi";
import "./PortalChangePassword.css";

interface PasswordFieldProps {
  id: string;
  label: string;
  icon: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  onInput?: (value: string) => void;
  extra?: ReactNode;
}

function PasswordField({
  id,
  label,
  icon,
  placeholder,
  autoComplete,
  value,
  onChange,
  onInput,
  extra,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className="input-wrap">
        <i className={`fa-solid ${icon} input-icon`} />
        <input
          className="form-control"
          type={visible ? "text" : "password"}
          id={id}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onInput?.(e.target.value);
          }}
        />
        <button
          type="button"
          className="toggle-pass"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
        >
          <i className={`fa-solid ${visible ? "fa-eye-slash" : "fa-eye"}`} />
        </button>
      </div>
      {extra}
    </div>
  );
}

const STRENGTH_MAP = [
  { w: "0%", bg: "", text: "" },
  { w: "25%", bg: "#ef4444", text: "Weak" },
  { w: "50%", bg: "#f59e0b", text: "Fair" },
  { w: "75%", bg: "#3b82f6", text: "Good" },
  { w: "100%", bg: "#008262", text: "Strong" },
];

const scoreOf = (value: string) => {
  let score = 0;
  if (value.length >= 8) score++;
  if (/[A-Z]/.test(value)) score++;
  if (/[0-9]/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  return score;
};

// Faithful React port of views/portal/change-password.ejs.
export default function PortalChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ type: "error" | "success"; message: string } | null>(null);

  useEffect(() => {
    if (!getPortalToken()) {
      window.location.replace("/portal/login");
    }
  }, []);

  const strength = STRENGTH_MAP[scoreOf(newPassword)];

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlert(null);

    if (newPassword !== confirmPassword) {
      setAlert({ type: "error", message: "New passwords do not match" });
      return;
    }
    if (newPassword.length < 8) {
      setAlert({ type: "error", message: "Password must be at least 8 characters" });
      return;
    }

    const token = getPortalToken();
    if (!token) {
      window.location.replace("/portal/login");
      return;
    }

    setLoading(true);
    try {
      await changePortalPassword(token, currentPassword, newPassword);
      setAlert({ type: "success", message: "Password updated. Redirecting..." });
      // Keep the button disabled/loading through the redirect delay too -
      // only the error path re-enables it, so a click can't land during the
      // 1.2s window between success and the page actually navigating away.
      setTimeout(() => {
        window.location.replace(portalHomeFor(getPortalRole()));
      }, 1200);
    } catch (err) {
      setAlert({
        type: "error",
        message: err instanceof Error ? err.message : "An unexpected error occurred",
      });
      setLoading(false);
    }
  };

  return (
    <div className="change-password-page">
      <div className="change-card">
        <div className="card-brand">
          <div className="logo-lockup">
            <div className="logo-mark">
              <svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0h4.8l3.6 9.6 3.6-9.6h4.8l-6 16H6L0 0zm14.4 0H24l-6 16h-4.8l3.6-9.6L14.4 0z" />
              </svg>
            </div>
            <span className="logo-name">WrikeXPI</span>
          </div>
          <span className="card-subtitle">Portal</span>
        </div>

        <div className="notice-banner">
          <i className="fa-solid fa-triangle-exclamation" />
          <span>You must set a new password before you can continue.</span>
        </div>

        <div className="form-heading">Set a new password</div>

        <div className={`alert-box${alert ? ` ${alert.type} visible` : ""}`}>
          <i className="fa-solid fa-circle-exclamation" />
          <span>{alert?.message}</span>
        </div>

        <form autoComplete="off" onSubmit={handleSubmit}>
          <PasswordField
            id="currentPassword"
            label="Current Password"
            icon="fa-lock"
            placeholder="Enter current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />

          <PasswordField
            id="newPassword"
            label="New Password"
            icon="fa-lock-open"
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
            extra={
              <>
                <div className="strength-bar">
                  <div
                    className="strength-fill"
                    style={{ width: strength.w, background: strength.bg }}
                  />
                </div>
                <div className="strength-label" style={{ color: strength.bg }}>
                  {strength.text}
                </div>
              </>
            }
          />

          <PasswordField
            id="confirmPassword"
            label="Confirm New Password"
            icon="fa-lock-open"
            placeholder="Re-enter new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />

          <button type="submit" className={`btn-primary${loading ? " loading" : ""}`} disabled={loading}>
            <div className="spinner" />
            <span className="btn-label">Update Password</span>
          </button>
        </form>
      </div>
    </div>
  );
}
