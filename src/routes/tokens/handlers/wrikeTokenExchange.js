import * as crypto from "../../../utils/crypto";
import { Tokens, Users } from "../../../controllers";
import { getWrikeTokens, getUserData } from "../../../utils/wrike";
import models from "../../../../models";
import { GetById } from "../../../controllers/wrikeCredentials";
import { evaluateAccess, SURFACE } from "../../../utils/environmentAccess";

export const WrikeTokenExchange = ({ code, environmentId, ip }, fastify) => {
  return new Promise(async (resolve, reject) => {
    // Start database transaction for data consistency
    const transaction = await models.sequelize.transaction();

    try {
      if (!code) return reject({ message: "Access Token must not be empty" });
      if (!environmentId)
        return reject({ message: "Environment must not be empty" });

      const envData = await GetById(environmentId);
      const env = envData?.environment_name;

      console.log("Fetched dynamic environment Data");

      // Get Wrike tokens from OAuth code
      const { access_token, refresh_token } = await getWrikeTokens({
        code,
        env,
      });

      if (!access_token || !refresh_token) {
        console.log(
          "Issue retrieving wrike tokens: Invalid authorization code!",
        );
        return reject({ message: "Invalid authorization code!" });
      }

      console.log("Retrieved wrike tokens");

      // Get user data from Wrike API
      const wrikeUserData = await getUserData(access_token);
      const {
        id: wrikeUserId,
        firstName,
        lastName,
        primaryEmail,
        profiles,
      } = wrikeUserData?.data[0];

      if (!wrikeUserId) {
        console.log("Invalid Wrike User!");
        await transaction.rollback();
        return reject({ message: "Invalid Wrike User!" });
      }

      console.log("Fetched Wrike user data");

      // Environment-level access scope — same gate ValidateToken applies to
      // every subsequent API call, run here BEFORE any credentials or token
      // record are created. Without this, a caller who is not on the
      // environment's allow list could still complete the OAuth exchange and
      // walk away with valid, persistent XPI credentials for it — the
      // allow list would only start blocking them on their first API call.
      const access = await evaluateAccess({
        envId: environmentId,
        email: primaryEmail,
        ip,
        surface: SURFACE.API,
      });

      if (!access.allowed) {
        console.log(
          `Environment access denied for ${primaryEmail || "unknown caller"}: ${access.code}`,
        );
        await transaction.rollback();
        return reject({
          statusCode: 403,
          message: access.message,
          code: access.code,
          checks: access.checks,
        });
      }

      const accountId = profiles?.[0]?.accountId;

      // Create or get user
      const userData = await Users.GetByWrikeId(wrikeUserId);
      let userId = userData?.id;

      if (!userData?.id) {
        const newUserData = await Users.Insert(
          {
            full_name: firstName + " " + lastName,
            email: primaryEmail,
            wrike_user_id: wrikeUserId,
            is_active: true,
          },
          { transaction },
        );
        userId = newUserData?.id;
      }

      console.log("Fetched exising user data from DB");

      // Generate username from email + account_id
      const username = `${accountId}-${environmentId}-${primaryEmail}`;

      // Generate random strong password
      const password = crypto.generateSecurePassword();

      // Generate salt and derive password hash and KEK
      const salt = crypto.generateSalt();
      const passwordHash = await crypto.hashPassword(password);
      const kek = await crypto.deriveKEK(password, salt);

      // Generate and wrap DEK
      const dek = crypto.generateDEK();
      const wrappedDEK = crypto.wrapDEK(dek, kek);

      // Encrypt Wrike tokens with DEK
      const encryptedAccessToken = crypto
        .encrypt(Buffer.from(access_token), dek)
        .toString("base64");
      const encryptedRefreshToken = crypto
        .encrypt(Buffer.from(refresh_token), dek)
        .toString("base64");

      // Get existing user token if any
      const userTokenData = await Tokens.GetByUserAccountEnvId(
        userId,
        accountId,
        environmentId,
      );
      let userTokenId = userTokenData?.id;

      console.log("Retrieved exising user token data");

      // Update or create token record
      if (userTokenId) {
        await Tokens.Update(
          userId,
          userTokenId,
          {
            encrypted_access_token: encryptedAccessToken,
            encrypted_refresh_token: encryptedRefreshToken,
            username,
            password_hash: passwordHash,
            salt: salt.toString("base64"),
            wrapped_dek: wrappedDEK.toString("base64"),
          },
          { transaction },
        );

        console.log("Updated user token meta data");
      } else {
        const newUserTokenData = await Tokens.Insert(
          userId,
          {
            account_id: accountId,
            env_id: environmentId,
            encrypted_access_token: encryptedAccessToken,
            encrypted_refresh_token: encryptedRefreshToken,
            username,
            password_hash: passwordHash,
            salt: salt.toString("base64"),
            wrapped_dek: wrappedDEK.toString("base64"),
            is_active: true,
          },
          { transaction },
        );
        userTokenId = newUserTokenData?.id;

        console.log("Inserted a new token meta data");
      }

      // Sign the XPI token. It carries the token-record id (t) and the DEK
      // (d, base64) inline. The DEK is not secret from whoever holds this
      // token; the signature is what protects the payload from tampering.
      const jweToken = fastify.jwt.sign(
        {
          t: userTokenId,
          d: dek.toString("base64"),
        },
        { expiresIn: "180d" },
      );

      await transaction.commit();

      console.log("XPI token has been generated successfully!");

      // Return credentials and JWE token
      resolve({
        token: jweToken,
        credentials: {
          username,
          password,
          message:
            "IMPORTANT: Save these credentials. They will only be shown once.",
        },
      });
    } catch (err) {
      // Rollback transaction on any error
      await transaction.rollback();
      console.log(
        "Database transaction rolled back due to error:",
        err?.message || err,
      );
      reject(err);
    }
  });
};
