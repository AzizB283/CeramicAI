import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";
import {
  Users,
  FileText,
  Bell,
  Globe2,
  MessageSquare,
  LayoutDashboard,
  Boxes,
  Palette,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: Users,
    title: "Smart buyer qualification",
    body: "The bot identifies whether it's talking to a retailer, distributor, architect, builder, or export buyer — and branches the conversation to ask exactly what matters for each. No generic script.",
  },
  {
    icon: Boxes,
    title: "Your products, your way",
    body: "Configure the categories you actually sell — GVT, PGVT, Double Charge, Slab, Sanitaryware, or your own custom line — with the specific sizes and finishes you offer. Buyers only see real options.",
  },
  {
    icon: FileText,
    title: "Automatic catalog sharing",
    body: "Upload your catalog PDFs by category. The moment a buyer specifies a product, the bot sends the matching catalog — domestic or export — without anyone lifting a finger.",
  },
  {
    icon: Bell,
    title: "Priority lead alerts",
    body: "Distributor and exclusive-rights inquiries are the highest-value conversations. The bot flags them as priority and notifies the owner immediately — these never sit in a queue.",
  },
  {
    icon: Globe2,
    title: "Export-ready conversations",
    body: "International buyers get a dedicated flow: destination country, Incoterms (FOB / CIF / Ex-Works), container volume, and sample requests — captured cleanly for your export manager.",
  },
  {
    icon: MessageSquare,
    title: "WhatsApp + website, one bot",
    body: "The same assistant runs on your WhatsApp Business number and as a chat widget on your website. Buyers reach you wherever they are; you manage it all in one place.",
  },
  {
    icon: LayoutDashboard,
    title: "Every lead in one dashboard",
    body: "Buyer name, location, product interest, quantity, and Incoterms land in your admin dashboard — sortable, with priority leads surfaced first. PII is encrypted at rest.",
  },
  {
    icon: Palette,
    title: "Branded to your factory",
    body: "Set the bot's name, welcome message, and theme color to match your brand. Buyers feel like they're talking to you — because they are.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-cream">
      <PublicNavbar />

      <main>
        <section className="px-4 pb-12 pt-32 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              Everything CeramicBot does for your factory
            </h1>
            <p className="mt-4 text-lg text-ink-soft">
              Built specifically for Morbi&apos;s ceramic industry — not a generic chatbot
              bolted onto your business.
            </p>
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex gap-4 rounded-2xl border border-ink/10 bg-cream p-6 shadow-sm"
              >
                <div className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-coral/10 text-coral-dark">
                  <f.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-ink">{f.title}</h3>
                  <p className="mt-2 text-sm text-ink-soft">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-3xl bg-ink px-8 py-12 text-center text-cream">
            <h2 className="text-2xl font-bold">See it on your own catalog</h2>
            <p className="mx-auto mt-3 max-w-xl text-cream/70">
              We&apos;ll walk you through a live demo set up for your factory&apos;s products.
            </p>
            <div className="mt-6 flex justify-center">
              <Button size="lg" asChild>
                <Link href="/about">
                  Book a demo <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
