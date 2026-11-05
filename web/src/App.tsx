import { useEffect, useState } from 'react';
import { CircleHelp, KeyRound } from 'lucide-react';
import { DemoKeyModal } from './components/demo-key-modal.tsx';
import { FulfillmentInvestigationTab } from './components/fulfillment-investigation-tab.tsx';
import { IconGithub } from './components/icon-github.tsx';
import { OnboardingDrawer } from './components/onboarding/onboarding-drawer.tsx';
import { ThemeToggle, type Theme } from './components/theme-toggle.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Button, buttonClasses } from './components/ui/button.tsx';
import { Tooltip, TooltipProvider } from './components/ui/tooltip.tsx';
import { REPO_URL } from './lib/links.ts';

// `VITE_API_URL` names the Investigations API's base URL. Empty by default,
// so `FulfillmentInvestigationTab` requests relative paths, which Vite's dev
// server proxies to the local Investigations API (`pnpm dev serve`,
// `vite.config.ts`, `docs/adr/0014`) instead of the browser calling
// `http://localhost:8787` directly and hitting a CORS failure. The same
// built bundle picks up a deployed URL later by setting this at build/
// deploy time; no code here changes. The header's mode badge reads off this
// too.
const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

// Persisted client-side so whoever's driving a demo only pastes the demo
// key once per browser, not once per investigation (`ADR-0022`). Never
// written into the built bundle itself (that would defeat the point of a
// secret header). Local dev's proxied API isn't gated at all, so an empty
// key there is expected, not an error state.
const DEMO_KEY_STORAGE_KEY = 'support-investigator-demo-key';

// The inline script in `index.html` applies this before first paint (no
// FOUC); React only mirrors it afterwards. See ADR-0024.
const THEME_STORAGE_KEY = 'support-investigator-theme';

// Set the first time the onboarding drawer auto-opens; its absence is what
// triggers that first auto-open (ADR-0025). Never cleared, so a returning
// visitor only ever opens it via the header button.
const ONBOARDING_SEEN_STORAGE_KEY = 'support-investigator-onboarding-seen';

/** Storage can throw (private mode, blocked site data); the app must still render. */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the in-memory state still applies for this visit.
  }
}

/**
 * ANIM-009: suppress every transition for the frame the theme flips, so
 * colours change at once instead of each element easing at its own speed.
 */
function applyThemeWithoutTransitions(theme: Theme): void {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  document.documentElement.dataset.theme = theme;
  // Force a style flush before re-enabling transitions.
  void window.getComputedStyle(document.body).opacity;
  requestAnimationFrame(() => style.remove());
}

export function App() {
  const [demoKey, setDemoKey] = useState(
    () => readStorage(DEMO_KEY_STORAGE_KEY) ?? '',
  );
  const [demoKeyOpen, setDemoKeyOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    if (document.documentElement.dataset.theme !== theme) {
      applyThemeWithoutTransitions(theme);
    }
    writeStorage(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (readStorage(ONBOARDING_SEEN_STORAGE_KEY)) return;
    setOnboardingOpen(true);
    writeStorage(ONBOARDING_SEEN_STORAGE_KEY, '1');
  }, []);

  function handleDemoKeyChange(value: string) {
    setDemoKey(value);
    writeStorage(DEMO_KEY_STORAGE_KEY, value);
  }

  const deployed = API_BASE_URL !== '';

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={400}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium shadow-raised focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/70">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-inverse font-mono text-xs font-semibold text-on-inverse"
            >
              SI
            </span>
            <span className="truncate text-sm font-semibold tracking-tight">
              Support Investigator
            </span>
          </div>

          <span className="hidden sm:contents">
            <Tooltip
              label={
                deployed
                  ? `Calling the deployed API at ${API_BASE_URL}`
                  : 'Vite dev proxy to the local Investigations API on :8787 (ADR-0014)'
              }
            >
              <Badge
                tone={deployed ? 'accent' : 'neutral'}
                tabIndex={0}
                className="cursor-default"
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${deployed ? 'bg-accent' : 'bg-fg-subtle'}`}
                />
                {deployed ? 'Deployed API' : 'Local dev'}
              </Badge>
            </Tooltip>
          </span>

          <nav
            aria-label="Application"
            className="ml-auto flex items-center gap-0.5"
          >
            <Tooltip label="How it works">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOnboardingOpen(true)}
                aria-label="How it works"
              >
                <CircleHelp aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip
              label={
                demoKey ? 'Demo key saved in this browser' : 'Set the demo key'
              }
            >
              <Button
                variant="ghost"
                onClick={() => setDemoKeyOpen(true)}
                className="px-2.5 sm:px-3"
              >
                <KeyRound aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Demo key</span>
                {demoKey && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-success"
                  />
                )}
              </Button>
            </Tooltip>
            <ThemeToggle
              theme={theme}
              onToggle={() =>
                setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
              }
            />
            <Tooltip label="View source on GitHub">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View source on GitHub"
                className={buttonClasses({ variant: 'ghost', size: 'icon' })}
              >
                <IconGithub />
              </a>
            </Tooltip>
          </nav>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-4 pt-8 pb-16 focus:outline-none sm:px-6 sm:pt-10"
      >
        <div className="mb-7 max-w-2xl space-y-2">
          <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">
            Fulfillment
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Why can’t this order ship?
          </h1>
          <p className="text-lede text-fg-muted">
            Investigate a product that shows stock but gets no delivery option
            at checkout. Evidence comes from five read-only checks across
            inventory, warehouse, dock and shipping policy, and a deterministic
            policy decides the Finding.
          </p>
        </div>

        <FulfillmentInvestigationTab baseUrl={API_BASE_URL} demoKey={demoKey} />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-6 text-caption text-fg-subtle sm:flex-row sm:justify-between sm:px-6">
          <p>
            The Finding Policy decides deterministically. A model never assigns
            a Finding.
          </p>
          <p>Independent portfolio project.</p>
        </div>
      </footer>

      <DemoKeyModal
        open={demoKeyOpen}
        onClose={() => setDemoKeyOpen(false)}
        demoKey={demoKey}
        onDemoKeyChange={handleDemoKeyChange}
        deployed={deployed}
      />

      <OnboardingDrawer
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
      />
    </TooltipProvider>
  );
}
