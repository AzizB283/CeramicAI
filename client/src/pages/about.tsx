import { Button } from "@/components/ui/button";
import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";
import { MessageCircle, Mail, MapPin, Factory, Target, Handshake } from "lucide-react";

// Contact details — adjust to the real Aurex Auto channels before launch.
// WHATSAPP_NUMBER must be intl format with NO leading "+" (wa.me requirement).
const WHATSAPP_NUMBER = "918160739392";
const CONTACT_EMAIL = "contact@aurexauto.com";

const VALUES = [
  {
    icon: Factory,
    title: "Built for Morbi",
    body: "We understand how ceramic factories and exporters actually sell — buyer types, catalogs, Incoterms, distributor deals. The bot speaks your business.",
  },
  {
    icon: Target,
    title: "Outcomes, not gimmicks",
    body: "This isn't an 'AI chatbot' for show. It exists to do one thing: capture more qualified leads so your sales team closes more business.",
  },
  {
    icon: Handshake,
    title: "A partner, not just software",
    body: "We set up your catalog, products, and WhatsApp ourselves, and we're here when you onboard. You focus on tiles; we handle the bot.",
  },
];

export default function AboutPage() {
  const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    "Hi, I'd like a CeramicBot demo for my factory.",
  )}`;

  return (
    <div className="min-h-screen bg-cream">
      <PublicNavbar />

      <main>
        {/* About */}
        <section className="px-4 pb-12 pt-32 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-coral/10 px-3 py-1 text-sm font-medium text-coral-dark">
              A product by Aurex Auto
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              We help Morbi&apos;s ceramic businesses sell smarter
            </h1>
            <p className="mt-4 text-lg text-ink-soft">
              CeramicBot is built by{" "}
              <a
                href="https://aurexauto.com"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-coral-dark hover:underline"
              >
                Aurex Auto
              </a>{" "}
              for the factories and exporters of Morbi, Gujarat — the heart of India&apos;s
              ceramic industry. Our goal is simple: make sure no buyer inquiry ever slips
              through the cracks.
            </p>
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
            {VALUES.map((v) => (
              <div
                key={v.title}
                className="rounded-2xl border border-ink/10 bg-cream p-6 shadow-sm"
              >
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-coral/10 text-coral-dark">
                  <v.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold text-ink">{v.title}</h3>
                <p className="mt-2 text-sm text-ink-soft">{v.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section className="px-4 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-3xl border border-ink/10 bg-cream-deep/30 p-8 sm:p-12">
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-ink">
                  Book a demo
                </h2>
                <p className="mt-3 text-ink-soft">
                  Tell us about your factory and we&apos;ll set up a live CeramicBot demo on
                  your own products and catalog. Message us on WhatsApp or email — we usually
                  reply the same day.
                </p>
                <div className="mt-6 flex items-center gap-2 text-sm text-ink-soft">
                  <MapPin className="h-4 w-4 text-coral" />
                  Morbi, Gujarat, India
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Button size="lg" asChild>
                  <a href={whatsappHref} target="_blank" rel="noreferrer">
                    <MessageCircle className="mr-2 h-5 w-5" />
                    Chat on WhatsApp
                  </a>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href={`mailto:${CONTACT_EMAIL}?subject=CeramicBot demo request`}>
                    <Mail className="mr-2 h-5 w-5" />
                    {CONTACT_EMAIL}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
