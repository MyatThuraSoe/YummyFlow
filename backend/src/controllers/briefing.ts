import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  collectMetrics,
  forecastDemand,
  generateBriefing,
  getLatestBriefings,
  type BriefingKindValue,
} from "../lib/briefing";

const KINDS: BriefingKindValue[] = ["EXECUTIVE", "FORECAST"];

const parseKind = (value: unknown): BriefingKindValue => {
  const v = String(value ?? "").toUpperCase();
  return (KINDS as string[]).includes(v) ? (v as BriefingKindValue) : "EXECUTIVE";
};

/**
 * Generate a briefing on demand and persist it.
 * Body: { kind?: "EXECUTIVE" | "FORECAST" }
 */
export const generate = async (req: Request, res: Response) => {
  try {
    const kind = parseKind(req.body?.kind ?? req.query?.kind);
    const briefing = await generateBriefing(kind);
    res.status(201).json({ data: briefing });
  } catch (error: any) {
    console.error("Briefing generate error:", error);
    res.status(500).json({ error: "Failed to generate briefing", detail: error?.message });
  }
};

/** Cached latest briefing for each kind — never calls the AI. */
export const latest = async (_req: Request, res: Response) => {
  try {
    const { executive, forecast } = await getLatestBriefings();
    res.status(200).json({ data: { executive, forecast } });
  } catch (error) {
    console.error("Briefing latest error:", error);
    res.status(500).json({ error: "Failed to load latest briefings" });
  }
};

/** Paginated history. ?kind=&take=&skip= */
export const list = async (req: Request, res: Response) => {
  try {
    const take = Math.min(Number(req.query.take) || 20, 100);
    const skip = Number(req.query.skip) || 0;
    const kindParam = req.query.kind ? parseKind(req.query.kind) : undefined;

    const where = kindParam ? { kind: kindParam } : {};
    const [data, total] = await Promise.all([
      prisma.briefing.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.briefing.count({ where }),
    ]);

    res.status(200).json({ data, total, take, skip });
  } catch (error) {
    console.error("Briefing list error:", error);
    res.status(500).json({ error: "Failed to list briefings" });
  }
};

export const getOne = async (req: Request, res: Response) => {
  try {
    const briefing = await prisma.briefing.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!briefing) return res.status(404).json({ error: "Briefing not found" });
    res.status(200).json({ data: briefing });
  } catch (error) {
    console.error("Briefing get error:", error);
    res.status(500).json({ error: "Failed to load briefing" });
  }
};

/**
 * Raw live metrics + the deterministic forecast, with no AI and no persistence.
 * The dashboard charts use this so they render instantly.
 */
export const metrics = async (_req: Request, res: Response) => {
  try {
    const snapshot = await collectMetrics();
    res.status(200).json({
      data: { metrics: snapshot, forecast: forecastDemand(snapshot) },
    });
  } catch (error) {
    console.error("Briefing metrics error:", error);
    res.status(500).json({ error: "Failed to compute metrics" });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    await prisma.briefing.delete({ where: { id: String(req.params.id) } });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Briefing delete error:", error);
    res.status(500).json({ error: "Failed to delete briefing" });
  }
};
