export const DisableTOTPSchema = {
  schema: {
    body: {
      type: "object",
      required: ["password", "totp_code"],
      properties: {
        password: { type: "string" },
        totp_code: { type: "string" },
      },
    },
  },
};
