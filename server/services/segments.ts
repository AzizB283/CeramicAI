/**
 * Segment preview helper.
 *
 * The rule→SQL translation lives in storage.resolveSegment (it touches the db
 * and the suppression list). This thin wrapper gives the routes a preview shape
 * — audience size + a small sample — without exposing every contact. Must run
 * inside a tenant context.
 */
import { storage } from "../storage";
import type { SegmentRule } from "@shared/types";

export interface SegmentPreview {
  total: number; // contacts matching the rule (opted-out excluded)
  sendable: number; // … minus suppressed (who would actually be mailed)
  sample: Array<{ name: string | null; company: string | null; country: string | null; email: string | null }>;
}

export async function previewSegment(rule: SegmentRule): Promise<SegmentPreview> {
  const all = await storage.resolveSegment(rule, { forSend: false });
  const sendable = await storage.resolveSegment(rule, { forSend: true });
  return {
    total: all.length,
    sendable: sendable.length,
    sample: all.slice(0, 10).map((c) => ({
      name: c.name,
      company: c.company,
      country: c.country,
      email: c.email,
    })),
  };
}
