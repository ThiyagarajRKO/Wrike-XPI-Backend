import {
  actionForMethod,
  evaluateAccess,
  isEnforced,
} from "../utils/accessControl";

/**
 * Authorization for the REST API, run as the hook immediately after
 * ValidateToken (see src/routes/index.js).
 *
 * Authentication answered "is this a real token?". This answers "is the human
 * behind it allowed to do this, here?" — the allow list, the Xtend API flag,
 * and the CRUD grant, all evaluated in src/utils/accessControl.js.
 */

/**
 * Routes that stay reachable for an authenticated-but-unauthorized caller, so
 * a client can discover *why* it was refused instead of getting a bare 403 on
 * everything. The gates still run for these — only the refusal is withheld,
 * because the whole point of /whoami is to hand back that decision. Matched
 * against the raw path.
 */
const ALWAYS_ALLOWED = [/\/whoami(\?|$)/i];

const denial = (decision) => ({
  success: false,
  message: decision.message,
  error: {
    code: decision.code,
    // The gate list is the caller's self-diagnosis path: it says which of the
    // three checks refused them, so support can be a one-line answer rather
    // than a log dig.
    checks: (decision.gates || []).map((g) => ({
      check: g.label,
      status: g.status,
      detail: g.detail,
    })),
  },
});

export const AuthorizeRequest = async (req, reply) => {
  try {
    // ValidateToken already replied 401 — nothing left to authorize.
    if (!req.wrikeToken) return;

    const diagnostic = ALWAYS_ALLOWED.some((pattern) =>
      pattern.test(req.raw?.url || ""),
    );

    const action = actionForMethod(req.method);

    const decision = await evaluateAccess({
      envId: req.envId,
      environmentName: req.environmentName,
      wrikeToken: req.wrikeToken,
      action,
    });

    // Everything downstream can read the caller's identity and grants without
    // re-running the gates — handlers, audit logging, and response shaping.
    req.access = decision;
    req.actorEmail = decision.email || null;

    if (decision.allowed || diagnostic) return;

    if (!isEnforced()) {
      // Audit mode: the deployment has explicitly opted out of enforcement
      // (ACCESS_CONTROL_ENABLED=false) while an allow list is being built up.
      // Log the refusal that *would* have happened and let the call through.
      req.log?.warn?.(
        {
          code: decision.code,
          email: decision.email,
          action,
          path: req.raw?.url,
        },
        "[access] would deny (enforcement disabled)",
      );
      return;
    }

    return reply.code(403).send(denial(decision));
  } catch (err) {
    console.error(new Date().toISOString(), "[access] evaluation error:", err);

    const failure = {
      allowed: false,
      code: "AUTHORIZATION_ERROR",
      message: "Access could not be verified for this request.",
      gates: [],
    };
    req.access = failure;

    // The diagnostic route reports the failure instead of being blocked by it
    // — a caller trying to work out what is wrong should not be met with the
    // same silence as the call that failed.
    if (ALWAYS_ALLOWED.some((pattern) => pattern.test(req.raw?.url || ""))) {
      return;
    }

    // Otherwise fail closed. An authorization layer that opens up when it
    // breaks is not an authorization layer.
    return reply.code(403).send({
      success: false,
      message: failure.message,
      error: { code: failure.code, checks: [] },
    });
  }
};
