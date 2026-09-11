import QRCode from "qrcode";
import * as CryptoUtils from "../../../../utils/crypto";
import { buildTOTPUrl } from "../../../../utils/totp";
import { AdminAuth } from "../../../../controllers";

export const RevealTOTP = (body, adminUser) => {
  return new Promise(async (resolve, reject) => {
    try {
      const { password } = body;

      if (!password)
        return reject({ statusCode: 400, message: "Password is required" });

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

      const qrCodeUrl = buildTOTPUrl(admin.totp_secret, admin.username);
      const qrCodeImage = await QRCode.toDataURL(qrCodeUrl);

      return resolve({
        statusCode: 200,
        data: {
          secret: admin.totp_secret,
          qr_code_url: qrCodeUrl,
          qr_code_image: qrCodeImage,
        },
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
