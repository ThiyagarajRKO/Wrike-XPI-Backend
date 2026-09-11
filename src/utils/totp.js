import crypto from "crypto";

/**
 * Base32 encoding for TOTP secrets
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Convert bytes to Base32 string
 * @param {Buffer} bytes
 * @returns {string} Base32 encoded string
 */
const toBase32 = (bytes) => {
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }

  let base32 = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substring(i, i + 5).padEnd(5, "0");
    const index = parseInt(chunk, 2);
    base32 += BASE32_ALPHABET[index];
  }

  return base32;
};

/**
 * Convert Base32 string to bytes
 * @param {string} base32
 * @returns {Buffer} Decoded bytes
 */
const fromBase32 = (base32) => {
  let bits = "";
  for (const char of base32.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    const chunk = bits.substring(i, i + 8);
    if (chunk.length === 8) {
      bytes.push(parseInt(chunk, 2));
    }
  }

  return Buffer.from(bytes);
};

/**
 * Build the otpauth:// URL Google Authenticator (and compatible apps) scan
 * @param {string} base32Secret The TOTP secret in base32
 * @param {string} username
 * @param {string} issuer
 * @returns {string} otpauth:// URL
 */
export const buildTOTPUrl = (base32Secret, username, issuer = "WrikeXPI") => {
  const encodedUsername = encodeURIComponent(username);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedIssuer}:${encodedUsername}?secret=${base32Secret}&issuer=${encodedIssuer}`;
};

/**
 * Generate a random TOTP secret
 * @returns {object} { secret: base32_string, qr_code_url: string }
 */
export const generateTOTPSecret = (username, issuer = "WrikeXPI") => {
  try {
    // Generate 20 bytes of random data (160 bits)
    const secret = crypto.randomBytes(20);
    const base32Secret = toBase32(secret);
    const qrCodeUrl = buildTOTPUrl(base32Secret, username, issuer);

    return {
      secret: base32Secret,
      qr_code_url: qrCodeUrl,
      base32_secret: base32Secret,
    };
  } catch (err) {
    throw new Error(`Failed to generate TOTP secret: ${err.message}`);
  }
};

/**
 * Verify a TOTP code
 * @param {string} base32Secret The TOTP secret in base32
 * @param {string} code The 6-digit code to verify
 * @param {number} window Number of 30-second windows to check (default: 1)
 * @returns {boolean} Whether the code is valid
 */
export const verifyTOTP = (base32Secret, code, window = 1) => {
  try {
    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      return false;
    }

    const secret = fromBase32(base32Secret);
    const now = Math.floor(Date.now() / 1000);
    const timeStep = 30;

    // Check the provided code and surrounding time windows
    for (let i = -window; i <= window; i++) {
      const counter = Math.floor((now + i * timeStep) / timeStep);
      const hash = generateHOTPCode(secret, counter);

      if (hash === code) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error("TOTP verification error:", err.message);
    return false;
  }
};

/**
 * Generate HOTP code using HMAC-SHA1
 * @param {Buffer} secret The shared secret
 * @param {number} counter The counter value
 * @returns {string} 6-digit HOTP code
 */
const generateHOTPCode = (secret, counter) => {
  // Create buffer with counter in big-endian format
  const counterBuffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = counter & 0xff;
    counter >>= 8;
  }

  // Generate HMAC-SHA1
  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  // Get last 6 digits
  const totp = (code % 1000000).toString().padStart(6, "0");
  return totp;
};

/**
 * Get the current TOTP code (for testing/debugging)
 * @param {string} base32Secret
 * @returns {string} Current 6-digit code
 */
export const getCurrentTOTPCode = (base32Secret) => {
  try {
    const secret = fromBase32(base32Secret);
    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / 30);
    return generateHOTPCode(secret, counter);
  } catch (err) {
    throw new Error(`Failed to generate current TOTP code: ${err.message}`);
  }
};
