import { db } from "./db";
import { ceramicClients } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "./storage";

const DEMO_CLIENT_NAME = "Shree Tiles Pvt Ltd (Demo)";

let cachedId: string | null = null;

/** Ensure exactly one demo client exists; return its id (cached after first call). */
export async function ensureDemoClient(): Promise<string> {
  if (cachedId) return cachedId;
  const [existing] = await db
    .select()
    .from(ceramicClients)
    .where(eq(ceramicClients.name, DEMO_CLIENT_NAME))
    .limit(1);
  if (existing) {
    cachedId = existing.id;
    return cachedId;
  }
  const created = await storage.createClient({
    name: DEMO_CLIENT_NAME,
    mode: "factory",
    ownerName: "Demo Owner",
    ownerWhatsapp: "+910000000000",
    catalogUrl: "https://aurexauto.com/demo/catalog-factory.pdf",
    exportCatalogUrl: "https://aurexauto.com/demo/catalog-export.pdf",
  });
  cachedId = created.id;
  return cachedId;
}
