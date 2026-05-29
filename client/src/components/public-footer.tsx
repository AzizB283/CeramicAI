import { Link } from "wouter";

export function PublicFooter() {
  return (
    <footer className="border-t border-ink/10 bg-cream-deep/40">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-coral font-bold text-white">
                C
              </div>
              <span className="text-lg font-bold tracking-tight text-ink">
                Ceramic<span className="text-coral">Bot</span>
              </span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-ink-soft">
              An AI WhatsApp &amp; web assistant for ceramic factories and exporters in
              Morbi — qualifies buyers, shares your catalog, and captures every lead.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-ink">Product</h4>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li><Link href="/features"><span className="cursor-pointer hover:text-ink">Features</span></Link></li>
              <li><Link href="/about"><span className="cursor-pointer hover:text-ink">About</span></Link></li>
              <li><Link href="/login"><span className="cursor-pointer hover:text-ink">Sign in</span></Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-ink">Company</h4>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>
                <a
                  href="https://aurexauto.com"
                  target="_blank"
                  rel="noreferrer"
                  className="cursor-pointer hover:text-ink"
                >
                  Aurex Auto
                </a>
              </li>
              <li><Link href="/about"><span className="cursor-pointer hover:text-ink">Contact</span></Link></li>
              <li className="text-ink-soft">Morbi, Gujarat</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-ink/10 pt-6 text-center text-xs text-ink/50">
          © {new Date().getFullYear()} CeramicBot — a product by{" "}
          <a
            href="https://aurexauto.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-coral-dark hover:underline"
          >
            Aurex Auto
          </a>
          . Built for Morbi&apos;s ceramic industry.
        </div>
      </div>
    </footer>
  );
}
