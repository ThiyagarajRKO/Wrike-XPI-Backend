export const RevealTOTPSchema = {
  schema: {
    body: {
      type: "object",
      required: ["password"],
      properties: {
        password: { type: "string" },
      },
    },
  },
};
