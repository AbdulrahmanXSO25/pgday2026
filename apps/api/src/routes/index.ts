import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { healthRoutes } from "./health.js";
import { registrationRoutes } from "./registrations.js";
import { cfpRoutes } from "./cfp.js";
import { cfpReviewRoutes } from "./cfp-reviews.js";
import { authRoutes } from "./auth.js";
import { usersRoutes } from "./users.js";
import { speakerRoutes } from "./speakers.js";
import { sessionRoutes } from "./sessions.js";
import { roomRoutes } from "./rooms.js";
import { sponsorRoutes } from "./sponsors.js";
import { mediaRoutes } from "./media.js";
import { publishingRoutes } from "./publishing.js";
import { publishRoutes } from "./publish.js";
import { checkinRoutes } from "./checkin.js";
import { auditRoutes } from "./audit.js";
import { settingsRoutes } from "./settings.js";

/**
 * Register all §26 route skeletons on the shared Hono app.
 * Each sub-router is mounted at root (paths are absolute inside).
 * Pure composition — no global state.
 */
export function registerRoutes(app: Hono<AppEnv>): void {
  app.route("/", healthRoutes());
  app.route("/", registrationRoutes());
  app.route("/", cfpRoutes());
  app.route("/", cfpReviewRoutes());
  app.route("/", authRoutes());
  app.route("/", usersRoutes());
  app.route("/", speakerRoutes());
  app.route("/", sessionRoutes());
  app.route("/", roomRoutes());
  app.route("/", sponsorRoutes());
  app.route("/", mediaRoutes());
  app.route("/", publishRoutes());
  app.route("/", publishingRoutes());
  app.route("/", checkinRoutes());
  app.route("/", auditRoutes());
  app.route("/", settingsRoutes());
}
