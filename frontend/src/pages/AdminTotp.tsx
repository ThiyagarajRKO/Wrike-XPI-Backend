import { useEffect, useRef, useState, type FormEvent } from "react";
import { clearTotpToken, getTotpToken, setAccessToken, verifyTotp } from "../lib/authApi";
import "./AdminTotp.css";

// Faithful React port of views/admin/totp.ejs - same markup/CSS/copy;
// numeric filtering, auto-submit-on-6-digits, and session-guard are all
// state/effect driven instead of manual DOM event wiring.
export default function AdminTotp() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!getTotpToken()) {
      window.location.href = "/admin/login";
      return;
    }
    inputRef.current?.focus();
  }, []);

  const submit = async (totpCode: string) => {
    if (submittingRef.current) return;

    setError(null);

    if (!/^\d{6}$/.test(totpCode)) {
      setError("Please enter a valid 6-digit code.");
      return;
    }

    const totpToken = getTotpToken();
    if (!totpToken) {
      setError("Session expired. Please login again.");
      window.location.href = "/admin/login";
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const accessToken = await verifyTotp(totpToken, totpCode);
      setAccessToken(accessToken);
      clearTotpToken();
      window.location.href = "/admin/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "TOTP verification failed");
      setLoading(false);
      submittingRef.current = false;
      setCode("");
      inputRef.current?.focus();
    }
  };

  const handleChange = (value: string) => {
    const digitsOnly = value.replace(/[^0-9]/g, "").slice(0, 6);
    setCode(digitsOnly);
    if (digitsOnly.length === 6) {
      submit(digitsOnly);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(code);
  };

  const handleBack = () => {
    clearTotpToken();
    window.location.href = "/admin/login";
  };

  return (
    <div className="totp-page">
      <div className="totp-card">
        <div className="card-brand">
          <svg className="wrike-logo" viewBox="0 0 100 20" role="img" aria-label="Wrike logo">
            <path d="M20.78 1.404C21.885.298 22.587 0 24.113 0h6.878c.561 0 .684.509.35.842l-11.49 11.491c-.176.176-.246.21-.352.246-.035.018-.087.018-.122.018s-.088 0-.123-.018c-.106-.035-.176-.07-.351-.246L14.85 8.281c-.175-.176-.21-.246-.245-.351-.018-.035-.018-.088-.018-.123s0-.088.018-.123c.035-.105.07-.175.245-.35l5.93-5.93zM10.745 8.649C9.64 7.544 8.92 7.263 7.395 7.263H.534c-.562 0-.685.509-.351.842l11.49 11.492c.176.175.246.21.352.245a.299.299 0 00.123.018c.035 0 .087 0 .122-.018.105-.035.176-.07.351-.245l4.053-4.07c.175-.176.21-.246.245-.351a.3.3 0 00.018-.123c0-.035 0-.088-.018-.123-.035-.105-.07-.175-.245-.351l-5.93-5.93z" />
            <path d="M71.064 4.72a1.965 1.965 0 100-3.93 1.965 1.965 0 000 3.93zm1.579 1.578h-3.158v11.035h3.158V6.298zm-9.877 11.035V12.37c0-3 2.649-2.948 4.035-2.72V6.263c-2.21-.193-3.526.421-4.123 1.614h-.07l.017-1.561h-3.07v11.018h3.21zm-22.685 0h2.474l3.79-7.087 3.666 7.087h2.509l5.632-11.035h-3.737l-3.456 7.035-3.281-7.035h-2.684l-3.456 7.07-3.281-7.07H34.52l5.561 11.035zm36.053 0h2l3.298-4.158 2.79 4.158h3.72l-4.387-6.386 3.842-4.649h-3.701l-4.386 5.544h-.07L79.275.79h-3.14v16.544zm18.228-2.368c1.351 0 2.158-.72 2.544-1.298l2.421 1.667c-.982 1.28-2.509 2.28-5.035 2.28-3.386 0-5.912-2.544-5.912-5.754 0-3.228 2.579-5.755 5.912-5.755 3.403 0 5.702 2.562 5.702 5.755v.877h-8.58c.246 1.316 1.37 2.228 2.948 2.228zm2.58-4.421c-.352-1.158-1.37-1.965-2.825-1.965-1.492 0-2.492.807-2.843 1.965h5.667z" />
          </svg>
          <span className="brand-sub">XPI &middot; Admin Portal</span>
        </div>

        <div className="shield-icon">
          <i className="fa-solid fa-shield-halved" />
        </div>
        <div className="card-title">Two-Factor Auth</div>
        <div className="card-sub">Enter the 6-digit code from your authenticator app</div>

        <div className={`alert-error${error ? " show" : ""}`}>
          <i className="fa-solid fa-circle-exclamation" />
          <span>{error}</span>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="totpCode">
              Authentication Code
            </label>
            <input
              ref={inputRef}
              className="otp-input"
              type="text"
              id="totpCode"
              name="totpCode"
              placeholder="••••••"
              maxLength={6}
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => handleChange(e.target.value)}
            />
          </div>

          <button type="submit" className={`btn-verify${loading ? " loading" : ""}`} disabled={loading}>
            <i className="fa-solid fa-check" />
            <span>Verify Code</span>
          </button>

          <button type="button" className="btn-back" onClick={handleBack}>
            <i className="fa-solid fa-arrow-left" style={{ fontSize: 11 }} />
            Back to Login
          </button>
        </form>

        <div className="info-row">
          Open Google Authenticator, Authy, or Microsoft Authenticator
          <br />
          and enter the 6-digit code shown for this account.
        </div>
      </div>
    </div>
  );
}
