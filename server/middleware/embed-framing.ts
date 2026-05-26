import type { Request, Response, NextFunction } from "express";

/**
 * Allow CeramicBot's /chat page and widget.js to be loaded from any site.
 *
 * Single-tenant for now: we permit framing from anywhere. When we add the
 * `allowedEmbedDomains` column to ceramic_clients (multi-tenant), upgrade
 * this to `frame-ancestors 'self' https://d1 https://d2 …` based on the
 * resolved client (slug from req.query.client) — see clinic-ai's
 * `embed-framing.ts` for that pattern.
 */
export function allowEmbedding(_req: Request, res: Response, next: NextFunction) {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
}
