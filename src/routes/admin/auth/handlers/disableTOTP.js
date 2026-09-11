import * as CryptoUtils from "../../../../utils/crypto";
import { verifyTOTP } from "../../../../utils/totp";
import { AdminAuth } from "../../../../controllers";

export const DisableTOTP = (body, adminUser) => {
  return new Promise(async (resolve, reject) => {
    try {
      const { password, totp_code } = body;

      if (!password || !totp_code)
        return reject({
          statusCode: 400,
          message: "Password and TOTP code are required",
        });

      const admin = await AdminAuth.GetAuthById(adminUser.id);
      if (!admin?.id)
        return reject({ statusCode: 401, message: "Unauthorized" });

      if (!admin.totp_enabled || !admin.totp_secret)
        return reject({ statusCode: 400, message: "TOTP is not enabled" });

      const isPasswordValid = await CryptoUtils.verifyPassword(
        admin.password_hash,
        password,
      );
      if (!isPasswordValid)
        return reject({ statusCode: 401, message: "Invalid password" });

      const isCodeValid = verifyTOTP(admin.totp_secret, totp_code);
      if (!isCodeValid)
        return reject({ statusCode: 400, message: "Invalid TOTP code" });

      await AdminAuth.DisableTOTP(adminUser.id);

      return resolve({ statusCode: 200, message: "TOTP disabled successfully" });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
