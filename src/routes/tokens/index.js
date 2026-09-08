import { WrikeTokenExchange } from "./handlers/wrikeTokenExchange";
import { GetUserData } from "./handlers/getUserData";
import { Tokens } from "../../controllers";

import { WrikeTokenExchangeSchema } from "./schema/wrikeTokenExchange";
import { GetUserDataSchema } from "./schema/getUserData";
import { ValidateJWT } from "../../middlewares/authentication";
import { log as logActivity } from "../../utils/activityLog";
import {
  captureRequest,
  // buildResponseSnapshot, // response-payload capture disabled for now
} from "../../utils/capture";

const ACTION_BY_METHOD = {
  GET: "read",
  HEAD: "read",
  OPTIONS: "read",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};
const actionForMethod = (method) =>
  ACTION_BY_METHOD[String(method || "").toUpperCase()] || null;

export const tokenRoute = (fastify, opts, done) => {
  // Token-service calls (OAuth exchange/callback/profile) are logged to the
  // audit log too — category "token" — so token traffic is visible beside
  // API/MCP calls. Anything secret in these calls (authorization codes,
  // refresh tokens, state) is redacted by captureRequest before storage.
  // Response-payload capture disabled for now (kept in git history).
  // fastify.addHook("onSend", (req, reply, payload, done) => {
  //   try {
  //     if (payload !== undefined && payload !== null && typeof payload !== "function") {
  //       req.activityResponsePayload = buildResponseSnapshot(reply.statusCode, payload);
  //     }
  //   } catch {
  //     req.activityResponsePayload = null;
  //   }
  //   done();
  // });
  fastify.addHook("onResponse", (req, reply, done) => {
    const resource =
      req.routeOptions?.url ||
      String(req.raw?.url || req.url || "").split("?")[0];
    logActivity({
      envId: null,
      environmentName: null,
      surface: "rest",
      actorEmail: null,
      action: actionForMethod(req.method),
      resource,
      method: req.method,
      allowed: reply.statusCode < 400,
      code: reply.statusCode >= 400 ? "TOKEN_ERROR" : null,
      statusCode: reply.statusCode,
      ip: req.ip || null,
      category: "token",
      requestPayload: captureRequest(req),
      // responsePayload: req.activityResponsePayload || null, // disabled for now
    });
    done();
  });

  fastify.post("/profile", GetUserDataSchema, async (req, reply) => {
    try {
      const token = req.body?.token;

      if (!token) return reject({ message: "Access Token must not be empty" });

      const wrikeToken = await ValidateJWT(token);

      const result = await GetUserData(wrikeToken, fastify);

      return reply.code(200).send({
        success: true,
        message: result?.message,
        data: result,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: true,
        message: err?.message,
        data: null,
      });
    }
  });

  fastify.get("/exchange", WrikeTokenExchangeSchema, async (req, reply) => {
    try {
      const result = await WrikeTokenExchange(req.query, fastify);

      if (!result)
        return reply.code(400).send({
          success: false,
          message: "Failed to process callback",
        });

      return reply.code(200).send({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error("Error processing /exchange:", err);
      return reply.code(400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  fastify.get("/callback", WrikeTokenExchangeSchema, async (req, reply) => {
    try {
      let decodedData;
      if (req.query.state) {
        decodedData = fastify.jwt.verify(req.query.state);

        if (decodedData.redirectUri) {
          // MCP OAuth flow (/oauth/authorize set code_challenge in state): wrap
          // Wrike's raw code in a short-lived signed JWT carrying the PKCE
          // challenge, so /oauth/token can verify code_verifier before ever
          // spending it — the MCP client never sees Wrike's raw code.
          if (decodedData.code_challenge) {
            const wrappedCode = fastify.jwt.sign(
              {
                wrikeCode: req.query.code,
                environmentId: decodedData.environmentId,
                code_challenge: decodedData.code_challenge,
                code_challenge_method: decodedData.code_challenge_method,
                redirect_uri: decodedData.redirectUri,
              },
              { expiresIn: "60s" },
            );

            const relayUrl = new URL(decodedData.redirectUri);
            relayUrl.searchParams.set("code", wrappedCode);
            if (decodedData.client_state) {
              relayUrl.searchParams.set("state", decodedData.client_state);
            }
            return reply.redirect(relayUrl.toString());
          }

          // Construct the final redirect URL
          const redirectUrl = `${decodedData.redirectUri}?code=${req.query.code}&environmentId=${decodedData?.environmentId || null}`;

          // Redirect the user
          return reply.redirect(redirectUrl);
        }
      }

      const result = await WrikeTokenExchange(
        { ...req.query, ...decodedData },
        fastify,
      );

      if (!result) {
        return reply.code(400).send({
          success: false,
          message: "Failed to process callback",
        });
      }

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>WrikeXPI Secure Token</title>
  <link rel="icon" href="https://cdn.wrike.com/static/branding/wrike/favicons/favicon.ico">
  <style>
    :root {
      --accent: #4CAF50;
      --bg-blur: rgba(255, 255, 255, 0.06);
      --border-light: rgba(255, 255, 255, 0.15);
      --text-subtle: #cccccc;
      --warning: #ff9800;
    }
    
    .credentials-box {
      background: var(--bg-blur);
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }

    .warning {
      color: var(--warning);
      font-weight: bold;
    }

    .credential-item {
      margin: 10px 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .credential-item label {
      font-weight: bold;
      min-width: 100px;
    }

    .credential-item code {
      background: rgba(0,0,0,0.2);
      padding: 4px 8px;
      border-radius: 4px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', sans-serif;
      background: linear-gradient(-45deg, #1f1c2c, #928dab, #2e2e52, #515175);
      background-size: 400% 400%;
      animation: gradient 15s ease infinite;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    @keyframes gradient {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .card {
      backdrop-filter: blur(20px);
      background-color: var(--bg-blur);
      border: 1px solid var(--border-light);
      border-radius: 24px;
      padding: 50px 40px;
      max-width: 760px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      animation: popIn 0.7s ease-out;
      transform-origin: center;
    }

    .credentials-section {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border-light);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 30px;
      text-align: left;
    }

    .credentials-section h3,
    .token-section h3 {
      margin-bottom: 15px;
      color: #fff;
      font-size: 1.2rem;
      opacity: 0.9;
    }

    .warning {
      color: #ff9800;
      margin-bottom: 15px;
      font-weight: bold;
    }

    .credential-item {
      display: flex;
      align-items: center;
      margin: 10px 0;
      gap: 10px;
    }

    .credential-item label {
      min-width: 100px;
      font-weight: bold;
      color: rgba(255, 255, 255, 0.8);
    }

    .code-with-copy {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .credential-item code {
      background: rgba(0, 0, 0, 0.3);
      padding: 5px 10px;
      border-radius: 4px;
      font-family: monospace;
      flex: 1;
    }

    .copy-icon {
      background: transparent;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.6);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .copy-icon:hover {
      color: white;
      background: rgba(255, 255, 255, 0.1);
    }

    .token-section {
      margin-top: 20px;
    }

    @keyframes popIn {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(20px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .card h1 {
      font-size: 1.9rem;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    .card h1 svg {
      width: 28px;
      height: 28px;
      fill: var(--accent);
    }

    .token-box {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 20px;
      border-radius: 12px;
      font-family: monospace;
      font-size: 0.9rem;
      color: #e0e0e0;
      text-align: left;
      max-height: 300px;
      overflow-y: auto;
      word-wrap: break-word;
      transition: box-shadow 0.3s ease;
    }

    .token-box:hover {
      box-shadow: 0 0 0 2px var(--accent);
    }

    .copy-btn {
      margin-top: 25px;
      background: var(--accent);
      border: none;
      padding: 14px 24px;
      border-radius: 10px;
      color: white;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .copy-btn:hover {
      background: #3da543;
      transform: translateY(-1px);
    }

    .success-msg {
      margin-top: 14px;
      font-size: 0.9rem;
      color: #90ee90;
      display: none;
    }
  </style>
</head>
<body>
    <div class="card">
      <h1>WrikeXPI Secure Token</h1>
      
      <div class="credentials-section">
        <h3>Your API Access Credentials</h3>
        <p class="warning">${result.credentials.message}</p>
        <div class="credential-item">
          <label>Username:</label>
          <div class="code-with-copy">
            <code>${result.credentials.username}</code>
            <button class="copy-icon" onclick="copyCredential('${result.credentials.username}', 'username')">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="credential-item">
          <label>Password:</label>
          <div class="code-with-copy">
            <code>${result.credentials.password}</code>
            <button class="copy-icon" onclick="copyCredential('${result.credentials.password}', 'password')">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="token-section">
        <h3>JWT Token</h3>
        <div class="token-box" id="tokenBox">${result.token}</div>
        <button class="copy-btn" onclick="copyToken()">Copy Token to Clipboard</button>
        <div class="success-msg" id="successMsg">Token copied to clipboard ✅</div>
      </div>
    </div>  <script>
    function copyToken() {
      const token = document.getElementById("tokenBox").innerText;
      navigator.clipboard.writeText(token).then(() => {
        const msg = document.getElementById("successMsg");
        msg.style.display = "block";
        setTimeout(() => {
          msg.style.display = "none";
        }, 2500);
      });
    }

    function copyCredential(text, type) {
      navigator.clipboard.writeText(text).then(() => {
        const msg = document.getElementById("successMsg");
        msg.textContent = \`\${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard ✅\`;
        msg.style.display = "block";
        setTimeout(() => {
          msg.style.display = "none";
          msg.textContent = "Token copied to clipboard ✅";
        }, 2500);
      });
    }
  </script>
</body>
</html>
`;

      reply.type("text/html").send(html);
    } catch (err) {
      // reply.code(err?.statusCode || 400).send({
      //   success: false,
      //   message: err?.message || err,
      // });

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Error</title>
  <link rel="icon" href="https://cdn.wrike.com/static/branding/wrike/favicons/favicon.ico">
  <style>
    :root {
      --accent: #ff5252;
      --bg-blur: rgba(255, 255, 255, 0.06);
      --border-light: rgba(255, 255, 255, 0.15);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', sans-serif;
      background: linear-gradient(-45deg, #1f1c2c, #928dab, #2e2e52, #515175);
      background-size: 400% 400%;
      animation: gradient 15s ease infinite;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    @keyframes gradient {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .card {
      backdrop-filter: blur(20px);
      background-color: var(--bg-blur);
      border: 1px solid var(--border-light);
      border-radius: 24px;
      padding: 40px 30px;
      max-width: 600px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: fadeIn 0.7s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .card h1 {
      font-size: 1.8rem;
      margin-bottom: 10px;
      color: var(--accent);
    }

    .message {
      font-size: 1rem;
      color: #ddd;
      margin: 16px 0 28px;
    }

    .btn {
      background: var(--accent);
      border: none;
      padding: 12px 20px;
      border-radius: 10px;
      color: white;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
      transition: background 0.3s ease;
    }

    .btn:hover {
      background: #e64a4a;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Oops! Something went wrong</h1>
    <div class="message">${err?.message || "Unexpected error occurred"}</div>
    <a class="btn" href="${process.env.API_URL}">⬅ Back to Login</a>
  </div>
</body>
</html>
`;

      reply
        .code(err?.statusCode || 400)
        .type("text/html")
        .send(html);
    }
  });

  fastify.get("/evaluate", async (req, reply) => {
    const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Evaluate Token</title>
    <link rel="icon" href="https://cdn.wrike.com/static/branding/wrike/favicons/favicon.ico">
    <style>
      :root {
        --accent: #4CAF50;
        --bg-blur: rgba(255, 255, 255, 0.06);
        --border-light: rgba(255, 255, 255, 0.15);
        --text-subtle: #cccccc;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: 'Inter', sans-serif;
        background: linear-gradient(-45deg, #1f1c2c, #928dab, #2e2e52, #515175);
        background-size: 400% 400%;
        animation: gradient 15s ease infinite;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        padding: 20px;
      }

      @keyframes gradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }

      .card {
        backdrop-filter: blur(20px);
        background-color: var(--bg-blur);
        border: 1px solid var(--border-light);
        border-radius: 24px;
        padding: 40px 30px;
        max-width: 760px;
        width: 100%;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        animation: popIn 0.7s ease-out;
      }

      @keyframes popIn {
        from { opacity: 0; transform: scale(0.96) translateY(20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      h1 {
        font-size: 1.9rem;
        margin-bottom: 20px;
      }

      textarea {
        width: 100%;
        height: 140px;
        border-radius: 12px;
        border: 1px solid var(--border-light);
        padding: 15px;
        font-size: 0.95rem;
        font-family: monospace;
        resize: none;
        background: rgba(255,255,255,0.05);
        color: #e0e0e0;
        margin-bottom: 20px;
        transition: border 0.3s ease, box-shadow 0.3s ease;
      }

      textarea:focus {
        border: none;
        outline: none;
        box-shadow: 0 0 0 2px var(--accent);
      }

      textarea::placeholder {
        color: white;
        opacity: 0.6; /* optional: makes the text a bit more subtle */
      }

      .btn-group {
        display: flex;
        gap: 15px;
        justify-content: center;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }

      button {
        background: var(--accent);
        border: none;
        padding: 12px 24px;
        border-radius: 10px;
        color: white;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      button:hover {
        background: #3da543;
        transform: translateY(-1px);
      }

      button:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .token-result {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid var(--border-light);
        padding: 20px;
        border-radius: 12px;
        font-family: monospace;
        font-size: 0.9rem;
        color: #e0e0e0;
        text-align: left;
        max-height: 300px;
        margin-top: 10px;
        overflow-y: auto;
        word-wrap: break-word;
        display: none;
      }

      .token-box {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 15px;
        border-radius: 12px;
        font-family: monospace;
        font-size: 0.9rem;
        color: #e0e0e0;
        text-align: left;
        max-height: 300px;
        overflow-y: auto;
        word-wrap: break-word;
        transition: box-shadow 0.3s ease;
      }

      .token-box:hover {
        box-shadow: 0 0 0 2px var(--accent);
      }

      .error {
        color: #ff9999;
        margin-top: 15px;
      }

      .success {
        color: #90ee90;
        margin-top: 15px;
      }

      .loader {
        border: 3px solid rgba(255,255,255,0.2);
        border-top: 3px solid white;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        animation: spin 1s linear infinite;
        display: inline-block;
        vertical-align: middle;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

    </style>
  </head>
  <body>
    <div class="card">
      <h1>Evaluate JWT Token</h1>
      <textarea class="token-box" id="tokenInput" placeholder="Paste your JWT token here..."></textarea>
      <div class="btn-group">
        <button onclick="pasteToken()">Paste from Clipboard</button>
        <button id="verifyBtn" onclick="verifyToken()">
          <span id="verifyText">Verify Token</span>
          <span id="verifyLoader" class="loader" style="display: none;"></span>
        </button>
      </div>
      <div id="feedback" class="success"></div>
      <pre id="tokenResult" class="token-result"></pre>
    </div>

    <script>
      async function pasteToken() {
        try {
          const text = await navigator.clipboard.readText();
          document.getElementById('tokenInput').value = text;
        } catch (err) {
          alert("Clipboard access denied.");
        }
      }

      async function verifyToken() {
        const token = document.getElementById('tokenInput').value.trim();
        const feedback = document.getElementById('feedback');
        const resultBox = document.getElementById('tokenResult');
        const verifyBtn = document.getElementById('verifyBtn');
        const verifyText = document.getElementById('verifyText');
        const verifyLoader = document.getElementById('verifyLoader');

        feedback.textContent = '';
        resultBox.textContent = '';
        resultBox.style.display = 'none';

        if (!token) {
          feedback.textContent = '⚠️ Please enter a token.';
          feedback.className = 'error';
          return;
        }

        // Show loader and disable button
        verifyLoader.style.display = 'inline-block';
        verifyText.style.display = 'none';
        verifyBtn.disabled = true;

        try {
          const res = await fetch('${process.env.API_URL}/wrikexpi/token/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });

          const data = await res.json();

          if (res.ok) {
            feedback.textContent = '✅ Welcome, ' + data?.data?.firstName + '!';
            feedback.className = 'success';
            resultBox.style.display = 'block';
            resultBox.textContent = JSON.stringify(data?.data, null, 4);
          } else {
            feedback.textContent = '❌ Invalid token or verification failed.';
            feedback.className = 'error';
            resultBox.style.display = 'block';
            resultBox.textContent = JSON.stringify(data?.message, null, 2);
          }
        } catch (err) {
          feedback.textContent = '⚠️ Error verifying token.';
          feedback.className = 'error';
        } finally {
          // Hide loader and enable button again
          verifyLoader.style.display = 'none';
          verifyText.style.display = 'inline';
          verifyBtn.disabled = false;
        }
      }
    </script>
  </body>
  </html>
  `;

    reply.type("text/html").send(html);
  });

  fastify.get("/view", async (req, reply) => {
    const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>View User Tokens</title>
    <link rel="icon" href="https://cdn.wrike.com/static/branding/wrike/favicons/favicon.ico">
    <link rel="stylesheet" href="https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css">
    <style>
      :root {
        --accent: #4CAF50;
        --bg-blur: rgba(255, 255, 255, 0.06);
        --border-light: rgba(255, 255, 255, 0.15);
        --text-subtle: #cccccc;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: 'Inter', sans-serif;
        background: linear-gradient(-45deg, #1f1c2c, #928dab, #2e2e52, #515175);
        background-size: 400% 400%;
        animation: gradient 15s ease infinite;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        padding: 20px;
      }

      @keyframes gradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }

      .card {
        backdrop-filter: blur(20px);
        background-color: var(--bg-blur);
        border: 1px solid var(--border-light);
        border-radius: 24px;
        padding: 40px 30px;
        max-width: 1000px;
        width: 100%;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        animation: popIn 0.7s ease-out;
      }

      @keyframes popIn {
        from { opacity: 0; transform: scale(0.96) translateY(20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      h1 {
        font-size: 1.9rem;
        margin-bottom: 20px;
      }

      textarea {
        width: 100%;
        height: 140px;
        border-radius: 12px;
        border: 1px solid var(--border-light);
        padding: 15px;
        font-size: 0.95rem;
        font-family: monospace;
        resize: none;
        background: rgba(255,255,255,0.05);
        color: #e0e0e0;
        margin-bottom: 20px;
        transition: border 0.3s ease, box-shadow 0.3s ease;
      }

      textarea:focus {
        border: none;
        outline: none;
        box-shadow: 0 0 0 2px var(--accent);
      }

      textarea::placeholder {
        color: white;
        opacity: 0.6;
      }

      .btn-group {
        display: flex;
        gap: 15px;
        justify-content: center;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }

      button {
        background: var(--accent);
        border: none;
        padding: 12px 24px;
        border-radius: 10px;
        color: white;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      button:hover {
        background: #3da543;
        transform: translateY(-1px);
      }

      button:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .input-section {
        transition: all 0.4s ease;
      }

      .input-section.hidden {
        display: none;
        opacity: 0;
        transform: translateY(-20px);
      }

      /* DataTables styling */
      .dataTables_wrapper {
        margin-top: 20px;
      }

      .dataTables_filter {
        margin-bottom: 15px;
        text-align: left;
      }

      .dataTables_filter input {
        background: rgba(255,255,255,0.05);
        border: 1px solid var(--border-light);
        border-radius: 8px;
        padding: 8px 12px;
        color: #e0e0e0;
        font-size: 0.9rem;
      }

      .dataTables_filter input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
        outline: none;
      }

      .dataTables_length {
        margin-bottom: 15px;
        text-align: left;
      }

      .dataTables_length select {
        background: rgba(255,255,255,0.05);
        border: 1px solid var(--border-light);
        border-radius: 8px;
        padding: 6px 10px;
        color: #e0e0e0;
        font-size: 0.9rem;
      }

      .table-container {
        // margin-top: 30px;
        display: none;
        overflow-x: auto;
        animation: slideIn 0.5s ease-out;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        overflow: hidden;
        color: #e0e0e0;
        margin-top: 10px;
      }

      th, td {
        padding: 16px 18px;
        text-align: left;
        border-bottom: 1px solid var(--border-light);
      }

      th {
        background: rgba(255, 255, 255, 0.1);
        font-weight: 600;
      }

      .error {
        color: #ff9999;
        margin-top: 20px;
        margin-bottom: 10px;
        text-align: center;
        font-size: 1.1rem;
        font-weight: 500;
      }

      .success {
        color: #90ee90;
        margin-top: 20px;
        margin-bottom: 10px;
        text-align: center;
        font-size: 1.1rem;
        font-weight: 500;
      }

      .loader {
        border: 3px solid rgba(255,255,255,0.2);
        border-top: 3px solid white;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        animation: spin 1s linear infinite;
        display: inline-block;
        vertical-align: middle;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>View User Tokens</h1>
      <div class="input-section" id="inputSection">
        <textarea class="token-box" id="tokenInput" placeholder="Paste your JWT token here..."></textarea>
        <div class="btn-group">
          <button onclick="pasteToken()">Paste from Clipboard</button>
          <button id="viewBtn" onclick="viewTokens()">
            <span id="viewText">View Tokens</span>
            <span id="viewLoader" class="loader" style="display: none;"></span>
          </button>
        </div>
      </div>
      <div id="feedback" class="success"></div>
      <div class="table-container" id="tableContainer">
        <table id="tokensTable">
          <thead>
            <tr>
              <th>Token ID</th>
              <th>Account ID</th>
              <th>Created At</th>
              <th>Updated At</th>
            </tr>
          </thead>
          <tbody id="tokensTableBody">
          </tbody>
        </table>
      </div>
    </div>

    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>
    <script>
      async function pasteToken() {
        try {
          const text = await navigator.clipboard.readText();
          document.getElementById('tokenInput').value = text;
        } catch (err) {
          alert("Clipboard access denied.");
        }
      }

      async function viewTokens() {
        const token = document.getElementById('tokenInput').value.trim();
        const feedback = document.getElementById('feedback');
        const tableContainer = document.getElementById('tableContainer');
        const tableBody = document.getElementById('tokensTableBody');
        const viewBtn = document.getElementById('viewBtn');
        const viewText = document.getElementById('viewText');
        const viewLoader = document.getElementById('viewLoader');

        feedback.textContent = '';
        tableContainer.style.display = 'none';
        tableBody.innerHTML = '';

        // Reset input section visibility
        const inputSection = document.getElementById('inputSection');
        inputSection.classList.remove('hidden');

        if (!token) {
          feedback.textContent = '⚠️ Please enter a token.';
          feedback.className = 'error';
          return;
        }

        // Show loader and disable button
        viewLoader.style.display = 'inline-block';
        viewText.style.display = 'none';
        viewBtn.disabled = true;

        try {
          const res = await fetch('${process.env.API_URL}/wrikexpi/token/view-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });

          const data = await res.json();

          if (res.ok && data?.data?.length > 0) {
            feedback.textContent = '✅ Found ' + data.data.length + ' token(s).';
            feedback.className = 'success';
            tableContainer.style.display = 'block';

            // Hide input section
            const inputSection = document.getElementById('inputSection');
            inputSection.classList.add('hidden');

            data.data.forEach(tokenData => {
              const row = document.createElement('tr');
              row.innerHTML = \`
                <td>\${tokenData.id}</td>
                <td>\${tokenData.account_id || 'N/A'}</td>
                <td>\${new Date(tokenData.created_at).toLocaleString()}</td>
                <td>\${tokenData.updated_at ? new Date(tokenData.updated_at).toLocaleString() : '-'}</td>
              \`;
              tableBody.appendChild(row);
            });

            $('#tokensTable').DataTable({
              paging: true,
              searching: true,
              ordering: true,
              info: true,
              responsive: true
            });
          } else {
            feedback.textContent = '❌ No tokens found or invalid token.';
            feedback.className = 'error';
            // Show input section again on error
            const inputSection = document.getElementById('inputSection');
            inputSection.classList.remove('hidden');
          }
        } catch (err) {
          feedback.textContent = '⚠️ Error fetching tokens.';
          feedback.className = 'error';
          // Show input section again on error
          const inputSection = document.getElementById('inputSection');
          inputSection.classList.remove('hidden');
        } finally {
          // Hide loader and enable button again
          viewLoader.style.display = 'none';
          viewText.style.display = 'inline';
          viewBtn.disabled = false;
        }
      }
    </script>
  </body>
  </html>
  `;

    reply.type("text/html").send(html);
  });

  fastify.post("/view-tokens", async (req, reply) => {
    try {
      const { token } = req.body;

      if (!token) {
        return reply.code(400).send({
          success: false,
          message: "Token must not be empty",
        });
      }

      const { tid } = await fastify.jwt.verify(token);

      if (!tid) {
        return reply.code(400).send({
          success: false,
          message: "Invalid Token",
        });
      }

      const userToken = await Tokens.GetById(tid);

      if (!userToken) {
        return reply.code(400).send({
          success: false,
          message: "Token not found",
        });
      }

      const userTokens = await Tokens.GetAllByUserId(userToken.created_by);

      return reply.code(200).send({
        success: true,
        message: "Tokens retrieved successfully",
        data: userTokens,
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err?.message || "Error retrieving tokens",
      });
    }
  });

  done();
};

export default tokenRoute;
