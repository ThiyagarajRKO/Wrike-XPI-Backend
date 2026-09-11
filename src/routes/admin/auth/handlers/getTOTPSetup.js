import QRCode from "qrcode";
import { generateTOTPSecret } from "../../../../utils/totp";

export const GetTOTPSetup = (adminUser) => {
  return new Promise(async (resolve, reject) => {
    try {
      const { secret, qr_code_url } = generateTOTPSecret(adminUser.username);
      const qr_code_image = await QRCode.toDataURL(qr_code_url);

      return resolve({
        statusCode: 200,
        message: "TOTP secret generated. Scan with Google Authenticator",
        data: { secret, qr_code_url, qr_code_image },
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
