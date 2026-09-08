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
import { AuthorizeRequest } from "../middlewares/apiAuthorization";

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
  // 1. Authentication — is this a valid token, and whose is it?
  fastify.addHook("onRequest", (req, reply) =>
    ValidateToken(req, reply, fastify),
  );

  // 2. Authorization — is that person allowed to do this, in this
  //    environment? Allow list, Xtend API flag, then the CRUD grant.
  fastify.addHook("onRequest", AuthorizeRequest);

  // Deliberately reachable to an authenticated caller the gates would
  // otherwise refuse (see ALWAYS_ALLOWED in the authorization middleware):
  // it is how an integration finds out *why* it is being turned away, and
  // what it is actually allowed to do, without anyone reading server logs.
  // It exposes only the caller's own identity and grants.
  fastify.get("/wrikexpi/whoami", async (req, reply) => {
    const access = req.access || {};

    return reply.code(200).send({
      success: true,
      data: {
        email: access.email || null,
        display_name: access.displayName || null,
        environment: req.environmentName || null,
        authorized: !!access.allowed,
        reason: access.allowed ? null : access.code || null,
        message: access.allowed ? null : access.message || null,
        permissions: access.permissions || {
          read: false,
          create: false,
          update: false,
          delete: false,
        },
        checks: (access.gates || []).map((g) => ({
          check: g.label,
          status: g.status,
          detail: g.detail,
        })),
      },
    });
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
