"use strict";

import { tokenRoute } from "./tokens";
import { campaignRoute } from "./campaign";
import { channelRoute } from "./channel";
import { taskRoute } from "./task";
import { masterRoute } from "./master";
import { amoebaRoute } from "./amoeba";
import { adminApiRoute } from "./admin";
import { portalApiRoute } from "./portal";
// Auth Middleware
import { ValidateToken } from "../middlewares/authentication";
import { log as logActivity } from "../utils/activityLog";
import {
  captureRequest,
  buildResponseSnapshot,
  categoryForUrl,
} from "../utils/capture";

// GET/HEAD read; everything else is a write. Only used to label the activity
// log's `action` column — matches the read/create/update/delete vocabulary
// used elsewhere in the console without depending on it.
const ACTION_BY_METHOD = {
  GET: "read",
  HEAD: "read",
  OPTIONS: "read",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};
const actionForMethod = (method) =>
  ACTION_BY_METHOD[String(method || "").toUpperCase()] || null;

// MCP Plugin
import mcpPlugin from "../plugins/mcp";

// Channel Handlers and Schemas for OData routes
import { GetAllChannels } from "./channel/handlers/getAllChannels";
import { GetAllChannelsSchema } from "./channel/schema/getAllChannels";

// Task Handlers and Schemas for OData routes
import { GetAllTasks } from "./task/handlers/getAllTasks";
import {
  GetAllChannelTasksSchema,
  GetAllTasksSchema,
} from "./task/schema/getAllChannelTasks";
import { GetAllCampaignTasksSchema } from "./task/schema/getAllCampaignTasks";
import { getDatahubCustomFields } from "../utils/wrike";

//Public Routes
export const PublicRouters = (fastify, opts, done) => {
  fastify.register(tokenRoute, { prefix: "/wrikexpi/token" });
  fastify.register(adminApiRoute, { prefix: "/admin" });
  fastify.register(portalApiRoute, { prefix: "/portal" });
  fastify.register(mcpPlugin, { prefix: "/wrikexpi" });

  // Non-secret app config the admin dashboard / portal home pages need on
  // load (frontend/src/pages/AdminDashboard.tsx, PortalHome.tsx) — fetched
  // client-side instead of being server-injected into their HTML, same
  // plain-sendFile pattern as every other migrated page.
  fastify.get("/app-config", async (req, reply) => {
    reply.send({
      success: true,
      data: {
        appUrl: process.env.APP_URL || "",
        wrikeRedirectUrl: process.env.WRIKE_REDIRECT_URL || "",
      },
    });
  });

  fastify.get("/datahub/customfield", async (req, reply) => {
    try {
      const result = await getDatahubCustomFields();

      const cfTypes = [
        ...new Set(Object.keys(result).map((cf) => result[cf].cfType)),
      ];

      reply.code(result.statusCode || 200).send({
        success: true,
        data: result,
        cfTypes,
      });
    } catch (err) {
      reply.code(err?.statusCode || 400).send({
        success: false,
        details: err?.details || null,
        message:
          err?.message ||
          "Fatal error Unexpected error occurred and service is unable complete the request.",
      });
    }
  });

  done();
};

//Protected Routes
export const PrivateRouters = (fastify, opts, done) => {
  // Validating Token
  fastify.addHook("onRequest", (req, reply) =>
    ValidateToken(req, reply, fastify),
  );

  // Capture the response that went on the wire (bounded + sanitised — see
  // src/utils/capture.js) so the console can show what the caller got back.
  fastify.addHook("onSend", (req, reply, payload, done) => {
    try {
      if (
        payload !== undefined &&
        payload !== null &&
        typeof payload !== "function"
      ) {
        req.activityResponsePayload = buildResponseSnapshot(
          reply.statusCode,
          payload,
        );
      }
    } catch {
      req.activityResponsePayload = null;
    }
    done();
  });

  // Activity log — one row per request, written after the response is
  // already on the wire so logging never adds latency to the caller. Covers
  // every outcome: a clean 200, a gate denial (req.access set, allowed:
  // false), and a raw auth failure (bad/expired token — req.access was
  // never reached, so this falls back to the response status alone).
  fastify.addHook("onResponse", (req, reply, done) => {
    const access = req.access;
    const resource = req.routeOptions?.url || req.raw?.url || req.url;

    logActivity({
      envId: req.envId || null,
      environmentName: req.environmentName || null,
      surface: "rest",
      actorEmail: req.callerEmail || null,
      action: actionForMethod(req.method),
      resource,
      method: req.method,
      allowed: access ? !!access.allowed : reply.statusCode < 400,
      code: access?.code || (reply.statusCode >= 400 ? "AUTH_FAILED" : null),
      statusCode: reply.statusCode,
      ip: access?.ip || req.ip || null,
      category: categoryForUrl(resource),
      requestPayload: captureRequest(req),
      responsePayload: req.activityResponsePayload || null,
    });

    done();
  });

  fastify.register(campaignRoute, { prefix: "/wrikexpi/campaign" });
  fastify.register(channelRoute, { prefix: "/wrikexpi/channel" });
  fastify.register(taskRoute, { prefix: "/wrikexpi/task" });
  fastify.register(masterRoute, { prefix: "/wrikexpi/v1.0" });
  fastify.register(amoebaRoute, { prefix: "/wrikexpi/amoeba" });

  // Traditional REST route
  fastify.get(
    "/wrikexpi/campaign/:campaignId/channel",
    GetAllChannelsSchema,
    async (req, reply) => {
      try {
        const result = await GetAllChannels(
          req?.wrikeToken,
          { ...req.params, ...req.query },
          fastify,
        );

        reply.code(result.statusCode || 200).send({
          success: true,
          message: result.message,
          nextPageToken: result.nextPageToken,
          data: result?.data,
        });
      } catch (err) {
        reply.code(err?.statusCode || 400).send({
          success: false,
          details: err?.details || null,
          message:
            err?.message ||
            "Fatal error Unexpected error occurred and service is unable complete the request.",
        });
      }
    },
  );

  // Task REST route
  fastify.get(
    "/wrikexpi/channel/:channelId/task",
    GetAllChannelTasksSchema,
    async (req, reply) => {
      try {
        const result = await GetAllTasks(
          req?.wrikeToken,
          { ...req.params, ...req.query },
          "channel",
          fastify,
        );

        reply.code(result.statusCode || 200).send({
          success: true,
          message: result.message,
          nextPageToken: result.nextPageToken,
          data: result?.data,
        });
      } catch (err) {
        reply.code(err?.statusCode || 400).send({
          success: false,
          details: err?.details || null,
          message:
            err?.message ||
            "Fatal error Unexpected error occurred and service is unable complete the request.",
        });
      }
    },
  );

  fastify.get(
    "/wrikexpi/campaign/:campaignId/task",
    GetAllCampaignTasksSchema,
    async (req, reply) => {
      try {
        const result = await GetAllTasks(
          req?.wrikeToken,
          { ...req.params, ...req.query },
          "campaign",
          fastify,
        );

        reply.code(result.statusCode || 200).send({
          success: true,
          message: result.message,
          nextPageToken: result.nextPageToken,
          data: result?.data,
        });
      } catch (err) {
        reply.code(err?.statusCode || 400).send({
          success: false,
          details: err?.details || null,
          message:
            err?.message ||
            "Fatal error Unexpected error occurred and service is unable complete the request.",
        });
      }
    },
  );

  done();
};
