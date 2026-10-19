import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit, clientIp } from "../lib/audit.js";
import { ok } from "../lib/respond.js";
import {
  activeLicenseKey,
  decodeLicense,
  getFeatures,
  getLimits,
  limitUsage,
  setRuntimeLicenseKey,
} from "../lib/license.js";
import { getMachineId } from "../lib/machine.js";

export const licenseRouter = Router();
licenseRouter.use(requireAuth);

type LicenseReason = "none" | "no_license" | "wrong_machine" | "expired" | "invalid";

async function buildStatus(restaurantId: string) {
  const key = activeLicenseKey();
  let reason: LicenseReason = "no_license";
  let expiresAt: string | null = null;

  if (key) {
    try {
      const lic = decodeLicense(key);
      reason = "none";
      expiresAt = lic.expiresAt ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      reason =
        msg === "LICENSE_MACHINE_MISMATCH"
          ? "wrong_machine"
          : msg === "LICENSE_EXPIRED"
            ? "expired"
            : "invalid";
    }
  }

  const limits = getLimits();
  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return {
    machineId: getMachineId(),
    edition: limits.edition,
    licensed: limits.edition !== "BASIC" || (reason === "none" && !!key),
    limits,
    features: getFeatures(),
    usage: (await limitUsage(restaurantId)).usage,
    expiresAt,
    daysLeft,
    reason,
  };
}

licenseRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    ok(res, await buildStatus(req.auth!.restaurantId), "License status loaded");
  }),
);

const activateSchema = z.object({ licenseKey: z.string().min(16).max(8192) });

licenseRouter.post(
  "/activate",
  requirePermission("settings.manage"),
  validate({ body: activateSchema }),
  asyncHandler(async (req, res) => {
    const licenseKey = (req.body as z.infer<typeof activateSchema>).licenseKey.trim();

    let decoded;
    try {
      decoded = decodeLicense(licenseKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code =
        msg === "LICENSE_EXPIRED" || msg === "LICENSE_MACHINE_MISMATCH" ? msg : "LICENSE_INVALID";
      const message =
        code === "LICENSE_EXPIRED"
          ? "This license has expired. Paste a renewed key."
          : code === "LICENSE_MACHINE_MISMATCH"
            ? "This license was issued for a different machine."
            : "This license key is invalid.";
      throw new ApiError(400, code, message);
    }

    setRuntimeLicenseKey(licenseKey);
    await prisma.restaurant.update({
      where: { id: req.auth!.restaurantId },
      data: { licenseKey },
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "LICENSE_ACTIVATED",
      entityType: "Restaurant",
      entityId: req.auth!.restaurantId,
      after: { edition: decoded.edition, expiresAt: decoded.expiresAt ?? null },
      ipAddress: clientIp(req),
    });

    ok(res, await buildStatus(req.auth!.restaurantId), "License activated");
  }),
);
