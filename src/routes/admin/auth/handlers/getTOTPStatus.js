import { AdminAuth } from "../../../../controllers";

export const GetTOTPStatus = (adminUser) => {
  return new Promise(async (resolve, reject) => {
    try {
      const admin = await AdminAuth.GetById(adminUser.id);

      return resolve({
        statusCode: 200,
        data: { totp_enabled: !!admin?.totp_enabled },
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
