import { syncWrikeCredentialsFromDB } from "../../../../utils/wrikeCredentials";
import { WrikeCredentials } from "../../../../controllers";

export const Delete = ({ id }) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!id)
        return reject({
          statusCode: 400,
          message: "Credential id is required",
        });

      const credential = await WrikeCredentials.GetById(id);
      if (!credential)
        return reject({ statusCode: 404, message: "Credential not found" });

      // Drops this environment's cached access scope as part of the delete,
      // so nothing is left behind for an id that no longer exists.
      await WrikeCredentials.Delete(id);
      await syncWrikeCredentialsFromDB();

      return resolve({
        statusCode: 200,
        message: "Credential deleted successfully",
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
