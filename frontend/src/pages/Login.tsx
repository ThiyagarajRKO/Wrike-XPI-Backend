import { useEffect, useState, type FormEvent } from "react";
import { getAccessToken, login, setAccessToken, setTotpToken } from "../lib/authApi";
import "./Login.css";

// Faithful React port of the original views/admin/login.ejs design - same
// markup/classes/copy, but interactivity (password visibility, loading,
// error) is driven by React state instead of direct DOM manipulation.
export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getAccessToken()) {
      window.location.replace("/admin/dashboard");
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }

    setLoading(true);
    try {
      const result = await login(username.trim(), password);

      if (result.totpRequired && result.totpToken) {
        setTotpToken(result.totpToken);
        window.location.href = "/admin/totp";
        return;
      }

      if (result.accessToken) {
        setAccessToken(result.accessToken);
        window.location.href = "/admin/dashboard";
        return;
      }

      throw new Error("Login failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="card-brand">
          <svg className="wrike-logo" viewBox="0 0 100 20" role="img" aria-label="Wrike logo">
            <path d="M20.78 1.404C21.885.298 22.587 0 24.113 0h6.878c.561 0 .684.509.35.842l-11.49 11.491c-.176.176-.246.21-.352.246-.035.018-.087.018-.122.018s-.088 0-.123-.018c-.106-.035-.176-.07-.351-.246L14.85 8.281c-.175-.176-.21-.246-.245-.351-.018-.035-.018-.088-.018-.123s0-.088.018-.123c.035-.105.07-.175.245-.35l5.93-5.93zM10.745 8.649C9.64 7.544 8.92 7.263 7.395 7.263H.534c-.562 0-.685.509-.351.842l11.49 11.492c.176.175.246.21.352.245a.299.299 0 00.123.018c.035 0 .087 0 .122-.018.105-.035.176-.07.351-.245l4.053-4.07c.175-.176.21-.246.245-.351a.3.3 0 00.018-.123c0-.035 0-.088-.018-.123-.035-.105-.07-.175-.245-.351l-5.93-5.93z" />
            <path d="M71.064 4.72a1.965 1.965 0 100-3.93 1.965 1.965 0 000 3.93zm1.579 1.578h-3.158v11.035h3.158V6.298zm-9.877 11.035V12.37c0-3 2.649-2.948 4.035-2.72V6.263c-2.21-.193-3.526.421-4.123 1.614h-.07l.017-1.561h-3.07v11.018h3.21zm-22.685 0h2.474l3.79-7.087 3.666 7.087h2.509l5.632-11.035h-3.737l-3.456 7.035-3.281-7.035h-2.684l-3.456 7.07-3.281-7.07H34.52l5.561 11.035zm36.053 0h2l3.298-4.158 2.79 4.158h3.72l-4.387-6.386 3.842-4.649h-3.701l-4.386 5.544h-.07L79.275.79h-3.14v16.544zm18.228-2.368c1.351 0 2.158-.72 2.544-1.298l2.421 1.667c-.982 1.28-2.509 2.28-5.035 2.28-3.386 0-5.912-2.544-5.912-5.754 0-3.228 2.579-5.755 5.912-5.755 3.403 0 5.702 2.562 5.702 5.755v.877h-8.58c.246 1.316 1.37 2.228 2.948 2.228zm2.58-4.421c-.352-1.158-1.37-1.965-2.825-1.965-1.492 0-2.492.807-2.843 1.965h5.667z" />
          </svg>
          <span className="brand-sub">XPI &middot; Admin Portal</span>
        </div>

        <div className="card-title">Admin Sign In</div>
        <div className="card-sub">Enter your credentials to access the dashboard</div>

        <div className={`alert-error${error ? " show" : ""}`}>
          <i className="fa-solid fa-circle-exclamation" />
          <span>{error}</span>
        </div>

        <form autoComplete="off" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              Username
            </label>
            <div className="input-wrap">
              <div className="input-prefix">
                <i className="fa-solid fa-user" />
              </div>
              <input
                className="form-control"
                type="text"
                id="username"
                placeholder="your-username"
                required
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Password
            </label>
            <div className="input-wrap">
              <div className="input-prefix">
                <i className="fa-solid fa-lock" />
              </div>
              <input
                className="form-control"
                type={showPassword ? "text" : "password"}
                id="password"
                placeholder="••••••••••"
                required
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="pw-toggle"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <i className={`fa-regular ${showPassword ? "fa-eye-slash" : "fa-eye"}`} />
              </button>
            </div>
          </div>

          <button type="submit" className={`btn-submit${loading ? " loading" : ""}`} disabled={loading}>
            <i className="fa-solid fa-arrow-right-to-bracket" />
            <span>Sign In</span>
          </button>
        </form>

        <div className="trust-row">
          <i className="fa-solid fa-shield-halved" style={{ color: "var(--success)", fontSize: 11 }} />
          <span>Secure connection</span>
          <span className="trust-dot" />
          <span>2FA enabled</span>
          <span className="trust-dot" />
          <span>Encrypted storage</span>
        </div>
      </div>
    </div>
  );
}
