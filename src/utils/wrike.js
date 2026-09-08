import { getSecrets } from "./azure_vault";
import { getCachedWrikeCredentials } from "./wrikeCredentials";
import { GetResponse, GetResponseWithStatusCode } from "./node-fetch";
import redisClient from "./redis";
require("dotenv").config();

const { WRIKE_LOGIN_ENDPOINT, WRIKE_REDIRECT_URL } = process.env;

const requiredDatahubRequestFormIds = [
  "XPI Entity",
  "Space",
  "RF v4Id",
  "Variant Id",
];

// Get Datahub ID by key for a specific environment
const getDatahubIdForEnvironment = (environmentName, idKey, envVarKey) => {
  if (!environmentName) {
    return process.env[envVarKey];
  }

  const cred = getCachedWrikeCredentials(environmentName);
  if (cred && cred[idKey]) {
    return cred[idKey];
  }

  return process.env[envVarKey];
};

export const getWrikeTokens = async ({ code, env, refresh_token }) => {
  try {
    if (!code && !refresh_token)
      throw {
        message:
          "Missing parameter! Either code or refresh_token must not be empty",
      };

    const apiCreds = getCachedWrikeCredentials(env);
    const WRIKE_CLIENT_ID = apiCreds?.clientId;
    const WRIKE_CLIENT_SECRET = apiCreds?.clientSecret;

    if (!WRIKE_LOGIN_ENDPOINT || !WRIKE_CLIENT_ID || !WRIKE_CLIENT_SECRET) {
      throw {
        message: "Unable to fetch token! Please try after sometimes",
      };
    }

    const url = `${WRIKE_LOGIN_ENDPOINT}/token`;

    let payload = {
      client_id: WRIKE_CLIENT_ID,
      client_secret: WRIKE_CLIENT_SECRET,
      grant_type: code ? "authorization_code" : "refresh_token",
      redirect_uri: WRIKE_REDIRECT_URL,
    };

    if (code) payload.code = code;

    if (refresh_token) payload.refresh_token = refresh_token;

    const result = await GetResponse(
      url,
      "POST",
      {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload,
    );

    if (result?.errorDescription) throw result;

    return result;
  } catch (err) {
    console.log("Error while getting access token: ", err?.message ?? err);
    throw err;
  }
};

export const getUserData = async (access_token) => {
  try {
    const userData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/contacts?me`,
      "GET",
      {
        "content-type": "application/json",
        authorization: "Bearer " + access_token,
      },
      null,
    );

    if (userData?.errorDescription) throw userData;

    return userData;
  } catch (err) {
    console.log("Error while getting user details: ", err?.message ?? err);
    throw err;
  }
};

/**
 * The caller's own contact, with custom fields attached.
 *
 * Separate from getUserData() on purpose: the authorization layer
 * (src/utils/accessControl.js) needs the "Xtend API" custom field, and
 * asking for customFields on every existing /profile call would slow down a
 * path that has never needed them.
 */
export const getUserProfileWithCustomFields = async (access_token) => {
  try {
    const fields = encodeURIComponent(JSON.stringify(["customFields"]));

    const userData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/contacts?me&fields=${fields}`,
      "GET",
      {
        "content-type": "application/json",
        authorization: "Bearer " + access_token,
      },
      null,
    );

    if (userData?.errorDescription) throw userData;

    return userData;
  } catch (err) {
    console.log(
      "Error while getting user profile with custom fields: ",
      err?.message ?? err,
    );
    throw err;
  }
};

// Datahub Util Functions
export const getDatahubFields = async (wrikeToken, databaseId) => {
  try {
    // Pass Service Account Token
    const secretValues = getSecrets();
    wrikeToken = secretValues?.["XPI-API-Token"] ?? wrikeToken;

    // Get folder data
    const datahubFields = await GetResponse(
      `${process.env.WRIKE_DATAHUB_ENDPOINT}/databases/${databaseId}/fields`,
      "GET",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (datahubFields?.errorDescription) throw datahubFields;

    return datahubFields;
  } catch (err) {
    throw err;
  }
};

export const getDatahubRecord = async (wrikeToken, databaseId, recordId) => {
  try {
    if (!databaseId || !recordId) {
      throw { message: "Database ID and Record ID are required" };
    }

    let url = `${
      process.env.WRIKE_DATAHUB_ENDPOINT
    }/databases/${databaseId}/records/${recordId}`;

    // Pass Service Account Token
    const secretValues = getSecrets();
    wrikeToken = secretValues?.["XPI-API-Token"] ?? wrikeToken;

    const datahubRecord = await GetResponse(url, "GET", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (datahubRecord?.errorDescription) throw datahubRecord;

    return datahubRecord;
  } catch (err) {
    throw err;
  }
};

export const getDatahubRecords = async (
  wrikeToken,
  databaseId,
  options = {},
) => {
  try {
    // Extract options with defaults
    const {
      isRecursive = true,
      fieldIds,
      filter = "",
      pageToken = null,
      limit,
      accumulatedData = [],
      useCache = true,
      cacheTTL = null,
    } = options;

    // Set default TTL if not provided (null = unlimited, otherwise use provided value or env default)
    const ttl =
      cacheTTL !== null
        ? cacheTTL
        : parseInt(process.env.REDIS_DEFAULT_TTL) || 3600;

    // Only cache when getting complete data (no pageToken, no accumulated data)
    const shouldCache = useCache && !pageToken && accumulatedData.length === 0;

    // Generate cache key based on parameters that affect the result
    let cacheKey = null;
    if (shouldCache) {
      const cacheKeyParts = [
        "datahub_records",
        databaseId,
        isRecursive ? "recursive" : "single",
        fieldIds ? fieldIds.sort().join(",") : "all_fields",
        filter || "no_filter",
      ];
      cacheKey = redisClient.generateKey(...cacheKeyParts);

      // Try to get from cache first
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          // console.log(`Cache hit for datahub records ${databaseId}`);
          return cachedData;
        }
      } catch (cacheError) {
        console.warn("Cache read error, proceeding without cache:", cacheError);
      }
    }

    let url = `${
      process.env.WRIKE_DATAHUB_ENDPOINT
    }/databases/${databaseId}/records?limit=${
      limit ?? process.env.WRIKE_DATAHUB_RECORDS_LIMIT ?? "300"
    }&nextPageToken=${pageToken ?? ""}`;

    if (filter) {
      url += `&filter=${filter}`;
    }

    if (fieldIds) {
      url += `&fieldIds=${fieldIds.join(",")}`;
    }

    // Pass Service Account Token
    const secretValues = getSecrets();
    wrikeToken = secretValues?.["XPI-API-Token"] ?? wrikeToken;

    const response = await GetResponse(url, "GET", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (response?.errorDescription) {
      throw response;
    }

    // Append current page data to accumulated data
    const combinedData = [...accumulatedData, ...(response?.data || [])];

    // If there's a nextPageToken, recursively fetch the next page
    if (isRecursive && response?.nextPageToken) {
      return await getDatahubRecords(wrikeToken, databaseId, {
        isRecursive,
        fieldIds,
        filter,
        pageToken: response.nextPageToken,
        accumulatedData: combinedData,
        useCache: false, // Disable caching for recursive calls
      });
    }

    // Final result
    const finalResult = {
      ...response,
      data: combinedData,
      nextPageToken: response?.nextPageToken,
    };

    // Cache the result if this is the initial call and caching is enabled
    if (shouldCache && cacheKey) {
      try {
        const isSaved = await redisClient.set(cacheKey, finalResult, ttl);
        if (isSaved)
          console.log(
            `Data cached for datahub records ${databaseId} with TTL ${
              ttl === 0 ? "unlimited" : ttl + "s"
            }`,
          );
      } catch (cacheError) {
        console.warn("Cache write error:", cacheError);
      }
    }

    return finalResult;
  } catch (err) {
    throw err;
  }
};

export const getSpaceDatahub = async (
  wrikeToken,
  useCache = true,
  cacheTTL = null,
  environmentName = null,
) => {
  try {
    // Set default TTL if not provided (null = unlimited, otherwise use provided value or env default)
    const ttl =
      cacheTTL !== null
        ? cacheTTL
        : parseInt(process.env.REDIS_DEFAULT_TTL) || 3600;

    // Generate cache key
    const cacheKey = redisClient.generateKey("space_datahub");

    // Try to get from cache first
    if (useCache) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn("Cache read error, proceeding without cache:", cacheError);
      }
    }

    const spaceId = getDatahubIdForEnvironment(
      environmentName,
      "xpiSpaceNameDatahubId",
      "DATAHUB_SPACE_ID",
    );

    const datahubFields = await getDatahubFields(wrikeToken, spaceId);

    if (datahubFields?.errorDescription) {
      throw datahubFields;
    }

    let formFieldsIds = {};
    datahubFields?.data?.forEach((field) => {
      formFieldsIds[field.title?.trim()?.toLowerCase()] = field.id;
    });

    const datahubRecords = await getDatahubRecords(wrikeToken, spaceId, {
      useCache: false,
    });

    if (datahubRecords?.errorDescription) {
      throw datahubRecords;
    }

    let datahubSpaceData = {};
    datahubRecords?.data?.forEach((record) => {
      datahubSpaceData[record.title?.trim()?.toLowerCase()] = record.id;
    });

    let datahubSpaceMetaData = {};
    datahubRecords?.data?.forEach((record) => {
      datahubSpaceMetaData[record?.title?.trim()?.toLowerCase()] = {
        id: record.id,
        name: record?.title,
        remark: record.fieldValues[formFieldsIds["remark"]],
        cfId: record.fieldValues[formFieldsIds["v4id"]],
      };
    });

    // Cache the result if caching is enabled
    if (useCache) {
      try {
        const isSaved = await redisClient.set(
          cacheKey,
          { datahubSpaceData, datahubSpaceMetaData },
          ttl,
        );
        if (isSaved)
          console.log(
            `Data cached for space datahub with TTL ${
              ttl === 0 ? "unlimited" : ttl + "s"
            }`,
          );
      } catch (cacheError) {
        console.warn("Cache write error:", cacheError);
      }
    }

    return { datahubSpaceData, datahubSpaceMetaData };
  } catch (err) {
    throw err;
  }
};

export const getEntityDatahub = async (
  wrikeToken,
  useCache = true,
  cacheTTL = null,
  environmentName = null,
) => {
  try {
    // Set default TTL if not provided (null = unlimited, otherwise use provided value or env default)
    const ttl =
      cacheTTL !== null
        ? cacheTTL
        : parseInt(process.env.REDIS_DEFAULT_TTL) || 3600;

    // Generate cache key
    const cacheKey = redisClient.generateKey("entity_datahub");

    // Try to get from cache first
    if (useCache) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn("Cache read error, proceeding without cache:", cacheError);
      }
    }

    const datahubRecords = await getDatahubRecords(
      wrikeToken,
      getDatahubIdForEnvironment(
        environmentName,
        "xpiEntityDatahubId",
        "DATAHUB_ENTITY_ID",
      ),
      {
        useCache: false,
      },
    );

    if (datahubRecords?.errorDescription) {
      throw datahubRecords;
    }

    let datahubEntityData = {};
    datahubRecords?.data?.forEach((record) => {
      datahubEntityData[record.title?.trim()?.toLowerCase()] = record.id;
    });

    // Cache the result if caching is enabled
    if (useCache) {
      try {
        const isSaved = await redisClient.set(cacheKey, datahubEntityData, ttl);
        if (isSaved)
          console.log(
            `Data cached for entity datahub with TTL ${
              ttl === 0 ? "unlimited" : ttl + "s"
            }`,
          );
      } catch (cacheError) {
        console.warn("Cache write error:", cacheError);
      }
    }

    return datahubEntityData;
  } catch (err) {
    throw err;
  }
};

export const findRequestFormId = async (
  wrikeToken,
  space,
  entity,
  variantId,
  datahubSpaceData,
  datahubEntityData,
  useCache = true,
  cacheTTL = null,
  environmentName = null,
) => {
  try {
    // Set default TTL if not provided (null = unlimited, otherwise use provided value or env default)
    const ttl =
      cacheTTL !== null
        ? cacheTTL
        : parseInt(process.env.REDIS_DEFAULT_TTL) || 3600;

    // Generate cache key
    const cacheKey = redisClient.generateKey(
      "find_request_form_id",
      space,
      entity,
      variantId,
    );

    // Try to get from cache first
    if (useCache) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn("Cache read error, proceeding without cache:", cacheError);
      }
    }

    const formFields = await getDatahubFields(
      wrikeToken,
      getDatahubIdForEnvironment(
        environmentName,
        "xpiRequestFormMappingDatahubId",
        "DATAHUB_REQUEST_FORM_ID",
      ),
    );

    if (formFields?.errorDescription) {
      throw formFields;
    }

    let formFieldsIds = {};
    formFields?.data?.forEach((field) => {
      if (requiredDatahubRequestFormIds.includes(field.title)) {
        formFieldsIds[field.title] = field.id;
      }
    });

    const datahubRecords = await getDatahubRecords(
      wrikeToken,
      getDatahubIdForEnvironment(
        environmentName,
        "xpiRequestFormMappingDatahubId",
        "DATAHUB_REQUEST_FORM_ID",
      ),
      {
        useCache: false,
      },
    );

    const datahubMatchedRecord = datahubRecords?.data?.find(
      (record) =>
        record?.fieldValues[formFieldsIds["Space"]]?.[0] ===
          datahubSpaceData[space?.trim()?.toLowerCase()] &&
        record?.fieldValues[formFieldsIds["XPI Entity"]]?.[0] ===
          datahubEntityData[entity?.trim()?.toLowerCase()] &&
        record?.fieldValues[formFieldsIds["Variant Id"]] === variantId,
    );

    const requiredFormId =
      datahubMatchedRecord?.fieldValues[formFieldsIds["RF v4Id"]] || null;

    const result = {
      requiredFormId,
    };

    // Cache the result if caching is enabled
    if (useCache && requiredFormId) {
      try {
        const isSaved = await redisClient.set(cacheKey, result, ttl);
        if (isSaved)
          console.log(
            `Data cached for find request form id ${space}-${entity}-${variantId} with TTL ${
              ttl === 0 ? "unlimited" : ttl + "s"
            }`,
          );
      } catch (cacheError) {
        console.warn("Cache write error:", cacheError);
      }
    }

    return result;
  } catch (err) {
    throw err;
  }
};

export const getRequestFormFieldDatahub = async (
  wrikeToken,
  space,
  variantId,
  datahubCustomFieldsData,
  datahubSpaceData,
  useCache = true,
  cacheTTL = null,
  environmentName = null,
) => {
  try {
    // Set default TTL if not provided (null = unlimited, otherwise use provided value or env default)
    const ttl =
      cacheTTL !== null
        ? cacheTTL
        : parseInt(process.env.REDIS_DEFAULT_TTL) || 3600;

    // Generate cache key
    const cacheKey = redisClient.generateKey(
      "request_form_field_datahub",
      space,
      variantId,
    );

    // Try to get from cache first
    if (useCache) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn("Cache read error, proceeding without cache:", cacheError);
      }
    }

    const datahubFields = await getDatahubFields(
      wrikeToken,
      getDatahubIdForEnvironment(
        environmentName,
        "xpiRequestFormFieldMappingDatahubId",
        "DATAHUB_REQUEST_FORM_FIELDS_ID",
      ),
    );

    if (datahubFields?.errorDescription) {
      throw datahubFields;
    }

    let formFieldsIds = {};
    datahubFields?.data?.forEach((field) => {
      formFieldsIds[field.title?.trim()?.toLowerCase()] = field.id;
    });

    const datahubRecords = await getDatahubRecords(
      wrikeToken,
      getDatahubIdForEnvironment(
        environmentName,
        "xpiRequestFormFieldMappingDatahubId",
        "DATAHUB_REQUEST_FORM_FIELDS_ID",
      ),
      {
        useCache: false,
      },
    );

    if (datahubRecords?.errorDescription) {
      throw datahubRecords;
    }

    let datahubRequestFormFieldsData = {};
    datahubRecords?.data?.forEach((record) => {
      if (
        record.fieldValues[formFieldsIds["space"]]?.[0] ===
          datahubSpaceData[space?.trim()?.toLowerCase()] &&
        record.fieldValues[formFieldsIds["variant id"]] === variantId
      ) {
        let customFieldCode = "";
        for (const cf in datahubCustomFieldsData) {
          if (
            datahubCustomFieldsData[cf].id ===
            record.fieldValues[formFieldsIds["xpi shortcode"]][0]
          ) {
            customFieldCode = cf;
            // return;
          }
        }

        if (customFieldCode)
          datahubRequestFormFieldsData[customFieldCode] = {
            id: record.id,
            ["fieldId"]: record.fieldValues[formFieldsIds["field v4id"]],
          };
        else if (record.fieldValues[formFieldsIds["xpi custom shortcode"]])
          datahubRequestFormFieldsData[
            record.fieldValues[formFieldsIds["xpi custom shortcode"]]
          ] = {
            id: record.id,
            ["fieldId"]: record.fieldValues[formFieldsIds["field v4id"]],
          };
      }
    });

    // Cache the result if caching is enabled
    if (useCache) {
      try {
        const isSaved = await redisClient.set(
          cacheKey,
          datahubRequestFormFieldsData,
          ttl,
        );
        if (isSaved)
          console.log(
            `Data cached for request form field datahub ${space}-${variantId} with TTL ${
              ttl === 0 ? "unlimited" : ttl + "s"
            }`,
          );
      } catch (cacheError) {
        console.warn("Cache write error:", cacheError);
      }
    }

    return datahubRequestFormFieldsData;
  } catch (err) {
    throw err;
  }
};

export const getDatahubCustomFields = async (
  wrikeToken,
  databaseId,
  isMaster = false,
  useCache = true,
  cacheTTL = 0,
  environmentName = null,
) => {
  try {
    // Set default TTL if not provided (null = unlimited, otherwise use provided value or env default)
    const ttl =
      cacheTTL !== null
        ? cacheTTL
        : parseInt(process.env.REDIS_DEFAULT_TTL) || 3600;

    // Resolve databaseId with environment-specific value if not provided
    const resolvedDatabaseId =
      databaseId ||
      getDatahubIdForEnvironment(
        environmentName,
        "xpiFieldMappingDatahubId",
        "DATAHUB_CUSTOM_FIELDS_ID",
      );

    // Generate cache key
    const cacheKey = redisClient.generateKey(
      "datahub_grouped_data",
      resolvedDatabaseId ?? process.env.DATAHUB_CUSTOM_FIELDS_ID,
      isMaster ? "master" : "regular",
    );

    // Try to get from cache first
    if (useCache) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          // console.log(`Cache hit for datahub ${databaseId}`);
          return cachedData;
        }
        // console.log(`Cache miss for datahub ${databaseId}`);
      } catch (cacheError) {
        console.warn("Cache read error, proceeding without cache:", cacheError);
      }
    }

    const datahubFields = await getDatahubFields(
      wrikeToken,
      resolvedDatabaseId,
    );

    if (datahubFields?.errorDescription) {
      throw datahubFields;
    }

    let formFieldsIds = {};
    datahubFields?.data?.forEach((field) => {
      formFieldsIds[field.title?.trim()?.toLowerCase()] = field.id;
    });

    const datahubRecords = await getDatahubRecords(
      wrikeToken,
      resolvedDatabaseId,
      {
        isRecursive: true,
        fieldIds: undefined,
        filter: "",
        pageToken: null,
        accumulatedData: [],
        useCache: false,
      },
    );

    if (datahubRecords?.errorDescription) {
      throw datahubRecords;
    }

    let datahubData = {};
    datahubRecords?.data?.forEach((record) => {
      if (
        record.fieldValues[
          formFieldsIds[isMaster ? "master slug" : "short code"]
        ]?.trim()
      )
        datahubData[
          record.fieldValues[
            formFieldsIds[isMaster ? "master slug" : "short code"]
          ]
            ?.trim()
            ?.toLowerCase()
        ] = {
          id: record.id,
          ["cfId"]: record.fieldValues[formFieldsIds["cf id"]],
          isCampaignField: record.fieldValues[formFieldsIds["campaign"]],
          isChannelField: record.fieldValues[formFieldsIds["channel"]],
          isTaskField: record.fieldValues[formFieldsIds["channel task"]],
          isWritable:
            record.fieldValues[formFieldsIds["api access"]]
              ?.toLowerCase()
              ?.includes("write") ?? false,
          isReadable:
            record.fieldValues[formFieldsIds["api access"]]
              ?.toLowerCase()
              ?.includes("read") ?? false,
          canReadMasterData:
            record.fieldValues[formFieldsIds["master data feature"]]?.includes(
              "Read",
            ) ?? false,
          canCreateMasterData:
            record.fieldValues[formFieldsIds["master data feature"]]?.includes(
              "Create",
            ) ?? false,
          canUpdateMasterData:
            record.fieldValues[formFieldsIds["master data feature"]]?.includes(
              "Update",
            ) ?? false,
          canDeleteMasterData:
            record.fieldValues[formFieldsIds["master data feature"]]?.includes(
              "Delete",
            ) ?? false,
          cfType: record.fieldValues[formFieldsIds["cf type"]],
          xpiFieldType: record.fieldValues[formFieldsIds["xpi field type"]],
          description: record.fieldValues[formFieldsIds["description"]],
        };
    });

    // Cache the result if caching is enabled
    if (useCache) {
      try {
        const isSaved = await redisClient.set(cacheKey, datahubData, ttl);
        if (isSaved)
          console.log(
            `Data cached for datahub ${databaseId} with TTL ${ttl === 0 ? "unlimited" : ttl + "s"}`,
          );
      } catch (cacheError) {
        console.warn("Cache write error:", cacheError);
      }
    }

    return datahubData;
  } catch (err) {
    throw err;
  }
};

export const getDatahubDataById = async (
  wrikeToken,
  databaseId,
  filter = [],
  useCache = true,
  cacheTTL = null,
) => {
  try {
    // Set default TTL if not provided (null = unlimited, otherwise use provided value or env default)
    const ttl =
      cacheTTL !== null
        ? cacheTTL
        : parseInt(process.env.REDIS_DEFAULT_TTL) || 3600;

    if (!databaseId)
      throw {
        message: "Missing databaseId",
      };

    // Generate cache key
    const cacheKey = redisClient.generateKey(
      "datahub_data_by_id",
      databaseId,
      JSON.stringify(filter),
    );

    // Try to get from cache first
    if (useCache) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          // console.log(`Cache hit for datahub ${databaseId}`);
          return cachedData;
        }
        // console.log(`Cache miss for datahub ${databaseId}`);
      } catch (cacheError) {
        console.warn("Cache read error, proceeding without cache:", cacheError);
      }
    }

    const datahubFields = await getDatahubFields(wrikeToken, databaseId);

    if (datahubFields?.errorDescription) {
      throw datahubFields;
    }

    if (datahubFields?.data?.length === 0)
      throw { message: "No datahub fields mapping data found" };

    let formFieldsIds = {};
    datahubFields?.data?.forEach((field) => {
      formFieldsIds[field.id] = field.title?.trim()?.toLowerCase();
    });

    // Construct filter string if filter array is provided
    let filterString = "";

    if (Array.isArray(filter) && filter.length > 0) {
      if (filter.length === 1) {
        // Single filter condition
        const filterItem = filter[0];
        // finding fieldId by value
        const fieldId =
          Object.keys(formFieldsIds).find(
            (key) => formFieldsIds[key] === filterItem.fieldName,
          ) || null;

        filterString = fieldId
          ? '{"op": "' +
            (filterItem.op || "equals") +
            '","fld": "' +
            fieldId +
            '","val": "' +
            filterItem.value +
            '"}'
          : "";
      } else {
        // Multiple filter conditions with AND logic
        const conditions = filter
          .map((filterItem) => {
            // finding fieldId by value
            const fieldId =
              Object.keys(formFieldsIds).find(
                (key) => formFieldsIds[key] === filterItem.fieldName,
              ) || null;

            if (!fieldId) return null;

            return (
              '{"op": "' +
              (filterItem.op || "equals") +
              '","fld": "' +
              fieldId +
              '","val": "' +
              filterItem.value +
              '"}'
            );
          })
          .filter((condition) => condition !== null);

        filterString = '{"and": [' + conditions.join(", ") + "]}";
      }
    }

    const datahubRecords = await getDatahubRecords(wrikeToken, databaseId, {
      filter: filterString,
      useCache: false,
    });

    if (datahubRecords?.errorDescription) throw datahubRecords;

    let datahubData = [];
    datahubRecords?.data?.forEach((record) => {
      let fields = {};
      for (const field in record.fieldValues) {
        fields[formFieldsIds[field]] = record.fieldValues[field];
      }

      datahubData.push(fields);
    });

    // Cache the result if caching is enabled
    if (useCache) {
      try {
        const isSaved = await redisClient.set(cacheKey, datahubData, ttl);
        if (isSaved)
          console.log(
            `Data cached for datahub data by id ${databaseId} with TTL ${
              ttl === 0 ? "unlimited" : ttl + "s"
            }`,
          );
      } catch (cacheError) {
        console.warn("Cache write error:", cacheError);
      }
    }

    return datahubData;
  } catch (err) {
    throw err;
  }
};

export const createDatahubRecord = async (
  wrikeToken,
  databaseId,
  fieldValues = {},
) => {
  try {
    if (!fieldValues) throw "Field values must not be empty";

    const datahubFields = await getDatahubFields(wrikeToken, databaseId);

    if (datahubFields?.errorDescription) {
      throw datahubFields;
    }

    if (datahubFields?.data?.length === 0)
      throw { message: "No datahub fields mapping data found" };

    let formFieldsIds = {};
    datahubFields?.data?.forEach((field) => {
      formFieldsIds[field.title?.trim()?.toLowerCase()] = field.id;
    });

    // Object.entries(data).map;

    let inputRecordParams = {};
    for (const data in fieldValues) {
      if (data == "value") continue;

      // Skip if the value is empty or null
      if (!formFieldsIds[data?.trim()?.toLowerCase()]) continue;

      inputRecordParams[formFieldsIds[data?.trim()?.toLowerCase()]] =
        fieldValues[data];
    }

    // Pass Service Account Token
    const secretValues = getSecrets();
    wrikeToken = secretValues?.["XPI-API-Token"] ?? wrikeToken;

    const customFieldsData = await GetResponse(
      `${process.env.WRIKE_DATAHUB_ENDPOINT}/databases/${databaseId}/records`,
      "POST",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
      {
        requestId: Math.random().toString(36).substring(2, 15),
        data: [
          {
            title: fieldValues["value"],
            fieldValues: inputRecordParams,
          },
        ],
      },
    );

    if (customFieldsData?.errorDescription) throw customFieldsData;

    return customFieldsData;
  } catch (err) {
    throw err;
  }
};

export const updateDatahubRecord = async (
  wrikeToken,
  databaseId,
  recordId,
  fieldValues = {},
) => {
  try {
    if (!recordId) throw "Record ID must not be empty";

    if (!fieldValues) throw "Field values must not be empty";

    const datahubFields = await getDatahubFields(wrikeToken, databaseId);

    if (datahubFields?.errorDescription) {
      throw datahubFields;
    }

    if (datahubFields?.data?.length === 0)
      throw { message: "No datahub fields mapping data found" };

    let formFieldsIds = {};
    datahubFields?.data?.forEach((field) => {
      formFieldsIds[field.title?.trim()?.toLowerCase()] = field.id;
    });

    // Object.entries(data).map;

    let inputRecordParams = {};
    for (const data in fieldValues) {
      if (data == "value") continue;

      // Skip if the value is empty or null
      if (!formFieldsIds[data?.trim()?.toLowerCase()]) continue;

      inputRecordParams[formFieldsIds[data?.trim()?.toLowerCase()]] =
        fieldValues[data];
    }

    // Pass Service Account Token
    const secretValues = getSecrets();
    wrikeToken = secretValues?.["XPI-API-Token"] ?? wrikeToken;

    const customFieldsData = await GetResponseWithStatusCode(
      `${process.env.WRIKE_DATAHUB_ENDPOINT}/databases/${databaseId}/records/${recordId}`,
      "PUT",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
      {
        title: fieldValues["value"],
        fieldValues: inputRecordParams,
      },
    );

    if (customFieldsData?.status == 404)
      throw { statusCode: 404, message: "Invalid Record ID" };

    if (customFieldsData?.data?.status && customFieldsData?.data?.detail)
      throw customFieldsData;

    return customFieldsData?.data;
  } catch (err) {
    throw err;
  }
};

export const deleteDatahubRecord = async (
  wrikeToken,
  databaseId,
  recordIds = [],
) => {
  try {
    if (!Array.isArray(recordIds) || recordIds.length === 0)
      throw "Record IDs must not be empty";

    // Pass Service Account Token
    const secretValues = getSecrets();
    wrikeToken = secretValues?.["XPI-API-Token"] ?? wrikeToken;

    const customFieldsData = await GetResponse(
      `${
        process.env.WRIKE_DATAHUB_ENDPOINT
      }/databases/${databaseId}/records?recordIds=${recordIds.join(",")}`,
      "DELETE",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (customFieldsData?.errorDescription) throw customFieldsData;

    if (customFieldsData?.[0]?.failureReason)
      throw {
        statusCode:
          customFieldsData?.[0]?.failureReason ==
          "Record doesn't belong to database"
            ? 404
            : 400,
        message:
          customFieldsData?.[0]?.failureReason ==
          "Record doesn't belong to database"
            ? "Invalid Record ID"
            : "Unable to delete the datahub record. Please try again",
      };

    return customFieldsData;
  } catch (err) {
    throw err;
  }
};

export const getCustomFields = async (wrikeToken, customFieldId = null) => {
  try {
    let url = `${process.env.WRIKE_ENDPOINT}/customfields`;

    // If specific custom field ID is provided
    if (customFieldId) {
      url += `/${customFieldId}`;
    }

    const customFieldsData = await GetResponse(url, "GET", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (customFieldsData?.errorDescription) throw customFieldsData;

    return customFieldsData;
  } catch (err) {
    throw err;
  }
};

export const getRequestForm = async (wrikeToken, requestFormSpaceId) => {
  try {
    if (!requestFormSpaceId) {
      throw new Error(
        "Request Form Space ID is not configured for this environment.",
      );
    }

    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/spaces/${requestFormSpaceId}/request_forms`,
      "GET",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const getRequestFormById = async (wrikeToken, requestFormId) => {
  try {
    if (!requestFormId) {
      throw new Error(
        "Request Form Space ID is not configured for this environment.",
      );
    }

    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/request_forms/${requestFormId}`,
      "GET",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const submitRequestForm = async (
  wrikeToken,
  requetFormId,
  formFields,
) => {
  try {
    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/request_forms/${requetFormId}/submit`,
      "POST",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
      {
        formFields,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const submitRequestPreFillForm = async (
  wrikeToken,
  requetFormId,
  formFields,
) => {
  try {
    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/request_forms/${requetFormId}/prefill_url`,
      "POST",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
      {
        formFields,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const getRequestFormStatus = async (
  wrikeToken,
  asyncJobId,
  retryCount = 0,
) => {
  try {
    // Get async job status (should be GET, not POST)
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/async_job/${asyncJobId}`,
      "GET",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    const jobStatus = wrikeRequestFormData?.data?.[0]?.status;

    if (jobStatus === "InProgress") {
      if (retryCount >= 10)
        return { errorMessage: "Async job polling timed out." };

      // Wait 2 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return getRequestFormStatus(wrikeToken, asyncJobId, retryCount + 1);
    } else if (jobStatus === "Completed" || jobStatus === "Failed") {
      return wrikeRequestFormData?.data[0];
    } else throw { errorMessage: `Unknown job status: ${jobStatus}` };
  } catch (error) {
    throw error;
  }
};

export const getFoldersBySpace = async (
  wrikeToken,
  spaceId,
  nextPageToken,
  pageSize,
  customFields,
) => {
  try {
    let url = `${process.env.WRIKE_ENDPOINT}/spaces/${
      spaceId
    }/folders?deleted=false&fields=[customFields]&nextPageToken=${
      nextPageToken || ""
    }`;

    if (pageSize && pageSize > 0) url += `&pageSize=${pageSize}`;

    if (customFields) url += `&customFields=${JSON.stringify(customFields)}`;

    // Get folder data
    const wrikeRequestFormData = await GetResponse(url, "GET", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const getFolder = async (wrikeToken, folderId) => {
  try {
    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/folders/${folderId}`,
      "GET",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const getFoldersByFolderId = async (
  wrikeToken,
  folderId,
  limit = 200,
  nextPageToken,
  descendants = false,
  project = false,
  customitemTypeIds = [],
  customFields = [],
) => {
  try {
    // Get tasks from folder with pagination
    const customItemTypes =
      Array.isArray(customitemTypeIds) && customitemTypeIds.length
        ? `[${customitemTypeIds.join(",")}]`
        : "";

    const params = new URLSearchParams();

    if (descendants != null) params.append("descendants", descendants);
    if (project != null) params.append("project", project);

    params.append("plainTextCustomFields", "true");
    params.append("fields", "[customFields, customItemTypeId]");

    if (customFields?.length) {
      params.append("customFields", JSON.stringify(customFields));
    }

    let url = `${process.env.WRIKE_ENDPOINT}/folders/${folderId}/folders?${params}`;

    if (limit) {
      url += `&pageSize=${limit}`;
    }

    if (nextPageToken) params.append("nextPageToken", nextPageToken);

    const wrikeRequestFormData = await GetResponse(url, "GET", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const updateFolder = async (
  wrikeToken,
  folderId,
  folderFieldsUpdateData,
  folderMetadataUpdateData,
  folderCFUpdateData,
) => {
  try {
    // Get folder data
    let url = `${process.env.WRIKE_ENDPOINT}/folders/${folderId}`;

    if (
      folderFieldsUpdateData &&
      Object.keys(folderFieldsUpdateData).length > 0
    ) {
      Object.entries(folderFieldsUpdateData).map(([key, value]) => {
        if (url.includes("?")) url += "&";
        else url += "?";

        url += `${key}=${value}`;
      });
    }

    if (
      folderMetadataUpdateData &&
      Array.isArray(folderMetadataUpdateData) &&
      folderMetadataUpdateData?.length > 0
    ) {
      if (url.includes("?")) url += "&";
      else url += "?";

      url += `metadata=${JSON.stringify(folderMetadataUpdateData)}`;
    }

    if (
      folderCFUpdateData &&
      Array.isArray(folderCFUpdateData) &&
      folderCFUpdateData?.length > 0
    ) {
      if (url.includes("?")) url += "&";
      else url += "?";

      url += `customFields=${JSON.stringify(folderCFUpdateData)}`;
    }

    const wrikeRequestFormData = await GetResponse(url, "PUT", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const deleteFolder = async (wrikeToken, folderId) => {
  try {
    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/folders/${folderId}`,
      "DELETE",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const uploadAttachment = async (wrikeToken, fileBuffer, fileName) => {
  try {
    const url = `${process.env.WRIKE_ENDPOINT}/attachments`;

    const headers = {
      Authorization: `Bearer ${wrikeToken}`,
      "content-type": "application/octet-stream",
      "X-Requested-With": "XMLHttpRequest",
      "X-File-Name": fileName,
    };

    const result = await GetResponse(url, "POST", headers, fileBuffer, true);

    if (result?.errorDescription) throw result;

    return result;
  } catch (err) {
    throw err;
  }
};

// Tasks API

export const getTask = async (wrikeToken, folderId) => {
  try {
    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/tasks/${folderId}`,
      "GET",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const getTasksByFolderId = async (
  wrikeToken,
  folderId,
  limit = 200,
  nextPageToken,
  descendants = true,
  subTasks = true,
  customitemTypeIds = [],
  customFields = [],
) => {
  try {
    // Get tasks from folder with pagination
    const customItemTypes =
      Array.isArray(customitemTypeIds) && customitemTypeIds.length
        ? `[${customitemTypeIds.join(",")}]`
        : "";

    const params = new URLSearchParams();

    if (descendants != null) params.append("descendants", descendants);
    if (subTasks != null) params.append("subTasks", subTasks);

    params.append("plainTextCustomFields", "true");
    params.append("fields", "[customFields, customItemTypeId]");

    if (customFields?.length) {
      params.append("customFields", JSON.stringify(customFields));
    }

    let url = `${process.env.WRIKE_ENDPOINT}/folders/${folderId}/tasks?${params}`;

    if (limit) {
      url += `&pageSize=${limit}`;
    }

    if (nextPageToken) params.append("nextPageToken", nextPageToken);

    const wrikeRequestFormData = await GetResponse(url, "GET", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const updateTask = async (
  wrikeToken,
  taskId,
  taskFieldsUpdateData,
  taskMetadataUpdateData,
  taskCFUpdateData,
) => {
  try {
    // Get folder data

    let url = `${process.env.WRIKE_ENDPOINT}/tasks/${taskId}`;

    if (taskFieldsUpdateData && Object.keys(taskFieldsUpdateData).length > 0) {
      Object.entries(taskFieldsUpdateData).map(([key, value]) => {
        if (url.includes("?")) url += "&";
        else url += "?";

        url += `${key}=${value}`;
      });
    }

    if (
      taskMetadataUpdateData &&
      Array.isArray(taskMetadataUpdateData) &&
      taskMetadataUpdateData?.length > 0
    ) {
      if (url.includes("?")) url += "&";
      else url += "?";

      url += `metadata=${JSON.stringify(taskMetadataUpdateData)}`;
    }

    if (
      taskCFUpdateData &&
      Array.isArray(taskCFUpdateData) &&
      taskCFUpdateData?.length > 0
    ) {
      if (url.includes("?")) url += "&";
      else url += "?";

      url += `customFields=${JSON.stringify(taskCFUpdateData)}`;
    }

    const wrikeRequestFormData = await GetResponse(url, "PUT", {
      "content-type": "application/json",
      Authorization: `Bearer ${wrikeToken}`,
    });

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};

export const deleteTask = async (wrikeToken, taskId) => {
  try {
    // Get folder data
    const wrikeRequestFormData = await GetResponse(
      `${process.env.WRIKE_ENDPOINT}/tasks/${taskId}`,
      "DELETE",
      {
        "content-type": "application/json",
        Authorization: `Bearer ${wrikeToken}`,
      },
    );

    if (wrikeRequestFormData?.errorDescription) throw wrikeRequestFormData;

    return wrikeRequestFormData;
  } catch (err) {
    throw err;
  }
};
