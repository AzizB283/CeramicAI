import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";
import {
  MessageSquare,
  Users,
  FileText,
  Bell,
  Globe2,
  Clock,
  ShieldCheck,
  ArrowRight,
  Factory,
} from "lucide-react";

const BENEFITS = [
  {
    icon: Users,
    title: "Qualifies every buyer",
    body: "Knows the difference between a retailer, a builder, and an export distributor — and asks the right questions for each.",
  },
  {
    icon: FileText,
    title: "Shares the right catalog",
    body: "Sends the matching product or export catalog the moment a buyer says what they need. No back-and-forth.",
  },
  {
    icon: Bell,
    title: "Never misses a hot lead",
    body: "Distributor and exclusive-rights inquiries are flagged as priority and alert your team instantly.",
  },
  {
    icon: Globe2,
    title: "Built for export too",
    body: "Handles international buyers — country, Incoterms, container volume, sample requests — in their own flow.",
  },
  {
    icon: Clock,
    title: "Answers 24/7",
    body: "Works while your sales team sleeps. Every WhatsApp and website message gets an instant, on-brand reply.",
  },
  {
    icon: ShieldCheck,
    title: "Your data, encrypted",
    body: "Buyer names and phone numbers are encrypted at rest. Each factory's leads stay private to that factory.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Connect your number",
    body: "Plug in your WhatsApp Business number and website widget. We handle the bot.",
  },
  {
    n: "2",
    title: "Set your catalog & products",
    body: "Tell the bot what you sell — categories, sizes, finishes — and paste your catalog links.",
  },
  {
    n: "3",
    title: "Capture leads automatically",
    body: "Buyers chat, the bot qualifies them, and every lead lands in your dashboard — ready for your team.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-cream">
      <PublicNavbar />

      <main>
        {/* Hero */}
        <section className="px-4 pb-20 pt-32 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="space-y-8">
                <div className="inline-flex items-center gap-2 rounded-full bg-coral/10 px-3 py-1 text-sm font-medium text-coral-dark">
                  <Factory className="h-4 w-4" />
                  For ceramic factories &amp; exporters in Morbi
                </div>
                <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl">
                  Turn every WhatsApp message into a{" "}
                  <span className="text-coral">qualified lead</span>
                </h1>
                <p className="max-w-lg text-lg text-ink-soft">
                  CeramicBot is an AI assistant that talks to your buyers on WhatsApp and your
                  website — qualifies them, shares the right catalog, and captures the lead so
                  your sales team only handles serious inquiries.
                </p>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <Button size="lg" asChild>
                    <Link href="/about">
                      Book a demo <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link href="/features">See what it does</Link>
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-6 text-sm text-ink-soft">
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-coral" /> Replies 24/7
                  </span>
                  <span className="flex items-center gap-2">
                    <Globe2 className="h-4 w-4 text-coral" /> Domestic &amp; export
                  </span>
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-coral" /> Leads encrypted
                  </span>
                </div>
              </div>

              {/* Static chat mockup — illustrative only, not a live bot */}
              <div className="relative">
                <div className="rounded-3xl border border-ink/10 bg-gradient-to-br from-coral/15 to-cream-deep/30 p-6 shadow-xl">
                  <div className="overflow-hidden rounded-2xl bg-cream shadow-lg">
                    <div className="flex items-center gap-3 bg-ink px-4 py-3 text-cream">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-coral text-white">
                        <MessageSquare className="h-5 w-5" />
                      </div>
                      <div className="leading-tight">
                        <div className="text-sm font-semibold">CeramicBot</div>
                        <div className="text-xs text-cream/60">online · replies instantly</div>
                      </div>
                    </div>
                    <div className="space-y-3 px-4 py-4">
                      <Bubble bot>Welcome to Shree Tiles, Morbi 🏭 Who are you?</Bubble>
                      <Bubble>Distributor / Wholesaler</Bubble>
                      <Bubble bot>
                        Great — which product? GVT, PGVT, Double Charge, Slab…
                      </Bubble>
                      <Bubble>GVT, 600×600, matte</Bubble>
                      <Bubble bot>
                        Here&apos;s our GVT catalog 👇 Our team will share pricing shortly.
                        May I have your name?
                      </Bubble>
                    </div>
                  </div>
                </div>
                <div className="absolute -bottom-4 -right-2 rounded-xl border border-ink/10 bg-cream px-4 py-3 shadow-lg">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Bell className="h-4 w-4 text-coral" />
                    Priority lead → owner notified
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="bg-cream-deep/30 px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-ink">
                Your sales team, minus the busywork
              </h2>
              <p className="mt-3 text-ink-soft">
                CeramicBot handles the repetitive first conversation so your team spends time
                only on buyers worth their time.
              </p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="rounded-2xl border border-ink/10 bg-cream p-6 shadow-sm"
                >
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-coral/10 text-coral-dark">
                    <b.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-semibold text-ink">{b.title}</h3>
                  <p className="mt-2 text-sm text-ink-soft">{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-ink">
                Live in a day, not a quarter
              </h2>
              <p className="mt-3 text-ink-soft">
                No new app for your buyers, no training for your team.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-coral text-lg font-bold text-white">
                    {s.n}
                  </div>
                  <h3 className="mt-4 font-semibold text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm text-ink-soft">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl rounded-3xl bg-ink px-8 py-14 text-center text-cream shadow-xl">
            <h2 className="text-3xl font-bold tracking-tight">
              Ready to stop losing leads on WhatsApp?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-cream/70">
              See CeramicBot qualify a buyer end-to-end on your own catalog. We&apos;ll set up a
              live demo for your factory.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Button size="lg" asChild>
                <Link href="/about">
                  Book a demo <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="border-cream/30 bg-transparent text-cream hover:bg-cream/10 hover:text-cream"
              >
                <Link href="/features">Explore features</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

function Bubble({ children, bot }: { children: React.ReactNode; bot?: boolean }) {
  return (
    <div className={bot ? "flex justify-start" : "flex justify-end"}>
      <div
        className={
          bot
            ? "max-w-[80%] rounded-2xl rounded-bl-sm bg-ink px-4 py-2 text-sm text-cream"
            : "max-w-[80%] rounded-2xl rounded-br-sm bg-coral px-4 py-2 text-sm text-white"
        }
      >
        {children}
      </div>
    </div>
  );
}
