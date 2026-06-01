import type { AppContext, AppModule } from '@/app/app-context';
import * as d3 from 'd3';
import { normalizeExclusiveChoropleths } from '@/components/resilience-choropleth-utils';
import { replayPendingCalls, clearAllPendingCalls } from '@/app/pending-panel-data';
import { getAlertsNearLocation } from '@/services/geo-convergence';
import { effectivePubDateMs } from '@/services/feed-date';
import type { ClusteredEvent } from '@/types';
import type { RelatedAsset } from '@/types';
import type { TheaterPostureSummary } from '@/services/military-surge';
import {
  NewsPanel,
  MarketPanel,
  StockAnalysisPanel,
  StockBacktestPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  CryptoHeatmapPanel,
  DefiTokensPanel,
  AiTokensPanel,
  OtherTokensPanel,
  PredictionPanel,
  MonitorPanel,
  LatestBriefPanel,
  EconomicPanel,
  ConsumerPricesPanel,
  EnergyComplexPanel,
  OilInventoriesPanel,
  GdeltIntelPanel,
  LiveNewsPanel,
  getDefaultLiveChannels,
  loadChannelsFromStorage,
  LiveWebcamsPanel,
  PinnedWebcamsPanel,
  CIIPanel,
  CascadePanel,
  StrategicRiskPanel,
  StrategicPosturePanel,
  TechEventsPanel,
  ServiceStatusPanel,
  InternetDisruptionsPanel,
  RuntimeConfigPanel,
  InsightsPanel,
  MacroSignalsPanel,
  FearGreedPanel,
  MarketBreadthPanel,
  ETFFlowsPanel,
  StablecoinPanel,
  UcdpEventsPanel,
  InvestmentsPanel,
  TradePolicyPanel,
  SupplyChainPanel,
  SanctionsPressurePanel,
  GulfEconomiesPanel,
  GroceryBasketPanel,
  BigMacPanel,
  FuelPricesPanel,
  FaoFoodPriceIndexPanel,
  ClimateNewsPanel,
  WorldClockPanel,
  AirlineIntelPanel,
  AviationCommandBar,
  MilitaryCorrelationPanel,
  EscalationCorrelationPanel,
  EconomicCorrelationPanel,
  DisasterCorrelationPanel,
  DefensePatentsPanel,
  HormuzPanel,
  ChokepointStripPanel,
  PipelineStatusPanel,
  StorageFacilityMapPanel,
  FuelShortagePanel,
  EnergyDisruptionsPanel,
  EnergyRiskOverviewPanel,
  MacroTilesPanel,
  FSIPanel,
  YieldCurvePanel,
  EarningsCalendarPanel,
  EconomicCalendarPanel,
  CotPositioningPanel,
  LiquidityShiftsPanel,
  PositioningPanel,
  GoldIntelligencePanel,
  DiseaseOutbreaksPanel,
  SocialVelocityPanel,
  WsbTickerScannerPanel,
  AAIISentimentPanel,
  EnergyCrisisPanel,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { focusInvestmentOnMap } from '@/services/investments-focus';
import { debounce, saveToStorage, loadFromStorage, showToast } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import {
  FEEDS,
  CANONICAL_FEEDS,
  INTEL_SOURCES,
  STORAGE_KEYS,
  SITE_VARIANT,
  ALL_PANELS,
  VARIANT_DEFAULTS,
  isPanelInVariantDefaults,
} from '@/config';
import { resolveNewsCategories, enabledNewsCategoryKeys } from '@/config/feed-resolution';
import { t } from '@/services/i18n';
import { getCurrentTheme } from '@/utils';
import { trackCriticalBannerAction } from '@/services/analytics';
import { CustomWidgetPanel } from '@/components/CustomWidgetPanel';
import { openWidgetChatModal } from '@/components/WidgetChatModal';
import { loadWidgets, saveWidget } from '@/services/widget-store';
import type { CustomWidgetSpec } from '@/services/widget-store';
import { initEntitlementSubscription, destroyEntitlementSubscription, isEntitled, hasTier, getEntitlementState, onEntitlementChange, shouldReloadOnEntitlementChange } from '@/services/entitlements';
import { initSubscriptionWatch, destroySubscriptionWatch } from '@/services/billing';
import { initPaymentFailureBanner } from '@/components/payment-failure-banner';
import { handleCheckoutReturn } from '@/services/checkout-return';
import { initCheckoutOverlay, destroyCheckoutOverlay, showCheckoutSuccess, consumePostCheckoutFlag, clearCheckoutAttempt } from '@/services/checkout';
import { showCheckoutFailureBanner } from '@/components/checkout-failure-banner';
import { McpDataPanel } from '@/components/McpDataPanel';
import { openMcpConnectModal } from '@/components/McpConnectModal';
import { loadMcpPanels, saveMcpPanel } from '@/services/mcp-store';
import type { McpPanelSpec } from '@/services/mcp-store';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import type { AuthSession } from '@/services/auth-state';
import { PanelGateReason, getPanelGateReason, hasPremiumAccess } from '@/services/panel-gating';
import type { Panel } from '@/components/Panel';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';


/**
 * Panels that require premium access on web. Auth-based gating applies to
 * these — `updatePanelGating()` calls `Panel.showGatedCta()` to render
 * "Sign In to Unlock" / "Upgrade to Pro" for non-premium users.
 *
 * INVARIANT: every panel listed in `apiKeyPanels` (src/config/panels.ts
 * `isPanelEntitled`) MUST appear here. If it's API-key-entitled but missing
 * from this set, anonymous/free-Clerk users see the panel mount and run
 * its loader (which writes empty/loading/error UI directly into the body)
 * instead of the lock CTA. The PRO badge in the title still renders, so
 * the symptom is "PRO badge + panel-internal loading or empty copy"
 * which looks broken (e.g. Regional Intelligence rendering its empty-state
 * "is being refreshed" message to anonymous users — see todo #257 item 8).
 *
 * The static test in tests/panel-config-guardrails.test.mjs enforces
 * `apiKeyPanels ⊆ WEB_PREMIUM_PANELS` so this drift can't recur silently.
 */
const WEB_PREMIUM_PANELS = new Set([
  'stock-analysis',
  'stock-backtest',
  'daily-market-brief',
  'market-implications',
  'deduction',
  'chat-analyst',
  'wsb-ticker-scanner',
  'latest-brief',
  'regional-intelligence',
  'trade-policy',
]);

/**
 * Panels that require a Clerk-authenticated PRO account specifically.
 * Desktop API key / browser tester keys do NOT satisfy the gate because
 * these panels are bound to a Clerk userId server-side (e.g. the Brief
 * is stored at brief:{clerkUserId}:{date} in Redis — no Clerk user, no
 * brief to fetch).
 *
 * Without this extra gate, API-key + free-Clerk users would see the
 * panel "unlocked" by hasPremiumAccess() and then hit a 403 when the
 * server re-checks entitlement from the JWT. This set promotes the
 * inconsistency to the layout gating layer so the user sees the
 * correct "Upgrade to Pro" CTA instead of a doomed fetch.
 */
const WEB_CLERK_PRO_ONLY_PANELS = new Set([
  'latest-brief',
]);

export interface PanelLayoutManagerCallbacks {
  openCountryStory: (code: string, name: string) => void;
  openCountryBrief: (code: string) => void;
  loadAllData: () => Promise<void>;
  updateMonitorResults: () => void;
  loadSecurityAdvisories?: () => Promise<void>;
}

export class PanelLayoutManager implements AppModule {
  private ctx: AppContext;
  private callbacks: PanelLayoutManagerCallbacks;
  private panelDragCleanupHandlers: Array<() => void> = [];
  private resolvedPanelOrder: string[] = [];
  private bottomSetMemory: Set<string> = new Set();
  private criticalBannerEl: HTMLElement | null = null;
  private aviationCommandBar: AviationCommandBar | null = null;
  private readonly applyTimeRangeFilterDebounced: (() => void) & { cancel(): void };
  private unsubscribeAuth: (() => void) | null = null;
  private proBlockUnsubscribe: (() => void) | null = null;
  private proBlockEntitlementUnsubscribe: (() => void) | null = null;
  private boundWidgetCreatorHandler: ((e: Event) => void) | null = null;
  private unsubscribeEntitlementChange: (() => void) | null = null;
  private unsubscribePaymentFailureBanner: (() => void) | null = null;
  private scheduledLoadAllRaf: number | null = null;

  constructor(ctx: AppContext, callbacks: PanelLayoutManagerCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.applyTimeRangeFilterDebounced = debounce(() => {
      this.applyTimeRangeFilterToNewsPanels();
    }, 120);

    // Dodo Payments: entitlement subscription + billing watch for ALL users.
    // Free users need the subscription active so they receive real-time
    // entitlement updates after purchasing (P1: newly upgraded users must
    // see their premium access without a manual page reload).
    //
    // Two return paths need to seed the transition detector as post-checkout:
    //   1. Full-page Dodo redirect — handleCheckoutReturn() reads
    //      subscription_id/status URL params and cleans them.
    //   2. Dodo overlay success — setTimeout(reload) with no URL params;
    //      we stash a session flag before the reload and consume it here.
    const returnResult = handleCheckoutReturn();
    const returnedFromOverlay = consumePostCheckoutFlag();
    const returnedFromCheckout = returnResult.kind === 'success' || returnedFromOverlay;
    if (returnedFromCheckout) {
      // Full-page return cleared its URL params; belt-and-braces clear
      // of the attempt record here catches the success path where the
      // overlay handler never ran (direct Dodo redirect).
      clearCheckoutAttempt('success');
      // waitForEntitlement: true keeps the banner mounted across the
      // entitlement-watcher reload (post-PR-4 the watcher is the single
      // reload source). If the user is already entitled on mount the
      // banner goes straight to the "active" state; otherwise it waits
      // up to 30s for the transition before surfacing a manual-refresh
      // CTA. `email` is read from auth-state (authoritative on the main
      // app) and masked in the banner before rendering to keep the raw
      // address out of screenshots / screen-shares of the banner.
      showCheckoutSuccess({
        waitForEntitlement: true,
        email: getAuthState().user?.email ?? null,
      });
    } else if (returnResult.kind === 'failed') {
      showCheckoutFailureBanner(returnResult.rawStatus);
    }

    // Always register the payment-failure-banner listener — onSubscriptionChange
    // is an in-memory listener registry, doesn't open any network connection,
    // and survives the destroy/reinit cycle on auth transitions (see
    // billing.ts:124-126). Registering once here means the banner reacts when
    // a user signs in mid-session and the App.ts auth-state subscription
    // (App.ts:995-1006) starts the Convex subscription watch.
    this.unsubscribePaymentFailureBanner = initPaymentFailureBanner();

    // Defer Convex subscriptions until a real Clerk identity exists.
    //
    // `getUserId()` (user-identity.ts) always returns truthy for browser
    // users — it falls back to an auto-generated `wm-anon-id` UUID — so the
    // previous `if (userId)` gate never short-circuited. That meant every
    // anonymous visitor opened a Convex WebSocket via getConvexClient()
    // with `setAuth(getClerkToken)` returning null, which the Convex SDK
    // could not authenticate, producing a constant
    //   `WebSocket connection to wss://…/api/1.34.0/sync failed`
    // reconnect loop in DevTools (todo #257 item 4). The subscriptions
    // themselves never delivered useful state for anon users either:
    //   - getEntitlementsForUser returns FREE_TIER_DEFAULTS without auth
    //   - getSubscriptionForUser returns null without auth
    // — so the loop was pure noise.
    //
    // For users who sign in mid-session, App.ts:1003-1006 destroys and
    // re-initializes both subscriptions against the real Clerk userId, so
    // skipping here is a no-op for the signed-in path.
    //
    // Note: PanelLayoutManager is constructed before initAuthState() awaits
    // Clerk, so getAuthState().user is null even for users who will silently
    // restore a Clerk session on this page load. Those users are picked up
    // by subscribeAuthState a few hundred ms later via the same App.ts
    // rebind path. Constructor-time anon is the common case.
    if (getAuthState().user) {
      const userId = getAuthState().user!.id;
      initEntitlementSubscription(userId).catch(() => {});
      initSubscriptionWatch(userId).catch(() => {});
    }

    // Overlay success fires BEFORE the entitlement-watcher reload. The
    // banner stays mounted through the reload via waitForEntitlement so
    // the user sees visual continuity from "Payment received!" through
    // "Premium activated" without a blank intermediate state. Read the
    // email lazily at fire-time (not at register-time) so a just-signed-
    // in buyer who completes checkout in the same session still sees
    // the receipt acknowledgement.
    initCheckoutOverlay(() => showCheckoutSuccess({
      waitForEntitlement: true,
      email: getAuthState().user?.email ?? null,
    }));

    // Reload only on a free→pro transition. Legacy-pro users whose first
    // snapshot is already pro (lastEntitled === null) must not trigger a
    // reload loop, but a user who pays mid-session (false → true) must see
    // their panels unlock without manual refresh.
    //
    // When we just returned from a Dodo full-page redirect checkout, seed
    // lastEntitled = false instead of null. The webhook may have already
    // landed by the time the user's browser comes back, so the first
    // entitlement snapshot can arrive as pro. Without this seed the
    // transition detector would swallow that snapshot as "legacy-pro" and
    // the user would see locked panels until a manual refresh — exactly the
    // symptom that caused the 2026-04-17/18 duplicate-subscription incident.
    //
    // REQUIRES_SKIP_INITIAL_SNAPSHOT_BEHAVIOR — the watcher is the SOLE
    // automatic reload source for post-checkout success (the overlay
    // handler in checkout.ts deliberately does NOT reload). If PR #3163's
    // fix to `skipInitialSnapshot` is ever reverted, this detector
    // swallows the activation silently and users see locked panels for
    // 30s until the extended-unlock timeout fires a manual-refresh CTA.
    // Regression guard: tests/entitlement-transition.test.mts locks the
    // "incident sequence" semantics; see mirror marker in checkout.ts.
    let lastEntitled: boolean | null = returnedFromCheckout ? false : null;
    this.unsubscribeEntitlementChange = onEntitlementChange(() => {
      const entitled = isEntitled();
      const reload = shouldReloadOnEntitlementChange(lastEntitled, entitled);
      lastEntitled = entitled;
      if (reload) {
        console.log('[entitlements] Subscription activated — reloading to unlock panels');
        window.location.reload();
        return;
      }
      // Re-run panel gating on every entitlement snapshot. hasPremiumAccess()
      // now consults isEntitled(), so a legacy-pro user whose first snapshot
      // is already pro (null→true — intentionally not reloaded to avoid a
      // loop) still needs the paywall overlay lifted; likewise on WS reconnect
      // or entitlement revocation, the lock state must follow the current
      // snapshot synchronously rather than waiting for the next auth event.
      this.updatePanelGating(getAuthState());
    });
  }

  async init(): Promise<void> {
    await this.renderLayout();
    this.setupTacticalWorkspace();

    // Subscribe to auth state for reactive panel gating on web
    this.unsubscribeAuth = subscribeAuthState((state) => {
      this.updatePanelGating(state);
    });

    // Handle analyst action chip "Create chart widget →" click
    this.boundWidgetCreatorHandler = ((e: CustomEvent<{ initialMessage?: string }>) => {
      openWidgetChatModal({
        mode: 'create',
        tier: 'pro',
        initialMessage: e.detail.initialMessage,
        onComplete: (spec) => this.addCustomWidget(spec),
      });
    }) as EventListener;
    this.ctx.container.addEventListener('wm:open-widget-creator', this.boundWidgetCreatorHandler);
  }

  destroy(): void {
    clearAllPendingCalls();
    this.applyTimeRangeFilterDebounced.cancel();
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    this.proBlockUnsubscribe?.();
    this.proBlockUnsubscribe = null;
    this.proBlockEntitlementUnsubscribe?.();
    this.proBlockEntitlementUnsubscribe = null;
    if (this.boundWidgetCreatorHandler) {
      this.ctx.container.removeEventListener('wm:open-widget-creator', this.boundWidgetCreatorHandler);
      this.boundWidgetCreatorHandler = null;
    }
    this.panelDragCleanupHandlers.forEach((cleanup) => cleanup());
    this.panelDragCleanupHandlers = [];
    if (this.scheduledLoadAllRaf !== null) {
      cancelAnimationFrame(this.scheduledLoadAllRaf);
      this.scheduledLoadAllRaf = null;
    }
    if (this.criticalBannerEl) {
      this.criticalBannerEl.remove();
      this.criticalBannerEl = null;
    }
    // Clean up happy variant panels
    this.ctx.tvMode?.destroy();
    this.ctx.tvMode = null;
    this.ctx.countersPanel?.destroy();
    this.ctx.progressPanel?.destroy();
    this.ctx.breakthroughsPanel?.destroy();
    this.ctx.heroPanel?.destroy();
    this.ctx.digestPanel?.destroy();
    this.ctx.speciesPanel?.destroy();
    this.ctx.renewablePanel?.destroy();

    // Clean up aviation components
    this.aviationCommandBar?.destroy();
    this.aviationCommandBar = null;
    this.ctx.panels['airline-intel']?.destroy();

    // Clean up billing subscription watch + entitlement subscription
    destroySubscriptionWatch();
    destroyEntitlementSubscription();

    // Clean up entitlement change listener
    this.unsubscribeEntitlementChange?.();
    this.unsubscribeEntitlementChange = null;

    // Clean up payment failure banner subscription
    this.unsubscribePaymentFailureBanner?.();
    this.unsubscribePaymentFailureBanner = null;

    // Reset checkout overlay so next layout init can register its callback
    destroyCheckoutOverlay();

    window.removeEventListener('resize', this.ensureCorrectZones);
  }

  /** Reactively update premium panel gating based on auth state. */
  private updatePanelGating(state: AuthSession): void {
    for (const [key, panel] of Object.entries(this.ctx.panels)) {
      const isPremium = WEB_PREMIUM_PANELS.has(key);
      let reason = getPanelGateReason(state, isPremium);

      // Clerk-pro-only panels: even when hasPremiumAccess() returns
      // true via API/tester key, these panels need a Clerk userId
      // bound to a PRO entitlement. We DO NOT trust client-side
      // entitlement state as an authoritative gate — the server-side
      // /api/latest-brief check is authoritative. We only downgrade
      // the gate reason here as AFFIRMATIVE DENIAL: when we KNOW
      // (snapshot loaded AND tier < 1) the user is free. In every
      // other case — snapshot not yet loaded, Convex subscription
      // skipped, transient failure — we leave the panel unlocked
      // and let the server 403 path drive the upgrade CTA inside
      // the panel's refresh() catch block.
      //
      // Prior iterations of this code tried the opposite — gating
      // positively on hasTier(1) — and locked legitimate Pro users
      // out whenever the Convex snapshot was late, skipped, or
      // failed. Affirmative-denial-only is the right shape: never
      // over-gate, accept the one-doomed-fetch-per-session cost
      // for API-key-only + free-Clerk users as the lesser harm.
      if (
        reason === PanelGateReason.NONE &&
        WEB_CLERK_PRO_ONLY_PANELS.has(key) &&
        getEntitlementState() !== null &&
        !hasTier(1)
      ) {
        reason = state.user ? PanelGateReason.FREE_TIER : PanelGateReason.ANONYMOUS;
      }

      if (reason === PanelGateReason.NONE) {
        // User has access -- unlock if previously locked
        (panel as Panel).unlockPanel();
      } else {
        // User does NOT have access -- show appropriate CTA
        const onAction = this.getGateAction(reason);
        (panel as Panel).showGatedCta(reason, onAction);
      }
    }
  }

  /** Return the action callback for a given gate reason. */
  private getGateAction(reason: PanelGateReason): () => void {
    switch (reason) {
      case PanelGateReason.ANONYMOUS:
        return () => this.ctx.authModal?.open();
      case PanelGateReason.FREE_TIER:
        return () => window.open('https://ajnav.com/pro', '_blank');
      default:
        return () => {};
    }
  }

  async renderLayout(): Promise<void> {
    setTrustedHtml(this.ctx.container, trustedHtml(`
      ${this.ctx.isDesktopApp ? '<div class="tauri-titlebar" data-tauri-drag-region></div>' : ''}
      <div class="header">
        <div class="header-left">
          <div class="logo-wrapper">
            <span class="logo">CHANAKYA</span>
            <span class="version">v${__APP_VERSION__}</span>
            <button class="sidebar-toggle-btn" id="sidebarToggleBtn" title="Toggle Sidebar">
              <img src="/favico/favicon-32x32.png" alt="Chanakya Logo" />
            </button>
          </div>
          <button class="hamburger-btn" id="hamburgerBtn" aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div class="variant-switcher">${(() => {
        const local = this.ctx.isDesktopApp || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        const inIframe = window.self !== window.top;
        const vHref = (v: string, prod: string) => local || SITE_VARIANT === v ? '#' : prod;
        const vTarget = (v: string) => !local && SITE_VARIANT !== v && inIframe ? 'target="_blank" rel="noopener"' : '';
        return `
            <a href="${vHref('full', 'https://ajnav.com')}"
               class="variant-option ${SITE_VARIANT === 'full' ? 'active' : ''}"
               data-variant="full"
               ${vTarget('full')}
               title="${t('header.world')}${SITE_VARIANT === 'full' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></span>
              <span class="variant-label">${t('header.world')}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="${vHref('tech', 'https://tech.ajnav.com')}"
               class="variant-option ${SITE_VARIANT === 'tech' ? 'active' : ''}"
               data-variant="tech"
               ${vTarget('tech')}
               title="${t('header.tech')}${SITE_VARIANT === 'tech' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cpu"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 15h3"/><path d="M1 9h3"/><path d="M1 15h3"/></svg></span>
              <span class="variant-label">${t('header.tech')}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="${vHref('finance', 'https://finance.ajnav.com')}"
               class="variant-option ${SITE_VARIANT === 'finance' ? 'active' : ''}"
               data-variant="finance"
               ${vTarget('finance')}
               title="${t('header.finance')}${SITE_VARIANT === 'finance' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-up"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span>
              <span class="variant-label">${t('header.finance')}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="${vHref('commodity', 'https://commodity.ajnav.com')}"
               class="variant-option ${SITE_VARIANT === 'commodity' ? 'active' : ''}"
               data-variant="commodity"
               ${vTarget('commodity')}
               title="${t('header.commodity')}${SITE_VARIANT === 'commodity' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pickaxe"><path d="M14.5 2 22 9.5M16 8.5l5.5 5.5M10.75 14.25l-7 7a1.07 1.07 0 0 1-1.5 0 1.07 1.07 0 0 1 0-1.5l7-7M22 22l-6-6M8 6l6 6"/></svg></span>
              <span class="variant-label">${t('header.commodity')}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="${vHref('energy', 'https://energy.ajnav.com')}"
               class="variant-option ${SITE_VARIANT === 'energy' ? 'active' : ''}"
               data-variant="energy"
               ${vTarget('energy')}
               title="${t('header.energy')}${SITE_VARIANT === 'energy' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
              <span class="variant-label">${t('header.energy')}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="${vHref('happy', 'https://happy.ajnav.com')}"
               class="variant-option ${SITE_VARIANT === 'happy' ? 'active' : ''}"
               data-variant="happy"
               ${vTarget('happy')}
               title="Good News${SITE_VARIANT === 'happy' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg></span>
              <span class="variant-label">Good News</span>
            </a>`;
      })()}</div>
          <a href="https://ajnav.com" target="_blank" rel="noopener" class="credit-link">
            <span class="credit-text">Ajnav Labs</span>
          </a>
          <button class="mobile-settings-btn" id="mobileSettingsBtn" title="${t('header.settings')}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>${t('header.live')}</span>
          </div>
          <div class="region-selector">
            <select id="regionSelect" class="region-select">
              <option value="global">${t('components.deckgl.views.global')}</option>
              <option value="america">${t('components.deckgl.views.americas')}</option>
              <option value="mena">${t('components.deckgl.views.mena')}</option>
              <option value="eu">${t('components.deckgl.views.europe')}</option>
              <option value="asia">${t('components.deckgl.views.asia')}</option>
              <option value="latam">${t('components.deckgl.views.latam')}</option>
              <option value="africa">${t('components.deckgl.views.africa')}</option>
              <option value="oceania">${t('components.deckgl.views.oceania')}</option>
            </select>
          </div>
          <button class="mobile-search-btn" id="mobileSearchBtn" aria-label="${t('header.search')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
        </div>
        <div class="header-right">
          <button class="search-btn" id="searchBtn"><kbd>⌘K</kbd> ${t('header.search')}</button>
          ${this.ctx.isDesktopApp ? '' : `<button class="copy-link-btn" id="copyLinkBtn">${t('header.copyLink')}</button>`}
          ${this.ctx.isDesktopApp ? '' : `<button class="fullscreen-btn" id="fullscreenBtn" title="${t('header.fullscreen')}">⛶</button>`}
          ${SITE_VARIANT === 'happy' ? `<button class="tv-mode-btn" id="tvModeBtn" title="TV Mode (Shift+T)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></button>` : ''}
          <span id="unifiedSettingsMount"></span>
          <span id="authWidgetMount" class="auth-widget-mount" style="display:inline-flex;align-items:center;min-width:148px;min-height:32px"></span>
        </div>
      </div>

      <!-- Premium Gemini-like floating AI Chat popup modal (Alt+P) -->
      <div class="ai-chat-popup-overlay" id="aiChatPopupOverlay">
        <div class="ai-chat-popup-container">
          <div class="ai-chat-popup-header">
            <div class="ai-chat-popup-title-left">
              <img src="/favico/favicon-32x32.png" alt="Chanakya Logo" class="ai-chat-popup-logo" />
              <span class="ai-chat-popup-title-text">CHANAKYA TACTICAL COMS</span>
            </div>
            <button class="ai-chat-popup-close-btn" id="aiChatPopupCloseBtn" title="Close Popup (Esc)">&times;</button>
          </div>
          <div class="ai-chat-popup-body" id="aiChatPopupBody">
            <div class="ai-chat-popup-welcome-wrapper" id="aiChatWelcomeWrapper">
              <h2 class="ai-chat-popup-welcome-title">What can I help with, Santhosh?</h2>
              <p class="ai-chat-popup-welcome-sub">Paste any news feed or tactical intelligence below. I will analyze the threats and help you ideate strategic plans.</p>
            </div>
            <div class="ai-chat-popup-messages-list" id="aiChatPopupMessagesList" style="display:none;"></div>
          </div>
          <div class="ai-chat-popup-input-area">
            <div class="ai-chat-popup-input-pill">
              <button class="ai-chat-popup-import-btn" id="aiChatPopupImportBtn" title="Import active intelligence">+</button>
              <textarea class="ai-chat-popup-textarea" id="aiChatPopupTextarea" placeholder="Ask Chanakya AI..." rows="1"></textarea>
              <div class="ai-chat-popup-controls-right">
                <select class="ai-chat-popup-model-select" id="aiChatPopupModelSelect">
                  <option value="flash">Flash-Lite</option>
                  <option value="pro">Pro-Model</option>
                </select>
                <button class="ai-chat-popup-mic-btn" id="aiChatPopupMicBtn" title="Voice Input">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mic"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="mobile-menu-overlay" id="mobileMenuOverlay"></div>
      <nav class="mobile-menu" id="mobileMenu">
        <div class="mobile-menu-header">
          <span class="mobile-menu-title">CHANAKYA DASHBOARD</span>
          <button class="mobile-menu-close" id="mobileMenuClose" aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="mobile-menu-divider"></div>
        ${(() => {
        const variants = [
          { key: 'full', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`, label: t('header.world') },
          { key: 'tech', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cpu"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 15h3"/><path d="M1 9h3"/><path d="M1 15h3"/></svg>`, label: t('header.tech') },
          { key: 'finance', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-up"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`, label: t('header.finance') },
          { key: 'commodity', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pickaxe"><path d="M14.5 2 22 9.5M16 8.5l5.5 5.5M10.75 14.25l-7 7a1.07 1.07 0 0 1-1.5 0 1.07 1.07 0 0 1 0-1.5l7-7M22 22l-6-6M8 6l6 6"/></svg>`, label: t('header.commodity') },
          { key: 'energy', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`, label: t('header.energy') },
          { key: 'happy', icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>`, label: 'Good News' },
        ];
        return variants.map(v =>
          `<button class="mobile-menu-item mobile-menu-variant ${v.key === SITE_VARIANT ? 'active' : ''}" data-variant="${v.key}">
            <span class="mobile-menu-item-icon">${v.icon}</span>
            <span class="mobile-menu-item-label">${v.label}</span>
            ${v.key === SITE_VARIANT ? '<span class="mobile-menu-check">✓</span>' : ''}
          </button>`
        ).join('');
      })()}
        <div class="mobile-menu-divider"></div>
        <button class="mobile-menu-item" id="mobileMenuRegion">
          <span class="mobile-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></span>
          <span class="mobile-menu-item-label">${t('components.deckgl.views.global')}</span>
          <span class="mobile-menu-chevron">▸</span>
        </button>
        <div class="mobile-menu-divider"></div>
        <button class="mobile-menu-item" id="mobileMenuSettings">
          <span class="mobile-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span class="mobile-menu-item-label">${t('header.settings')}</span>
        </button>
        <button class="mobile-menu-item" id="mobileMenuTheme">
          <span class="mobile-menu-item-icon">${getCurrentTheme() === 'dark' ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'}</span>
          <span class="mobile-menu-item-label">${getCurrentTheme() === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
        <a class="mobile-menu-item" href="https://ajnav.com" target="_blank" rel="noopener">
          <span class="mobile-menu-item-label">Ajnav Labs</span>
        </a>
        <div class="mobile-menu-divider"></div>
        <div class="mobile-menu-footer-links">
          <a href="https://pro.ajnav.com" target="_blank" rel="noopener">Pro</a>
          <a href="https://ajnav.com/blog/" target="_blank" rel="noopener">Blog</a>
          <a href="https://ajnav.com/docs" target="_blank" rel="noopener">Docs</a>
          <a href="https://status.ajnav.com/" target="_blank" rel="noopener">Status</a>
        </div>
        <div class="mobile-menu-version">v${__APP_VERSION__}</div>
      </nav>
      <div class="region-sheet-backdrop" id="regionSheetBackdrop"></div>
      <div class="region-bottom-sheet" id="regionBottomSheet">
        <div class="region-sheet-header">${t('header.selectRegion')}</div>
        <div class="region-sheet-divider"></div>
        ${[
        { value: 'global', label: t('components.deckgl.views.global') },
        { value: 'america', label: t('components.deckgl.views.americas') },
        { value: 'mena', label: t('components.deckgl.views.mena') },
        { value: 'eu', label: t('components.deckgl.views.europe') },
        { value: 'asia', label: t('components.deckgl.views.asia') },
        { value: 'latam', label: t('components.deckgl.views.latam') },
        { value: 'africa', label: t('components.deckgl.views.africa') },
        { value: 'oceania', label: t('components.deckgl.views.oceania') },
      ].map(r =>
        `<button class="region-sheet-option ${r.value === 'global' ? 'active' : ''}" data-region="${r.value}">
          <span>${r.label}</span>
          <span class="region-sheet-check">${r.value === 'global' ? '✓' : ''}</span>
        </button>`
      ).join('')}
      </div>

      <!-- Enterprise Browser tab bar -->
      <div class="tactical-tab-bar">
        <div class="tab-item active" data-tab="home">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-dashboard"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="10" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          <span>Home Dashboard</span>
        </div>
        <div class="tab-item" data-tab="planner">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
          <span>Operation Planner</span>
        </div>
        <div class="tab-item" data-tab="ai-agent">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
          <span>AI Tactical Agent</span>
        </div>
        <div class="tab-item" data-tab="harvester">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search-code"><path d="m13 13.5 2-2.5-2-2.5"/><path d="m21 21-4.3-4.3"/><path d="M9 8.5 7 11l2 2.5"/><circle cx="11" cy="11" r="8"/></svg>
          <span>OSINT Harvester</span>
        </div>
        <div class="tab-item" data-tab="repository">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-archive"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
          <span>Secure Vault</span>
        </div>
      </div>

      <div class="tactical-tab-viewport">
        <!-- Dashboard Workspace (Active by default) -->
        <div class="tactical-tab-content active" id="tab-home">
          <div class="main-content${this.ctx.isDesktopApp ? ' desktop-grid' : ''}">
            <div class="map-section" id="mapSection">
              <div class="panel-header">
                <div class="panel-header-left">
                  <span class="panel-title">${SITE_VARIANT === 'tech' ? t('panels.techMap') : SITE_VARIANT === 'happy' ? 'Good News Map' : t('panels.map')}</span>
                </div>
                <span class="header-clock" id="headerClock" translate="no"></span>
                <div class="map-header-actions">
                  <div class="map-dimension-toggle" id="mapDimensionToggle">
                    <button class="map-dim-btn${loadFromStorage<string>(STORAGE_KEYS.mapMode, 'flat') === 'globe' ? '' : ' active'}" data-mode="flat" title="2D Map">2D</button>
                    <button class="map-dim-btn${loadFromStorage<string>(STORAGE_KEYS.mapMode, 'flat') === 'globe' ? ' active' : ''}" data-mode="globe" title="3D Globe">3D</button>
                  </div>
                  <button class="map-pin-btn" id="mapFullscreenBtn" title="Fullscreen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                  </button>
                  <button class="map-pin-btn" id="mapPinBtn" title="${t('header.pinMap')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1v3.76z"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="map-container" id="mapContainer"></div>
              ${SITE_VARIANT === 'happy' ? '<button class="tv-exit-btn" id="tvExitBtn">Exit TV Mode</button>' : ''}
              <div class="map-resize-handle" id="mapResizeHandle"></div>
              <div class="map-bottom-grid" id="mapBottomGrid"></div>
            </div>
            <div class="map-width-resize-handle" id="mapWidthResizeHandle"></div>
            <div class="panels-grid" id="panelsGrid"></div>
            <button class="search-mobile-fab" id="searchMobileFab" aria-label="Search"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
          </div>
          <footer class="site-footer">
            <div class="site-footer-brand">
              <img src="/favico/favicon-32x32.png" alt="" width="28" height="28" class="site-footer-icon" />
              <div class="site-footer-brand-text">
                <span class="site-footer-name">CHANAKYA DASHBOARD</span>
                <span class="site-footer-sub">v${__APP_VERSION__} &middot; <a href="https://ajnav.com" target="_blank" rel="noopener" class="site-footer-credit">Ajnav Labs</a></span>
              </div>
            </div>
            <nav>
              <a href="https://pro.ajnav.com" target="_blank" rel="noopener">Pro</a>
              <a href="https://ajnav.com/blog/" target="_blank" rel="noopener">Blog</a>
              <a href="https://ajnav.com/docs" target="_blank" rel="noopener">Docs</a>
              <a href="https://status.ajnav.com/" target="_blank" rel="noopener">Status</a>
              <a href="https://github.com/ajnavlabs" target="_blank" rel="noopener">GitHub</a>
              ${this.ctx.isDesktopApp ? '' : `<span id="footerDownloadMount"></span>`}
            </nav>
            <span class="site-footer-copy">&copy; ${new Date().getFullYear()} Ajnav Labs</span>
          </footer>
        </div>

        <!-- Operation Planner Workspace -->
        <div class="tactical-tab-content" id="tab-planner">
          <!-- Sandbox Top Menu Bar -->
          <div class="sandbox-menu-bar">
            <div class="sandbox-menu-item">
              <button class="sandbox-menu-btn" id="menu-btn-file">File</button>
              <div class="sandbox-dropdown-content">
                <a href="#" id="menu-file-new">New Sandbox</a>
                <a href="#" id="menu-file-open">Open Sandbox...</a>
                <a href="#" id="menu-file-save">Save Sandbox</a>
              </div>
            </div>
            <div class="sandbox-menu-item">
              <button class="sandbox-menu-btn" id="menu-btn-edit">Edit</button>
              <div class="sandbox-dropdown-content">
                <a href="#" id="menu-edit-clear">Clear Selected Nodes</a>
                <a href="#" id="menu-edit-delete">Delete Selection</a>
              </div>
            </div>
            <span class="sandbox-current-file-label" id="sandbox-current-file-label">Active: unsaved_blueprint.json</span>
          </div>

          <!-- Main Interactive Canvas Viewport (Full View) -->
          <div class="sandbox-canvas-container" id="plannerSandboxCol">
            <div class="sandbox-canvas-wrapper" style="width:100%;height:100%;position:relative;">
              <svg id="sandbox-svg" style="width:100%;height:100%;cursor:grab;display:block;"></svg>
              
              <!-- Legend Indicators (Neo4j Style) -->
              <div class="sandbox-neo4j-legend">
                <span class="legend-badge badge-intel" id="legend-intel">Intel: 0</span>
                <span class="legend-badge badge-place" id="legend-place">Place: 0</span>
                <span class="legend-badge badge-people" id="legend-people">People: 0</span>
                <span class="legend-badge badge-location" id="legend-location">Location: 0</span>
                <span class="legend-badge badge-news" id="legend-news">News: 0</span>
                <span class="legend-badge badge-feed" id="legend-feed">Feed: 0</span>
              </div>
              
              <!-- Selected Nodes Info Bubble -->
              <div class="sandbox-selection-info" id="sandbox-selection-info" style="display:none;">
                Selected: <strong id="selected-nodes-count">0</strong> nodes. Press <kbd>Ctrl+Y</kbd> to compile threat COA report.
              </div>
              
              <!-- Keyboard shortcuts indicator overlays -->
              <div style="position:absolute;bottom:10px;right:10px;background:rgba(9,11,16,0.85);padding:6px 12px;border:1px solid rgba(255,255,255,0.05);border-radius:6px;font-size:10px;color:#64748b;pointer-events:none;z-index:5;">
                Shortcuts: Click Node + <kbd>Ctrl+X</kbd> AI Expand | Lasso + <kbd>Ctrl+Y</kbd> COA Briefing | <kbd>Alt+F</kbd> Search | <kbd>Alt+P</kbd> Gemini
              </div>
            </div>

            <!-- Pre-seeded controls toolbar overlay inside center -->
            <div class="sandbox-toolbar-controls" style="position:absolute;top:10px;left:10px;display:flex;gap:6px;align-items:center;background:rgba(9,11,16,0.7);padding:4px;border:1px solid rgba(255,255,255,0.05);border-radius:6px;z-index:5;">
              <button class="sandbox-ctrl-btn active" id="sandbox-tool-drag" style="margin:0;" title="Pan / Drag Node Mode">Drag Mode</button>
              <button class="sandbox-ctrl-btn" id="sandbox-tool-lasso" style="margin:0;" title="Dashed Selection Lasso">+ Lasso</button>
              <button class="sandbox-ctrl-btn" id="sandbox-tool-connect" style="margin:0;" title="Click parent then child to link">Link Mode</button>
              <button class="sandbox-ctrl-btn" id="sandbox-tool-reset" style="margin:0;" title="Reset Viewport">Reset View</button>
            </div>
          </div>

          <!-- Popup 1: Draggable & Minimizable Operational Controls -->
          <div class="planner-floating-popup" id="popup-op-controls">
            <div class="tactical-card-title">
              <div style="display:flex;align-items:center;gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sliders-horizontal"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>
                <span>THEATER POSTURE CONTROLS</span>
              </div>
              <button class="popup-minimize-btn" title="Toggle Minimize">−</button>
            </div>
            <div class="tactical-card-body" style="padding:12px;display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto;">
              <div class="tactical-field">
                <label>Operation Codename</label>
                <input type="text" id="planner-op-name" class="tactical-input" value="OP SENTINEL ESCORT" placeholder="e.g. OP SEA LIGHT" style="height:32px;">
              </div>
              <div class="tactical-field">
                <label>Target Geopolitical Zone</label>
                <select id="planner-op-zone" class="tactical-select" style="height:32px;">
                  <option value="South China Sea">South China Sea (Zone-1)</option>
                  <option value="Bab al-Mandab Strait">Bab al-Mandab Strait (Zone-2)</option>
                  <option value="Suwalki Gap">Suwalki Gap (Zone-3)</option>
                  <option value="Taiwan Strait">Taiwan Strait (Zone-4)</option>
                </select>
              </div>
              <div class="tactical-field">
                <label>Security Posture</label>
                <select id="planner-op-posture" class="tactical-select" style="height:32px;">
                  <option value="DEFCON 3 - INCREASED READINESS">DEFCON 3 - Increased Readiness</option>
                  <option value="DEFCON 2 - HIGH FORCE MOBILITY">DEFCON 2 - High Force Mobility</option>
                  <option value="DEFCON 1 - MAXIMUM VIGILANCE">DEFCON 1 - Maximum Vigilance</option>
                </select>
              </div>
              <div class="tactical-field">
                <label>Deployed Assets</label>
                <input type="text" id="planner-op-assets" class="tactical-input" value="Carrier Strike Group 9, 4x Maritime Patrol P-8A" style="height:32px;">
              </div>
              <div class="tactical-field">
                <label>Mission Objectives / Intelligence Notes</label>
                <textarea id="planner-op-notes" class="tactical-textarea" placeholder="Enter objective summaries..." style="height:44px;"></textarea>
              </div>
            </div>
          </div>

          <!-- Popup 2: Draggable & Minimizable Node Management -->
          <div class="planner-floating-popup" id="popup-node-mgmt">
            <div class="tactical-card-title">
              <div style="display:flex;align-items:center;gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-network"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M12 8v8"/><path d="M12 12H5v4"/><path d="M12 12h7v4"/></svg>
                <span>NODE CREATION WORKBENCH</span>
              </div>
              <button class="popup-minimize-btn" title="Toggle Minimize">−</button>
            </div>
            <div class="tactical-card-body" style="padding:12px;display:flex;flex-direction:column;gap:8px;">
              <div class="tactical-field">
                <label>Node Title</label>
                <input type="text" id="sandbox-new-node-label" class="tactical-input" placeholder="e.g. Swarm Patrol Route" style="height:32px;">
              </div>
              <div class="tactical-field">
                <label>Node Intelligence Variety</label>
                <select id="sandbox-new-node-type" class="tactical-select" style="height:32px;">
                  <option value="Intel">Intel (Yellow)</option>
                  <option value="Place">Place (Purple)</option>
                  <option value="People">People (Orange)</option>
                  <option value="Location">Location (Blue)</option>
                  <option value="News">News (Red)</option>
                  <option value="Feed">Feed (Green)</option>
                </select>
              </div>
              <div class="tactical-field">
                <label>Intelligence Definition</label>
                <input type="text" id="sandbox-new-node-def" class="tactical-input" placeholder="e.g. Spoofing anomalies tracked" style="height:32px;">
              </div>
              <button class="tactical-btn" id="sandbox-add-node-btn" style="height:32px;line-height:32px;padding:0;margin-top:4px;">Add Node to Sandbox</button>
            </div>
          </div>

          <!-- Popup 3: Draggable & Minimizable Intel Briefing (Polished Card) -->
          <div class="planner-floating-popup" id="popup-intel-briefing">
            <div class="tactical-card-title">
              <div style="display:flex;align-items:center;gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                <span>INTEL BRIEFING ASSESSMENT</span>
              </div>
              <button class="popup-minimize-btn" title="Toggle Minimize">−</button>
            </div>
            <div class="tactical-card-body" style="padding:12px;display:flex;flex-direction:column;gap:10px;overflow:hidden;">
              <button class="tactical-btn" id="planner-generate-btn" style="height:32px;line-height:32px;padding:0;background:#2563eb !important;color:#ffffff !important;">Generate Base Strategic Brief</button>
              <div class="tactical-doc-preview" id="planner-output" style="max-height:180px;">
                <h3>Awaiting Operational Setup</h3>
                Configure parameters and click "Generate Base Strategic Brief", or lasso-select sandbox threat elements and press <strong>Ctrl+Y</strong> to compile threat analysis briefings and Courses of Action.
              </div>
              <button class="tactical-btn tactical-btn--secondary" id="planner-save-btn" disabled style="height:32px;line-height:32px;padding:0;">Export Plan to Secure Vault</button>
            </div>
          </div>

          <!-- Sleek Open Sandbox Blueprint Modal -->
          <div class="ai-chat-popup-overlay" id="sandboxOpenModal" style="display:none;z-index:200;">
            <div class="ai-chat-popup-container" style="width:380px;min-height:200px;max-height:50vh;background:rgba(21,24,33,0.95);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,0.08);box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);">
              <div class="ai-chat-popup-header" style="border-bottom:1px solid rgba(255,255,255,0.05);padding:12px 16px;">
                <div class="ai-chat-popup-title-left">
                  <span class="ai-chat-popup-title-text" style="font-weight:700;letter-spacing:1px;color:#3b82f6;">OPEN SECURE SANDBOX BLUEPRINT</span>
                </div>
                <button class="ai-chat-popup-close-btn" id="sandboxOpenModalCloseBtn" style="font-size:20px;">&times;</button>
              </div>
              <div class="ai-chat-popup-body" style="padding:16px;display:flex;flex-direction:column;gap:12px;">
                <label style="font-size:11px;color:#94a3b8;font-weight:700;">SELECT SECURE VAULT DOCUMENT:</label>
                <select id="sandboxOpenSelect" class="tactical-select" style="width:100%;height:36px;"></select>
                <button class="tactical-btn" id="sandboxOpenLoadBtn" style="margin-top:10px;height:36px;line-height:36px;padding:0;background:#2563eb !important;color:#ffffff !important;font-weight:600;">Load Selected Blueprint</button>
              </div>
            </div>
          </div>

        </div>

        <!-- AI Geopolitical Agent Workspace -->
        <div class="tactical-tab-content" id="tab-ai-agent">
          <div class="terminal-chat-container">
            <div class="terminal-header">
              <div class="terminal-status">
                <span class="status-dot" style="background:#10b981;"></span>
                <span>TACTICAL ANALYST AI (SECURE COMS)</span>
              </div>
              <div class="version" style="color:#64748b;font-size:9px;">SECURE-TUNNEL: ACTIVE</div>
            </div>
            <div class="terminal-logs" id="terminal-logs">
              <div class="terminal-row terminal-row--agent">
                <strong>[SYSTEM]</strong> Welcome to Chanakya Tactical Analyst AI. I have synchronized threat telemetry feeds from ACLED, NASA FIRMS, OpenSky ADS-B, and secure maritime AIS.
                <br><br>
                Query me on any ongoing strategic conflict, deployment postures, or infrastructure disruptions.
              </div>
            </div>
            <div class="terminal-suggestions">
              <span class="suggestion-chip" data-query="Assess threat posture in South China Sea">Assess threat posture in South China Sea</span>
              <span class="suggestion-chip" data-query="Analyze GPS Jamming zones and regional flight delay patterns">Analyze GPS Jamming & delays</span>
              <span class="suggestion-chip" data-query="Audit undersea cable faults and maritime AIS anomalies">Audit undersea cable faults & AIS</span>
            </div>
            <div class="terminal-input-bar">
              <input type="text" id="terminal-input" placeholder="Transmit secure query to Tactical Analyst..." />
              <button class="tactical-btn" style="padding:10px 18px;" id="terminal-send-btn">TRANSMIT</button>
            </div>
          </div>
        </div>

        <!-- OSINT Harvester Workspace -->
        <div class="tactical-tab-content" id="tab-harvester">
          <div class="tactical-split-pane" style="grid-template-columns: 1fr 1.3fr !important;">
            <div class="tactical-card">
              <div class="tactical-card-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span>HARVEST INSTRUCTIONS</span>
              </div>
              <div class="tactical-card-body">
                <div class="tactical-field">
                  <label>Target Intel Domain</label>
                  <input type="text" id="harvester-url" class="tactical-input" value="https://secure-intel.ajnav.com/reports/geopolitical-risk-index" placeholder="e.g. domain.com or url">
                </div>
                <div class="tactical-field">
                  <label>Scraping depth</label>
                  <select id="harvester-depth" class="tactical-select">
                    <option value="1">Level 1 - Target Page Only</option>
                    <option value="2">Level 2 - Page + Linked Resources</option>
                    <option value="3">Level 3 - Full Subdomain Crawl</option>
                  </select>
                </div>
                <div class="tactical-field">
                  <label>Entity filters</label>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;color:#94a3b8;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="harvest-filter-loc" checked> Geopolitical Zones</label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="harvest-filter-asset" checked> Military Assets</label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="harvest-filter-cables" checked> Undersea Cables</label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="harvest-filter-incidents" checked> Conflicts & Fires</label>
                  </div>
                </div>
                <button class="tactical-btn" id="harvester-start-btn">Launch OSINT Harvester</button>
              </div>
            </div>
            <div class="tactical-card">
              <div class="tactical-card-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
                <span>HARVEST OUTPUT CONSOLE</span>
              </div>
              <div class="tactical-card-body">
                <div class="harvester-console" id="harvester-console-output">SYSTEM READY. AWAITING OSINT SCAN TARGET INSTRUCTIONS...</div>
                <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #1c202a;padding-top:14px;margin-top:auto;">
                  <span style="font-size:10px;color:#64748b;" id="harvester-stats">Status: Standby</span>
                  <button class="tactical-btn tactical-btn--secondary" style="padding:8px 14px;font-size:10px;" id="harvester-export-btn" disabled>Export Entities to Vault</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Secure Repository Workspace -->
        <div class="tactical-tab-content" id="tab-repository">
          <div class="tactical-card" style="height:100% !important;">
            <div class="tactical-card-title">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>SECURE VAULT INVENTORY</span>
            </div>
            <div class="tactical-card-body">
              <div class="repository-toolbar">
                <input type="text" id="repo-search" class="tactical-input" style="width:300px;" placeholder="Filter secure documents by code, region, type..." />
                <div style="display:flex;gap:8px;">
                  <button class="tactical-btn tactical-btn--secondary" style="padding:8px 14px;" id="repo-export-csv">EXPORT CSV</button>
                  <button class="tactical-btn tactical-btn--secondary" style="padding:8px 14px;" id="repo-export-json">EXPORT JSON</button>
                </div>
              </div>
              <div class="tactical-table-container">
                <table class="tactical-table" id="repo-table">
                  <thead>
                    <tr>
                      <th>Doc ID</th>
                      <th>Document / Log Name</th>
                      <th>Target Zone</th>
                      <th>Threat Level</th>
                      <th>Classification</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody id="repo-table-body">
                    <!-- Dynamic rows -->
                  </tbody>
                </table>
              </div>
            </div>
        </div>
      </div>
    `, "legacy direct innerHTML migration"));

    await this.createPanels();

    if (this.ctx.isMobile) {
      this.setupMobileMapToggle();
    }
  }

  private setupMobileMapToggle(): void {
    const mapSection = document.getElementById('mapSection');
    const headerLeft = mapSection?.querySelector('.panel-header-left');
    if (!mapSection || !headerLeft) return;

    const stored = localStorage.getItem('mobile-map-collapsed');
    const collapsed = stored === 'true';
    if (collapsed) mapSection.classList.add('collapsed');

    const updateBtn = (btn: HTMLButtonElement, isCollapsed: boolean) => {
      btn.textContent = isCollapsed ? `▶ ${t('components.map.showMap')}` : `▼ ${t('components.map.hideMap')}`;
    };

    const btn = document.createElement('button');
    btn.className = 'map-collapse-btn';
    updateBtn(btn, collapsed);
    headerLeft.after(btn);

    btn.addEventListener('click', () => {
      const isCollapsed = mapSection.classList.toggle('collapsed');
      updateBtn(btn, isCollapsed);
      localStorage.setItem('mobile-map-collapsed', String(isCollapsed));
      if (!isCollapsed) window.dispatchEvent(new Event('resize'));
    });
  }

  renderCriticalBanner(postures: TheaterPostureSummary[]): void {
    if (this.ctx.isMobile) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
      }
      document.body.classList.remove('has-critical-banner');
      return;
    }

    const dismissedAt = sessionStorage.getItem('banner-dismissed');
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
      return;
    }

    const critical = postures.filter(
      (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
    );

    if (critical.length === 0) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
        document.body.classList.remove('has-critical-banner');
      }
      return;
    }

    const top = critical[0]!;
    const isCritical = top.postureLevel === 'critical';

    if (!this.criticalBannerEl) {
      this.criticalBannerEl = document.createElement('div');
      this.criticalBannerEl.className = 'critical-posture-banner';
      const header = document.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', this.criticalBannerEl);
    }

    document.body.classList.add('has-critical-banner');
    this.criticalBannerEl.className = `critical-posture-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
    setTrustedHtml(this.criticalBannerEl, trustedHtml(`
      <div class="banner-content">
        <span class="banner-icon">${isCritical ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-siren"><path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M12 2v2"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'}</span>
        <span class="banner-headline">${escapeHtml(top.headline)}</span>
        <span class="banner-stats">${top.totalAircraft} aircraft • ${escapeHtml(top.summary)}</span>
        ${top.strikeCapable ? '<span class="banner-strike">STRIKE CAPABLE</span>' : ''}
      </div>
      <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
      <button class="banner-dismiss">×</button>
    `, "legacy direct innerHTML migration"));

    this.criticalBannerEl.querySelector('.banner-view')?.addEventListener('click', () => {
      console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
      trackCriticalBannerAction('view', top.theaterId);
      if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
        this.ctx.map?.setCenter(top.centerLat, top.centerLon, 4);
      } else {
        console.error('[Banner] Missing coordinates for', top.theaterId);
      }
    });

    this.criticalBannerEl.querySelector('.banner-dismiss')?.addEventListener('click', () => {
      trackCriticalBannerAction('dismiss', top.theaterId);
      this.criticalBannerEl?.classList.add('dismissed');
      document.body.classList.remove('has-critical-banner');
      sessionStorage.setItem('banner-dismissed', Date.now().toString());
    });
  }

  applyPanelSettings(): void {
    Object.entries(this.ctx.panelSettings).forEach(([key, config]) => {
      if (key === 'map') {
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          mapSection.classList.toggle('hidden', !config.enabled);
          const mainContent = document.querySelector('.main-content');
          if (mainContent) {
            mainContent.classList.toggle('map-hidden', !config.enabled);
          }
          this.ensureCorrectZones();
        }
        return;
      }
      const panel = this.ctx.panels[key];
      panel?.toggle(config.enabled);
    });
  }

  /**
   * Lazily instantiates and mounts LiveNewsPanel when channels become available
   * mid-session (e.g. user adds channels via the standalone manager on a variant
   * whose defaults are empty). No-op if the panel already exists or still has no
   * channels. Called from the liveChannels storage event handler.
   */
  mountLiveNewsIfReady(): void {
    if (this.ctx.panels['live-news']) return;
    if (getDefaultLiveChannels().length === 0 && loadChannelsFromStorage().length === 0) return;
    const panel = new LiveNewsPanel();
    this.ctx.panels['live-news'] = panel;
    const el = panel.getElement();
    this.makeDraggable(el, 'live-news');
    const grid = document.getElementById('panelsGrid');
    if (grid) {
      const addBlock = grid.querySelector('.add-panel-block');
      if (addBlock) grid.insertBefore(el, addBlock);
      else grid.appendChild(el);
    }
    this.applyPanelSettings();
    panel.observeNearViewport(() => this.scheduleLoadAllData(), 200);
  }

  private shouldCreatePanel(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.ctx.panelSettings, key);
  }

  private static readonly NEWS_PANEL_TOOLTIPS: Record<string, string> = {
    centralbanks: t('components.centralBankWatch.infoTooltip'),
  };

  private createNewsPanel(key: string, labelKey: string): NewsPanel | null {
    if (!this.shouldCreatePanel(key)) return null;
    const panel = new NewsPanel(key, t(labelKey), PanelLayoutManager.NEWS_PANEL_TOOLTIPS[key]);
    this.attachRelatedAssetHandlers(panel);
    panel.setRiskScoreGetter(PanelLayoutManager.computeEventRisk);
    this.ctx.newsPanels[key] = panel;
    this.ctx.panels[key] = panel;
    return panel;
  }

  // 0-100 event risk score: 0.40×severity + 0.30×geoConvergence + 0.30×CII
  // CII component omitted until lat/lon→country lookup is added; weights rebalanced to 0.57+0.43
  private static computeEventRisk(cluster: ClusteredEvent): number | null {
    if (!cluster.threat) return null;
    const levelScore: Record<string, number> = { critical: 95, high: 75, medium: 50, low: 25, info: 10 };
    const severity = (levelScore[cluster.threat.level] ?? 10) * (cluster.threat.confidence ?? 1);

    const geoAlert = (cluster.lat != null && cluster.lon != null)
      ? getAlertsNearLocation(cluster.lat, cluster.lon, 500)
      : null;
    const geoScore = geoAlert?.score ?? 0;

    // Rebalanced (CII pending): 0.57×severity + 0.43×geoConvergence
    return Math.round(0.57 * severity + 0.43 * geoScore);
  }

  private createPanel<T extends import('@/components/Panel').Panel>(key: string, factory: () => T): T | null {
    if (!this.shouldCreatePanel(key)) return null;
    const panel = factory();
    this.ctx.panels[key] = panel;
    return panel;
  }

  private async createPanels(): Promise<void> {
    const panelsGrid = document.getElementById('panelsGrid')!;

    const mapContainer = document.getElementById('mapContainer') as HTMLElement;
    const preferGlobe = loadFromStorage<string>(STORAGE_KEYS.mapMode, 'flat') === 'globe';
    // Dynamic import: keeps maplibre-gl + @deck.gl/* + @loaders.gl + @luma.gl
    // out of the entry chunk. Loads in parallel with paint, so the map mounts
    // a beat after the panel grid renders instead of blocking it.
    //
    // Residual-risk watchpoint (canary): this await also serializes the
    // ~700 lines of panel construction below behind the map chunk fetch.
    // Failure mode is covered by the chunk-reload guard at src/main.ts:690-758
    // (catches `Failed to fetch dynamically imported module` and reloads).
    // The slow-fetch mode (chunk fetches that succeed but are very slow) is
    // worth watching in production canaries — if it shows up, restructure to
    // kick off the import early and run non-map panel construction before the
    // await (the only direct ctx.map dereferences in this function are
    // initEscalationGetters / getTimeRange right after construction, plus
    // onTimeRangeChanged later — every other ctx.map use is `?.`-guarded).
    const { MapContainer } = await import('@/components/MapContainer');
    this.ctx.map = new MapContainer(mapContainer, {
      zoom: this.ctx.isMobile ? 2.5 : 1.0,
      pan: { x: 0, y: 0 },
      view: this.ctx.isMobile ? this.ctx.resolvedLocation : 'global',
      layers: this.ctx.mapLayers,
      timeRange: '7d',
    }, preferGlobe);

    if (this.ctx.mapLayers.resilienceScore && !this.ctx.map.isDeckGLActive?.()) {
      this.ctx.mapLayers = { ...this.ctx.mapLayers, resilienceScore: false };
      saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
    }

    this.ctx.map.initEscalationGetters();
    this.ctx.currentTimeRange = this.ctx.map.getTimeRange();

    this.createNewsPanel('politics', 'panels.politics');
    this.createNewsPanel('tech', 'panels.tech');
    this.createNewsPanel('finance', 'panels.finance');

    this.createPanel('heatmap', () => new HeatmapPanel());
    this.createPanel('markets', () => new MarketPanel());
    this.createPanel('stock-analysis', () => new StockAnalysisPanel());
    this.createPanel('stock-backtest', () => new StockBacktestPanel());
    // Web premium gating for stock-analysis and stock-backtest is handled
    // reactively by updatePanelGating() via auth state subscription.

    const monitorPanel = this.createPanel('monitors', () => new MonitorPanel(this.ctx.monitors));
    monitorPanel?.onChanged((monitors) => {
      this.ctx.monitors = monitors;
      saveToStorage(STORAGE_KEYS.monitors, monitors);
      this.callbacks.updateMonitorResults();
    });

    // Latest Brief — reads /api/latest-brief and opens the hosted
    // magazine on click. Self-fetching (no data-loader integration);
    // PRO gating handled by the base Panel class via premium: 'locked'.
    this.createPanel('latest-brief', () => new LatestBriefPanel());

    this.createPanel('commodities', () => new CommoditiesPanel());
    this.createPanel('energy-complex', () => new EnergyComplexPanel());
    this.createPanel('oil-inventories', () => new OilInventoriesPanel());
    this.createPanel('energy-crisis', () => new EnergyCrisisPanel());
    this.createPanel('chokepoint-strip', () => new ChokepointStripPanel());
    this.createPanel('pipeline-status', () => new PipelineStatusPanel());
    this.createPanel('storage-facility-map', () => new StorageFacilityMapPanel());
    this.createPanel('fuel-shortages', () => new FuelShortagePanel());
    this.createPanel('energy-disruptions', () => new EnergyDisruptionsPanel());
    this.createPanel('energy-risk-overview', () => new EnergyRiskOverviewPanel());
    this.createPanel('polymarket', () => new PredictionPanel());

    this.createNewsPanel('gov', 'panels.gov');
    this.createNewsPanel('intel', 'panels.intel');

    this.createPanel('crypto', () => new CryptoPanel());
    this.createPanel('crypto-heatmap', () => new CryptoHeatmapPanel());
    this.createPanel('defi-tokens', () => new DefiTokensPanel());
    this.createPanel('ai-tokens', () => new AiTokensPanel());
    this.createPanel('other-tokens', () => new OtherTokensPanel());
    this.createNewsPanel('middleeast', 'panels.middleeast');
    this.createNewsPanel('layoffs', 'panels.layoffs');
    this.createNewsPanel('ai', 'panels.ai');
    this.createNewsPanel('startups', 'panels.startups');
    this.createNewsPanel('vcblogs', 'panels.vcblogs');
    this.createNewsPanel('regionalStartups', 'panels.regionalStartups');
    this.createNewsPanel('unicorns', 'panels.unicorns');
    this.createNewsPanel('accelerators', 'panels.accelerators');
    this.createNewsPanel('funding', 'panels.funding');
    this.createNewsPanel('producthunt', 'panels.producthunt');
    this.createNewsPanel('security', 'panels.security');
    this.createNewsPanel('policy', 'panels.policy');
    this.createNewsPanel('hardware', 'panels.hardware');
    this.createNewsPanel('cloud', 'panels.cloud');
    this.createNewsPanel('dev', 'panels.dev');
    this.createNewsPanel('github', 'panels.github');
    this.createNewsPanel('ipo', 'panels.ipo');
    this.createNewsPanel('thinktanks', 'panels.thinktanks');
    this.createPanel('economic', () => new EconomicPanel());
    this.createPanel('consumer-prices', () => new ConsumerPricesPanel());

    this.createPanel('trade-policy', () => new TradePolicyPanel());
    this.createPanel('sanctions-pressure', () => new SanctionsPressurePanel());
    const supplyChainPanel = this.createPanel('supply-chain', () => new SupplyChainPanel());
    if (supplyChainPanel) {
      supplyChainPanel.setOnScenarioActivate((id, result) => {
        this.ctx.map?.activateScenario(id, result);
      });
      supplyChainPanel.setOnDismissScenario(() => {
        this.ctx.map?.deactivateScenario();
      });
      this.ctx.map?.setSupplyChainPanel(supplyChainPanel);
    }

    this.createNewsPanel('africa', 'panels.africa');
    this.createNewsPanel('latam', 'panels.latam');
    this.createNewsPanel('asia', 'panels.asia');
    this.createNewsPanel('energy', 'panels.energy');

    // Iterate CANONICAL_FEEDS (union of all variants), not just the active
    // variant's FEEDS preset — so a news panel the user customized in from
    // another variant (e.g. Finance `forex` added to a `full` session) still
    // gets a NewsPanel created. The panelSettings gate below ensures only
    // panels the user actually enabled are instantiated.
    for (const key of Object.keys(CANONICAL_FEEDS)) {
      if (this.ctx.newsPanels[key]) continue;
      if (!Array.isArray((CANONICAL_FEEDS as Record<string, unknown>)[key])) continue;
      const panelKey = this.ctx.panels[key] && !this.ctx.newsPanels[key] ? `${key}-news` : key;
      if (this.ctx.panels[panelKey]) continue;
      // Gate on panelKey, NOT key. When `key` collided with a non-news data
      // panel (panelKey became `${key}-news` — e.g. `markets`/`crypto`/`economic`
      // in the full variant), that data panel's own settings entry must NOT
      // spawn a phantom news panel: the remapped key has to be explicitly
      // enabled. When there's no collision, panelKey === key so this is unchanged.
      const panelConfig = this.ctx.panelSettings[panelKey];
      if (!panelConfig) continue;
      const label = panelConfig.name ?? key.charAt(0).toUpperCase() + key.slice(1);
      const tooltip = PanelLayoutManager.NEWS_PANEL_TOOLTIPS[panelKey] ?? PanelLayoutManager.NEWS_PANEL_TOOLTIPS[key];
      const panel = new NewsPanel(panelKey, label, tooltip);
      this.attachRelatedAssetHandlers(panel);
      panel.setRiskScoreGetter(PanelLayoutManager.computeEventRisk);
      this.ctx.newsPanels[key] = panel;
      this.ctx.panels[panelKey] = panel;
    }

    this.createPanel('gdelt-intel', () => new GdeltIntelPanel());

    // Two-arg `.then(onFulfilled, onRejected)` so the rejection handler ONLY catches
    // the dynamic-import promise itself (already suppressed in main.ts beforeSend) and
    // does NOT swallow synchronous throws from the callback body (panel construction,
    // makeDraggable, etc.) — those must continue to surface in Sentry as real bugs.
    import('@/components/DeductionPanel').then(({ DeductionPanel }) => {
      if (typeof DeductionPanel !== 'function') return;
      const deductionPanel = new DeductionPanel(() => this.ctx.allNews);
      this.ctx.panels['deduction'] = deductionPanel;
      const el = deductionPanel.getElement();
      this.makeDraggable(el, 'deduction');
      const grid = document.getElementById('panelsGrid');
      if (grid) {
        const gdeltEl = this.ctx.panels['gdelt-intel']?.getElement();
        if (gdeltEl?.parentNode === grid && gdeltEl.nextSibling) {
          grid.insertBefore(el, gdeltEl.nextSibling);
        } else {
          grid.appendChild(el);
        }
      }
      this.applyPanelSettings();
      this.updatePanelGating(getAuthState());
    }, () => undefined);

    // Guard against named-export resolving to undefined (Safari ESM cache / proxy truncation
    // edge case, WORLDMONITOR-R4): `new undefined` surfaced as
    // `TypeError: undefined is not a constructor (evaluating 'new m')` from this exact line.
    import('@/components/RegionalIntelligenceBoard').then(({ RegionalIntelligenceBoard }) => {
      if (typeof RegionalIntelligenceBoard !== 'function') return;
      const regionalBoard = new RegionalIntelligenceBoard();
      this.ctx.panels['regional-intelligence'] = regionalBoard;
      const el = regionalBoard.getElement();
      this.makeDraggable(el, 'regional-intelligence');
      const grid = document.getElementById('panelsGrid');
      if (grid) {
        const deductionEl = this.ctx.panels['deduction']?.getElement();
        if (deductionEl?.parentNode === grid && deductionEl.nextSibling) {
          grid.insertBefore(el, deductionEl.nextSibling);
        } else {
          grid.appendChild(el);
        }
      }
      this.applyPanelSettings();
      this.updatePanelGating(getAuthState());
    }, () => undefined);

    if (this.shouldCreatePanel('cii')) {
      const ciiPanel = new CIIPanel();
      ciiPanel.setShareStoryHandler((code, name) => {
        this.callbacks.openCountryStory(code, name);
      });
      ciiPanel.setCountryClickHandler((code) => {
        this.callbacks.openCountryBrief(code);
      });
      this.ctx.panels['cii'] = ciiPanel;
    }

    this.createPanel('cascade', () => new CascadePanel());
    this.createPanel('satellite-fires', () => new SatelliteFiresPanel());

    this.createPanel('defense-patents', () => new DefensePatentsPanel());

    // Correlation engine panels
    if (this.shouldCreatePanel('military-correlation')) {
      const p = new MilitaryCorrelationPanel();
      p.setMapNavigateHandler((lat, lon) => { this.ctx.map?.setCenter(lat, lon, 6); });
      this.ctx.panels['military-correlation'] = p;
    }
    if (this.shouldCreatePanel('escalation-correlation')) {
      const p = new EscalationCorrelationPanel();
      p.setMapNavigateHandler((lat, lon) => { this.ctx.map?.setCenter(lat, lon, 4); });
      this.ctx.panels['escalation-correlation'] = p;
    }
    if (this.shouldCreatePanel('economic-correlation')) {
      const p = new EconomicCorrelationPanel();
      p.setMapNavigateHandler((lat, lon) => { this.ctx.map?.setCenter(lat, lon, 4); });
      this.ctx.panels['economic-correlation'] = p;
    }
    if (this.shouldCreatePanel('disaster-correlation')) {
      const p = new DisasterCorrelationPanel();
      p.setMapNavigateHandler((lat, lon) => { this.ctx.map?.setCenter(lat, lon, 5); });
      this.ctx.panels['disaster-correlation'] = p;
    }

    if (this.shouldCreatePanel('strategic-risk')) {
      const strategicRiskPanel = new StrategicRiskPanel();
      strategicRiskPanel.setLocationClickHandler((lat, lon) => {
        this.ctx.map?.setCenter(lat, lon, 4);
      });
      this.ctx.panels['strategic-risk'] = strategicRiskPanel;
    }

    if (this.shouldCreatePanel('strategic-posture')) {
      const strategicPosturePanel = new StrategicPosturePanel(() => this.ctx.allNews);
      strategicPosturePanel.setLocationClickHandler((lat, lon) => {
        console.log('[App] StrategicPosture handler called:', { lat, lon, hasMap: !!this.ctx.map });
        this.ctx.map?.setCenter(lat, lon, 4);
      });
      this.ctx.panels['strategic-posture'] = strategicPosturePanel;
    }

    if (this.shouldCreatePanel('ucdp-events')) {
      const ucdpEventsPanel = new UcdpEventsPanel();
      ucdpEventsPanel.setEventClickHandler((lat, lon) => {
        this.ctx.map?.setCenter(lat, lon, 5);
      });
      this.ctx.panels['ucdp-events'] = ucdpEventsPanel;
    }

    this.createPanel('disease-outbreaks', () => new DiseaseOutbreaksPanel());
    this.createPanel('social-velocity', () => new SocialVelocityPanel());
    this.createPanel('wsb-ticker-scanner', () => new WsbTickerScannerPanel());

    this.lazyPanel('displacement', () =>
      import('@/components/DisplacementPanel').then(m => {
        const p = new m.DisplacementPanel();
        p.setCountryClickHandler((lat: number, lon: number) => { this.ctx.map?.setCenter(lat, lon, 4); });
        return p;
      }),
    );

    this.lazyPanel('climate', () =>
      import('@/components/ClimateAnomalyPanel').then(m => {
        const p = new m.ClimateAnomalyPanel();
        p.setZoneClickHandler((lat: number, lon: number) => { this.ctx.map?.setCenter(lat, lon, 4); });
        return p;
      }),
    );

    this.lazyPanel('population-exposure', () =>
      import('@/components/PopulationExposurePanel').then(m => new m.PopulationExposurePanel()),
    );

    this.lazyPanel('security-advisories', () =>
      import('@/components/SecurityAdvisoriesPanel').then(m => {
        const p = new m.SecurityAdvisoriesPanel();
        p.setRefreshHandler(() => { void this.callbacks.loadSecurityAdvisories?.(); });
        return p;
      }),
    );

    this.lazyPanel('radiation-watch', () =>
      import('@/components/RadiationWatchPanel').then(m => {
        const p = new m.RadiationWatchPanel();
        p.setLocationClickHandler((lat: number, lon: number) => { this.ctx.map?.setCenter(lat, lon, 4); });
        return p;
      }),
    );

    this.lazyPanel('thermal-escalation', () =>
      import('@/components/ThermalEscalationPanel').then(m => {
        const p = new m.ThermalEscalationPanel();
        p.setLocationClickHandler((lat: number, lon: number) => { this.ctx.map?.setCenter(lat, lon, 4); });
        return p;
      }),
    );

    const _lockPanels = this.ctx.isDesktopApp && !hasPremiumAccess();

    this.lazyPanel('daily-market-brief', () =>
      import('@/components/DailyMarketBriefPanel').then(m => new m.DailyMarketBriefPanel()),
    );

    this.lazyPanel('market-implications', () =>
      import('@/components/MarketImplicationsPanel').then(m => new m.MarketImplicationsPanel()),
    );
    // Gating for daily-market-brief, market-implications, and chat-analyst is handled
    // reactively by updatePanelGating() via auth state subscription (all in WEB_PREMIUM_PANELS).

    this.lazyPanel('chat-analyst', () =>
      import('@/components/ChatAnalystPanel').then(m => new m.ChatAnalystPanel()),
    );

    this.lazyPanel('forecast', () =>
      import('@/components/ForecastPanel').then(m => new m.ForecastPanel()),
      undefined,
      _lockPanels ? ['AI-powered geopolitical forecasts', 'Cross-domain cascade predictions', 'Prediction market calibration'] : undefined,
    );

    this.lazyPanel('oref-sirens', () =>
      import('@/components/OrefSirensPanel').then(m => new m.OrefSirensPanel()),
      undefined,
      _lockPanels ? [t('premium.features.orefSirens1'), t('premium.features.orefSirens2')] : undefined,
    );

    this.lazyPanel('telegram-intel', () =>
      import('@/components/TelegramIntelPanel').then(m => new m.TelegramIntelPanel()),
      undefined,
      _lockPanels ? [t('premium.features.telegramIntel1'), t('premium.features.telegramIntel2')] : undefined,
    );

    if (this.shouldCreatePanel('gcc-investments')) {
      const investmentsPanel = new InvestmentsPanel((inv) => {
        focusInvestmentOnMap(this.ctx.map, this.ctx.mapLayers, inv.lat, inv.lon);
      });
      this.ctx.panels['gcc-investments'] = investmentsPanel;
    }

    if (this.shouldCreatePanel('world-clock')) {
      this.ctx.panels['world-clock'] = new WorldClockPanel();
    }

    if (this.shouldCreatePanel('airline-intel')) {
      this.ctx.panels['airline-intel'] = new AirlineIntelPanel();
      this.aviationCommandBar = new AviationCommandBar();
    }

    if (this.shouldCreatePanel('gulf-economies') && !this.ctx.panels['gulf-economies']) {
      this.ctx.panels['gulf-economies'] = new GulfEconomiesPanel();
    }

    if (this.shouldCreatePanel('grocery-basket') && !this.ctx.panels['grocery-basket']) {
      this.ctx.panels['grocery-basket'] = new GroceryBasketPanel();
    }

    if (this.shouldCreatePanel('bigmac') && !this.ctx.panels['bigmac']) {
      this.ctx.panels['bigmac'] = new BigMacPanel();
    }

    if (this.shouldCreatePanel('fuel-prices') && !this.ctx.panels['fuel-prices']) {
      this.ctx.panels['fuel-prices'] = new FuelPricesPanel();
    }

    if (this.shouldCreatePanel('fao-food-price-index') && !this.ctx.panels['fao-food-price-index']) {
      this.ctx.panels['fao-food-price-index'] = new FaoFoodPriceIndexPanel();
    }

    if (this.shouldCreatePanel('climate-news') && !this.ctx.panels['climate-news']) {
      this.ctx.panels['climate-news'] = new ClimateNewsPanel();
    }

    if (this.shouldCreatePanel('live-news') &&
        (getDefaultLiveChannels().length > 0 || loadChannelsFromStorage().length > 0)) {
      this.ctx.panels['live-news'] = new LiveNewsPanel();
    }

    if (this.shouldCreatePanel('live-webcams')) {
      this.ctx.panels['live-webcams'] = new LiveWebcamsPanel();
    }

    if (this.shouldCreatePanel('windy-webcams')) {
      this.ctx.panels['windy-webcams'] = new PinnedWebcamsPanel();
    }

    this.createPanel('events', () => new TechEventsPanel('events', () => this.ctx.allNews));
    this.createPanel('internet-disruptions', () => new InternetDisruptionsPanel());
    this.createPanel('service-status', () => new ServiceStatusPanel());

    this.lazyPanel('tech-readiness', () =>
      import('@/components/TechReadinessPanel').then(m => {
        const p = new m.TechReadinessPanel();
        // Only auto-refresh on variants whose bootstrap seeds techReadiness
        // (full + tech). On commodity/finance/energy the seed key is empty
        // and the 5s fetch at services/economic/index.ts:694 just times out.
        // The panel is still created so users who opt-in via settings can
        // trigger a manual refresh from its UI.
        if (isPanelInVariantDefaults('tech-readiness')) {
          void p.refresh();
        }
        return p;
      }),
    );

    this.lazyPanel('national-debt', () =>
      import('@/components/NationalDebtPanel').then(m => {
        const p = new m.NationalDebtPanel();
        void p.refresh();
        return p;
      }),
    );

    this.lazyPanel('cross-source-signals', () =>
      import('@/components/CrossSourceSignalsPanel').then(m => new m.CrossSourceSignalsPanel()),
    );

    this.lazyPanel('geo-hubs', () =>
      import('@/components/GeoHubsPanel').then(m => {
        const p = new m.GeoHubsPanel();
        p.setOnHubClick((hub) => { this.ctx.map?.setCenter(hub.lat, hub.lon, 4); });
        return p;
      }),
    );

    this.lazyPanel('tech-hubs', () =>
      import('@/components/TechHubsPanel').then(m => {
        const p = new m.TechHubsPanel();
        p.setOnHubClick((hub) => { this.ctx.map?.setCenter(hub.lat, hub.lon, 4); });
        return p;
      }),
    );

    this.lazyPanel('ai-regulation', () =>
      import('@/components/RegulationPanel').then(m => new m.RegulationPanel('ai-regulation')),
    );

    this.createPanel('macro-signals', () => new MacroSignalsPanel());
    this.createPanel('fear-greed', () => new FearGreedPanel());
    this.createPanel('aaii-sentiment', () => new AAIISentimentPanel());
    this.createPanel('market-breadth', () => new MarketBreadthPanel());
    this.createPanel('macro-tiles', () => new MacroTilesPanel());
    this.createPanel('fsi', () => new FSIPanel());
    this.createPanel('yield-curve', () => new YieldCurvePanel());
    this.createPanel('earnings-calendar', () => new EarningsCalendarPanel());
    this.createPanel('economic-calendar', () => new EconomicCalendarPanel());
    this.createPanel('cot-positioning', () => new CotPositioningPanel());
    this.createPanel('liquidity-shifts', () => new LiquidityShiftsPanel());
    this.createPanel('positioning-247', () => new PositioningPanel());
    this.createPanel('gold-intelligence', () => new GoldIntelligencePanel());
    this.createPanel('hormuz-tracker', () => new HormuzPanel());
    this.createPanel('etf-flows', () => new ETFFlowsPanel());
    this.createPanel('stablecoins', () => new StablecoinPanel());

    if (this.ctx.isDesktopApp) {
      const runtimeConfigPanel = new RuntimeConfigPanel({ mode: 'alert' });
      this.ctx.panels['runtime-config'] = runtimeConfigPanel;
    }

    this.createPanel('insights', () => new InsightsPanel());

    // Global Giving panel (all variants)
    this.lazyPanel('giving', () =>
      import('@/components/GivingPanel').then(m => new m.GivingPanel()),
    );

    // Happy variant panels (lazy-loaded — only relevant for happy variant)
    if (SITE_VARIANT === 'happy') {
      this.lazyPanel('positive-feed', () =>
        import('@/components/PositiveNewsFeedPanel').then(m => {
          const p = new m.PositiveNewsFeedPanel();
          this.ctx.positivePanel = p;
          return p;
        }),
      );

      this.lazyPanel('counters', () =>
        import('@/components/CountersPanel').then(m => {
          const p = new m.CountersPanel();
          p.startTicking();
          this.ctx.countersPanel = p;
          return p;
        }),
      );

      this.lazyPanel('progress', () =>
        import('@/components/ProgressChartsPanel').then(m => {
          const p = new m.ProgressChartsPanel();
          this.ctx.progressPanel = p;
          return p;
        }),
      );

      this.lazyPanel('breakthroughs', () =>
        import('@/components/BreakthroughsTickerPanel').then(m => {
          const p = new m.BreakthroughsTickerPanel();
          this.ctx.breakthroughsPanel = p;
          return p;
        }),
      );

      this.lazyPanel('spotlight', () =>
        import('@/components/HeroSpotlightPanel').then(m => {
          const p = new m.HeroSpotlightPanel();
          p.onLocationRequest = (lat: number, lon: number) => {
            this.ctx.map?.setCenter(lat, lon, 4);
            this.ctx.map?.flashLocation(lat, lon, 3000);
          };
          this.ctx.heroPanel = p;
          return p;
        }),
      );

      this.lazyPanel('digest', () =>
        import('@/components/GoodThingsDigestPanel').then(m => {
          const p = new m.GoodThingsDigestPanel();
          this.ctx.digestPanel = p;
          return p;
        }),
      );

      this.lazyPanel('species', () =>
        import('@/components/SpeciesComebackPanel').then(m => {
          const p = new m.SpeciesComebackPanel();
          this.ctx.speciesPanel = p;
          return p;
        }),
      );

    }

    // Renewable Energy is shared by happy and energy variants.
    if (this.shouldCreatePanel('renewable')) {
      this.lazyPanel('renewable', () =>
        import('@/components/RenewableEnergyPanel').then(m => {
          const p = new m.RenewableEnergyPanel();
          this.ctx.renewablePanel = p;
          return p;
        }),
      );
    }

    // Always load custom widgets — Pro gating is handled reactively by auth state.
    for (const spec of loadWidgets()) {
      const panel = new CustomWidgetPanel(spec);
      this.ctx.panels[spec.id] = panel;
      if (!this.ctx.panelSettings[spec.id]) {
        this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
      }
    }

    for (const spec of loadMcpPanels()) {
      const panel = new McpDataPanel(spec);
      this.ctx.panels[spec.id] = panel;
      if (!this.ctx.panelSettings[spec.id]) {
        this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
      }
    }

    const variantOrder = (VARIANT_DEFAULTS[SITE_VARIANT] ?? VARIANT_DEFAULTS['full'] ?? []).filter(k => k !== 'map');
    const activePanelSet = new Set(Object.keys(this.ctx.panelSettings));
    const crossVariantKeys = Object.keys(this.ctx.panelSettings).filter(k => !variantOrder.includes(k) && k !== 'map');
    const defaultOrder = [...variantOrder.filter(k => activePanelSet.has(k)), ...crossVariantKeys];
    const activePanelKeys = Object.keys(this.ctx.panelSettings).filter(k => k !== 'map');
    const bottomSet = this.getSavedBottomSet();
    const savedOrder = this.getSavedPanelOrder();
    this.bottomSetMemory = bottomSet;
    const effectiveUltraWide = this.getEffectiveUltraWide();
    this.wasUltraWide = effectiveUltraWide;

    const hasSavedOrder = savedOrder.length > 0;
    let allOrder: string[];

    if (hasSavedOrder) {
      const valid = savedOrder.filter(k => activePanelKeys.includes(k));
      const missing = activePanelKeys.filter(k => !valid.includes(k));

      missing.forEach(k => {
        if (k === 'monitors') return;
        const defaultIdx = defaultOrder.indexOf(k);
        if (defaultIdx === -1) { valid.push(k); return; }
        let inserted = false;
        for (let i = defaultIdx + 1; i < defaultOrder.length; i++) {
          const afterIdx = valid.indexOf(defaultOrder[i]!);
          if (afterIdx !== -1) { valid.splice(afterIdx, 0, k); inserted = true; break; }
        }
        if (!inserted) valid.push(k);
      });

      const monitorsIdx = valid.indexOf('monitors');
      if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1);
      if (SITE_VARIANT !== 'happy') valid.push('monitors');
      allOrder = valid;
    } else {
      allOrder = [...defaultOrder];

      if (SITE_VARIANT !== 'happy') {
        const liveNewsIdx = allOrder.indexOf('live-news');
        if (liveNewsIdx > 0) {
          allOrder.splice(liveNewsIdx, 1);
          allOrder.unshift('live-news');
        }

        const webcamsIdx = allOrder.indexOf('live-webcams');
        if (webcamsIdx !== -1 && webcamsIdx !== allOrder.indexOf('live-news') + 1) {
          allOrder.splice(webcamsIdx, 1);
          const afterNews = allOrder.indexOf('live-news') + 1;
          allOrder.splice(afterNews, 0, 'live-webcams');
        }
      }

      if (this.ctx.isDesktopApp) {
        const runtimeIdx = allOrder.indexOf('runtime-config');
        if (runtimeIdx > 1) {
          allOrder.splice(runtimeIdx, 1);
          allOrder.splice(1, 0, 'runtime-config');
        } else if (runtimeIdx === -1) {
          allOrder.splice(1, 0, 'runtime-config');
        }
      }
    }

    this.resolvedPanelOrder = allOrder;

    const sidebarOrder = effectiveUltraWide
      ? allOrder.filter(k => !this.bottomSetMemory.has(k))
      : allOrder;
    const bottomOrder = effectiveUltraWide
      ? allOrder.filter(k => this.bottomSetMemory.has(k))
      : [];

    sidebarOrder.forEach((key: string) => {
      const panel = this.ctx.panels[key];
      if (panel && !panel.getElement().parentElement) {
        const el = panel.getElement();
        this.makeDraggable(el, key);
        panelsGrid.appendChild(el);
      }
    });

    // "+" Add Panel block at the end of the grid
    const addPanelBlock = document.createElement('button');
    addPanelBlock.className = 'add-panel-block';
    addPanelBlock.setAttribute('aria-label', t('components.panel.addPanel'));
    const addIcon = document.createElement('span');
    addIcon.className = 'add-panel-block-icon';
    addIcon.textContent = '+';
    const addLabel = document.createElement('span');
    addLabel.className = 'add-panel-block-label';
    addLabel.textContent = t('components.panel.addPanel');
    addPanelBlock.appendChild(addIcon);
    addPanelBlock.appendChild(addLabel);
    addPanelBlock.addEventListener('click', () => {
      this.ctx.unifiedSettings?.open('panels');
    });
    panelsGrid.appendChild(addPanelBlock);

    // Always create Pro and MCP add-panel blocks — show/hide reactively via auth state.
    const proBlock = document.createElement('button');
    proBlock.className = 'add-panel-block ai-widget-block ai-widget-block-pro';
    proBlock.setAttribute('aria-label', t('widgets.createInteractive'));
    const proIcon = document.createElement('span');
    proIcon.className = 'add-panel-block-icon';
    proIcon.textContent = '\u26a1';
    const proLabel = document.createElement('span');
    proLabel.className = 'add-panel-block-label';
    proLabel.textContent = t('widgets.createInteractive');
    const proBadge = document.createElement('span');
    proBadge.className = 'widget-pro-badge';
    proBadge.textContent = t('widgets.proBadge');
    proBlock.appendChild(proIcon);
    proBlock.appendChild(proLabel);
    proBlock.appendChild(proBadge);
    proBlock.addEventListener('click', () => {
      openWidgetChatModal({
        mode: 'create',
        tier: 'pro',
        onComplete: (spec) => this.addCustomWidget(spec),
      });
    });
    panelsGrid.appendChild(proBlock);

    const mcpBlock = document.createElement('button');
    mcpBlock.className = 'add-panel-block mcp-panel-block';
    mcpBlock.setAttribute('aria-label', t('mcp.connectPanel'));
    const mcpIcon = document.createElement('span');
    mcpIcon.className = 'add-panel-block-icon';
    mcpIcon.textContent = '\u26a1';
    const mcpLabel = document.createElement('span');
    mcpLabel.className = 'add-panel-block-label';
    mcpLabel.textContent = t('mcp.connectPanel');
    const mcpBadge = document.createElement('span');
    mcpBadge.className = 'widget-pro-badge';
    mcpBadge.textContent = t('widgets.proBadge');
    mcpBlock.appendChild(mcpIcon);
    mcpBlock.appendChild(mcpLabel);
    mcpBlock.appendChild(mcpBadge);
    mcpBlock.addEventListener('click', () => {
      openMcpConnectModal({
        onComplete: (spec) => this.addMcpPanel(spec),
      });
    });
    panelsGrid.appendChild(mcpBlock);

    // Reactively show/hide Pro-only UI blocks ("Create Interactive Widget" +
    // "Connect MCP" CTAs) based on premium access.
    //
    // hasPremiumAccess() folds in isEntitled() (Convex Dodo entitlement) per
    // panel-gating.ts:11-27 — so a paying subscriber whose Clerk publicMetadata
    // is never written by the webhook still resolves to true once the Convex
    // snapshot lands. BUT: the snapshot lands AFTER auth state stabilises, and
    // Convex updates do NOT necessarily fire a fresh subscribeAuthState event.
    // Subscribing only to subscribeAuthState meant these CTAs stayed
    // display:none for the whole page lifetime for paying users — exactly the
    // shape PR #3505 chased on the server side, repeated here on the client.
    //
    // Subscribe to BOTH auth state and entitlement changes; whichever fires
    // last (typically entitlements) is the one that flips the CTAs visible.
    // Mirrors the same dual-subscription wiring used by updatePanelGating
    // for existing panels (see lines ~259 and ~282).
    const proBlocks = [proBlock, mcpBlock];
    const applyProBlockGating = (isPro: boolean) => {
      for (const block of proBlocks) {
        block.style.display = isPro ? '' : 'none';
      }
    };
    const reapply = () => applyProBlockGating(hasPremiumAccess(getAuthState()));
    reapply();
    this.proBlockUnsubscribe = subscribeAuthState(reapply);
    this.proBlockEntitlementUnsubscribe = onEntitlementChange(reapply);

    const bottomGrid = document.getElementById('mapBottomGrid');
    if (bottomGrid) {
      bottomOrder.forEach(key => {
        const panel = this.ctx.panels[key];
        if (panel && !panel.getElement().parentElement) {
          const el = panel.getElement();
          this.makeDraggable(el, key);
          this.insertByOrder(bottomGrid, el, key);
        }
      });
    }

    window.addEventListener('resize', () => this.ensureCorrectZones());

    this.ctx.map.onTimeRangeChanged((range) => {
      this.ctx.currentTimeRange = range;
      this.applyTimeRangeFilterDebounced();
    });

    this.applyPanelSettings();
    this.applyInitialUrlState();

    // Observe each panel for viewport entry. As soon as a panel scrolls
    // within ~200px of the viewport it fires loadAllData() once
    // (debounced via rAF to coalesce above-the-fold panels that all
    // intersect on the first tick), so below-fold panels get their
    // viewport-gated data without waiting on the scroll listener.
    // Bootstrap already ran loadAllData() with forceAll=false, so this
    // is purely the lazy-scroll trigger. (#3990)
    this.observePanelsForViewport();

    if (import.meta.env.DEV) {
      const configured = new Set(Object.keys(ALL_PANELS).filter(k => k !== 'map'));
      const created = new Set(Object.keys(this.ctx.panels));
      const extra = [...created].filter(k => !configured.has(k) && k !== 'runtime-config' && !k.startsWith('cw-') && !k.startsWith('mcp-'));
      if (extra.length) console.warn('[PanelLayoutManager] Panels created but not in ALL_PANELS:', extra);
    }
  }

  private scheduleLoadAllData(): void {
    if (this.scheduledLoadAllRaf !== null) return;
    if (typeof window === 'undefined') {
      void this.callbacks.loadAllData();
      return;
    }
    this.scheduledLoadAllRaf = window.requestAnimationFrame(() => {
      this.scheduledLoadAllRaf = null;
      void this.callbacks.loadAllData();
    });
  }

  private observePanelsForViewport(): void {
    for (const panel of Object.values(this.ctx.panels)) {
      const observable = panel as { observeNearViewport?: (cb: () => void, marginPx?: number) => void };
      observable.observeNearViewport?.(() => this.scheduleLoadAllData(), 200);
    }
  }

  private applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
      const panel = this.ctx.newsPanels[category];
      if (!panel) return;
      const filtered = this.filterItemsByTimeRange(items);
      if (filtered.length === 0 && items.length > 0) {
        panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
        return;
      }
      panel.renderNews(filtered);
    });
  }

  private filterItemsByTimeRange(items: import('@/types').NewsItem[], range: import('@/components').TimeRange = this.ctx.currentTimeRange): import('@/types').NewsItem[] {
    if (range === 'all') return items;
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000, '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000, 'all': Infinity,
    };
    const cutoff = Date.now() - (ranges[range] ?? Infinity);
    return items.filter((item) => {
      // Recency gate routed through effectivePubDateMs so pubDateMissing
      // items fail the cutoff check rather than falsely claiming freshness.
      // Items with NaN/Infinity/Invalid Date pubDates are ALSO excluded
      // (the helper sanitizes them to 0); previous behavior fell through
      // to `true` on non-finite, which included corrupt-stamp items in
      // narrow time windows. Treating untrustworthy timestamps uniformly
      // is the intentional shift — see data-loader.filterItemsByTimeRange.
      return effectivePubDateMs(item) >= cutoff;
    });
  }

  private getTimeRangeLabel(): string {
    const labels: Record<string, string> = {
      '1h': 'the last hour', '6h': 'the last 6 hours',
      '24h': 'the last 24 hours', '48h': 'the last 48 hours',
      '7d': 'the last 7 days', 'all': 'all time',
    };
    return labels[this.ctx.currentTimeRange] ?? 'the last 7 days';
  }

  private applyInitialUrlState(): void {
    if (!this.ctx.initialUrlState || !this.ctx.map) return;

    const { view, zoom, lat, lon, timeRange, layers } = this.ctx.initialUrlState;

    if (view) {
      // Pass URL zoom so the preset's default zoom doesn't overwrite it.
      this.ctx.map.setView(view, zoom);
    }

    if (timeRange) {
      this.ctx.map.setTimeRange(timeRange);
    }

    if (layers) {
      let normalized = normalizeExclusiveChoropleths(layers, this.ctx.mapLayers);
      if (normalized.resilienceScore && !this.ctx.map.isDeckGLActive?.()) {
        normalized = { ...normalized, resilienceScore: false };
      }
      this.ctx.mapLayers = normalized;
      saveToStorage(STORAGE_KEYS.mapLayers, normalized);
      this.ctx.map.setLayers(normalized);
    }

    if (lat !== undefined && lon !== undefined) {
      // Always honour URL lat/lon regardless of zoom level.
      this.ctx.map.setCenter(lat, lon, zoom);
    } else if (!view && zoom !== undefined) {
      // zoom-only without a view preset: apply directly.
      this.ctx.map.setZoom(zoom);
    }

    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    const currentView = this.ctx.map.getState().view;
    if (regionSelect && currentView) {
      regionSelect.value = currentView;
    }
  }

  addCustomWidget(spec: CustomWidgetSpec): void {
    saveWidget(spec);
    const panel = new CustomWidgetPanel(spec);
    this.ctx.panels[spec.id] = panel;
    this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
    saveToStorage(STORAGE_KEYS.panels, this.ctx.panelSettings);
    const el = panel.getElement();
    this.makeDraggable(el, spec.id);
    const grid = document.getElementById('panelsGrid');
    if (grid) {
      const addBlock = grid.querySelector('.add-panel-block');
      if (addBlock) {
        grid.insertBefore(el, addBlock);
      } else {
        grid.appendChild(el);
      }
    }
    this.savePanelOrder();
    this.applyPanelSettings();
  }

  addMcpPanel(spec: McpPanelSpec): void {
    saveMcpPanel(spec);
    const panel = new McpDataPanel(spec);
    this.ctx.panels[spec.id] = panel;
    this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
    saveToStorage(STORAGE_KEYS.panels, this.ctx.panelSettings);
    const el = panel.getElement();
    this.makeDraggable(el, spec.id);
    const grid = document.getElementById('panelsGrid');
    if (grid) {
      const addBlock = grid.querySelector('.add-panel-block');
      if (addBlock) {
        grid.insertBefore(el, addBlock);
      } else {
        grid.appendChild(el);
      }
    }
    this.savePanelOrder();
    this.applyPanelSettings();
  }

  private getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v: unknown) => typeof v === 'string') as string[];
    } catch {
      return [];
    }
  }

  savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    const bottomGrid = document.getElementById('mapBottomGrid');
    if (!grid || !bottomGrid) return;

    const sidebarIds = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);

    const bottomIds = Array.from(bottomGrid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);

    const allOrder = this.buildUnifiedOrder(sidebarIds, bottomIds);
    this.resolvedPanelOrder = allOrder;
    localStorage.setItem(this.ctx.PANEL_ORDER_KEY, JSON.stringify(allOrder));
    localStorage.setItem(this.ctx.PANEL_ORDER_KEY + '-bottom-set', JSON.stringify(Array.from(this.bottomSetMemory)));
  }

  private buildUnifiedOrder(sidebarIds: string[], bottomIds: string[]): string[] {
    const presentIds = [...sidebarIds, ...bottomIds];
    const uniqueIds: string[] = [];
    const seen = new Set<string>();

    presentIds.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      uniqueIds.push(id);
    });

    const previousOrder = new Map<string, number>();
    this.resolvedPanelOrder.forEach((id, index) => {
      if (seen.has(id) && !previousOrder.has(id)) {
        previousOrder.set(id, index);
      }
    });
    uniqueIds.forEach((id, index) => {
      if (!previousOrder.has(id)) {
        previousOrder.set(id, this.resolvedPanelOrder.length + index);
      }
    });

    const edges = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    uniqueIds.forEach((id) => {
      edges.set(id, new Set());
      indegree.set(id, 0);
    });

    const addConstraints = (ids: string[]) => {
      for (let i = 1; i < ids.length; i++) {
        const prev = ids[i - 1]!;
        const next = ids[i]!;
        if (prev === next || !seen.has(prev) || !seen.has(next)) continue;
        const nextIds = edges.get(prev);
        if (!nextIds || nextIds.has(next)) continue;
        nextIds.add(next);
        indegree.set(next, (indegree.get(next) ?? 0) + 1);
      }
    };

    addConstraints(sidebarIds);
    addConstraints(bottomIds);

    const compareIds = (a: string, b: string) =>
      (previousOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (previousOrder.get(b) ?? Number.MAX_SAFE_INTEGER);

    const available = uniqueIds
      .filter((id) => (indegree.get(id) ?? 0) === 0)
      .sort(compareIds);
    const merged: string[] = [];

    while (available.length > 0) {
      const current = available.shift()!;
      merged.push(current);

      edges.get(current)?.forEach((next) => {
        const nextIndegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextIndegree);
        if (nextIndegree === 0) {
          available.push(next);
        }
      });
      available.sort(compareIds);
    }

    return merged.length === uniqueIds.length
      ? merged
      : uniqueIds.sort(compareIds);
  }

  private getSavedBottomSet(): Set<string> {
    try {
      const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY + '-bottom-set');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((v: unknown) => typeof v === 'string'));
        }
      }
    } catch { /* ignore */ }
    try {
      const legacy = localStorage.getItem(this.ctx.PANEL_ORDER_KEY + '-bottom');
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) {
          const bottomIds = parsed.filter((v: unknown) => typeof v === 'string') as string[];
          const set = new Set(bottomIds);
          // Merge old sidebar + bottom into unified PANEL_ORDER_KEY
          const sidebarOrder = this.getSavedPanelOrder();
          const seen = new Set(sidebarOrder);
          const unified = [...sidebarOrder];
          for (const id of bottomIds) {
            if (!seen.has(id)) { unified.push(id); seen.add(id); }
          }
          localStorage.setItem(this.ctx.PANEL_ORDER_KEY, JSON.stringify(unified));
          localStorage.setItem(this.ctx.PANEL_ORDER_KEY + '-bottom-set', JSON.stringify([...set]));
          localStorage.removeItem(this.ctx.PANEL_ORDER_KEY + '-bottom');
          return set;
        }
      }
    } catch { /* ignore */ }
    return new Set();
  }

  private getEffectiveUltraWide(): boolean {
    const mapSection = document.getElementById('mapSection');
    const mapEnabled = !mapSection?.classList.contains('hidden');
    const minWidth = this.ctx.isDesktopApp ? 900 : 1600;
    return window.innerWidth >= minWidth && mapEnabled;
  }

  private insertByOrder(grid: HTMLElement, el: HTMLElement, key: string): void {
    const idx = this.resolvedPanelOrder.indexOf(key);
    if (idx === -1) { grid.appendChild(el); return; }
    for (let i = idx + 1; i < this.resolvedPanelOrder.length; i++) {
      const nextKey = this.resolvedPanelOrder[i]!;
      const nextEl = grid.querySelector(`[data-panel="${CSS.escape(nextKey)}"]`);
      // `parentNode === grid` guard: querySelector returns nodes that match
      // ANY descendant, but a concurrent DOM mutation (browser extension,
      // overlapping resize event mid-iteration) can move/remove nextEl
      // between this read and the insertBefore call below — at which point
      // insertBefore throws `NotFoundError: The node before which the new
      // node is to be inserted is not a child of this node.`
      // (WORLDMONITOR-Q6). If the reference moved, fall through to the
      // appendChild path so the panel still lands in the grid.
      if (nextEl && nextEl.parentNode === grid) { grid.insertBefore(el, nextEl); return; }
    }
    grid.appendChild(el);
  }

  private wasUltraWide = false;

  public ensureCorrectZones(): void {
    const effectiveUltraWide = this.getEffectiveUltraWide();

    if (effectiveUltraWide === this.wasUltraWide) return;
    this.wasUltraWide = effectiveUltraWide;

    const grid = document.getElementById('panelsGrid');
    const bottomGrid = document.getElementById('mapBottomGrid');
    if (!grid || !bottomGrid) return;

    if (!effectiveUltraWide) {
      const panelsInBottom = Array.from(bottomGrid.querySelectorAll('.panel')) as HTMLElement[];
      panelsInBottom.forEach(panelEl => {
        const id = panelEl.dataset.panel;
        if (!id) return;
        this.insertByOrder(grid, panelEl, id);
      });
    } else {
      this.bottomSetMemory.forEach(id => {
        const el = grid.querySelector(`[data-panel="${CSS.escape(id)}"]`);
        if (el) {
          this.insertByOrder(bottomGrid, el as HTMLElement, id);
        }
      });
    }
  }

  private attachRelatedAssetHandlers(panel: NewsPanel): void {
    panel.setRelatedAssetHandlers({
      onRelatedAssetClick: (asset) => this.handleRelatedAssetClick(asset),
      onRelatedAssetsFocus: (assets) => this.ctx.map?.highlightAssets(assets),
      onRelatedAssetsClear: () => this.ctx.map?.highlightAssets(null),
    });
  }

  private handleRelatedAssetClick(asset: RelatedAsset): void {
    if (!this.ctx.map) return;

    switch (asset.type) {
      case 'pipeline':
        this.ctx.map.enableLayer('pipelines');
        this.ctx.mapLayers.pipelines = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerPipelineClick(asset.id);
        break;
      case 'cable':
        this.ctx.map.enableLayer('cables');
        this.ctx.mapLayers.cables = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerCableClick(asset.id);
        break;
      case 'datacenter':
        this.ctx.map.enableLayer('datacenters');
        this.ctx.mapLayers.datacenters = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerDatacenterClick(asset.id);
        break;
      case 'base':
        this.ctx.map.enableLayer('bases');
        this.ctx.mapLayers.bases = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerBaseClick(asset.id);
        break;
      case 'nuclear':
        this.ctx.map.enableLayer('nuclear');
        this.ctx.mapLayers.nuclear = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerNuclearClick(asset.id);
        break;
    }
  }

  private lazyPanel<T extends { getElement(): HTMLElement }>(
    key: string,
    loader: () => Promise<T>,
    setup?: (panel: T) => void,
    lockedFeatures?: string[],
  ): void {
    if (!this.shouldCreatePanel(key)) return;
    loader().then(async (panel) => {
      this.ctx.panels[key] = panel as unknown as import('@/components/Panel').Panel;
      if (lockedFeatures) {
        (panel as unknown as import('@/components/Panel').Panel).showLocked(lockedFeatures);
      } else {
        // Re-apply auth gating for panels that loaded after the initial auth state fire
        this.updatePanelGating(getAuthState());
        await replayPendingCalls(key, panel);
        if (setup) setup(panel);
      }
      const el = panel.getElement();
      this.makeDraggable(el, key);

      const bottomGrid = document.getElementById('mapBottomGrid');
      if (bottomGrid && this.getEffectiveUltraWide() && this.bottomSetMemory.has(key)) {
        this.insertByOrder(bottomGrid, el, key);
      } else {
        const grid = document.getElementById('panelsGrid');
        if (!grid) return;
        this.insertByOrder(grid, el, key);
      }

      // applyPanelSettings() already ran at startup before this lazy promise resolved.
      // If the user had this panel disabled, it must be hidden immediately after insertion
      // or it reappears until the next applyPanelSettings() call.
      const savedConfig = this.ctx.panelSettings[key];
      if (savedConfig && !savedConfig.enabled) {
        this.ctx.panels[key]?.hide();
      }
    }).catch((err) => {
      console.error(`[panel] failed to lazy-load "${key}"`, err);
    });
  }

  private makeDraggable(el: HTMLElement, key: string): void {
    type DropPosition = {
      grid: HTMLElement;
      panel: HTMLElement | null;
      insertBefore: boolean;
    };

    el.dataset.panel = key;
    let isDragging = false;
    let dragStarted = false;
    let startX = 0;
    let startY = 0;
    let rafId = 0;
    let ghostEl: HTMLElement | null = null;
    let dropIndicator: HTMLElement | null = null;
    let originalParent: HTMLElement | null = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let originalIndex = -1;
    let originalRect: DOMRect | null = null;
    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    const DRAG_THRESHOLD = 8;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (el.dataset.resizing === 'true') return;
      if (
        target.classList?.contains('panel-resize-handle') ||
        target.closest?.('.panel-resize-handle') ||
        target.classList?.contains('panel-col-resize-handle') ||
        target.closest?.('.panel-col-resize-handle')
      ) return;
      if (target.closest('button, a, input, select, textarea')) return;

      isDragging = true;
      dragStarted = false;
      startX = e.clientX;
      startY = e.clientY;
      
      // Calculate offset within the element for smooth dragging
      const rect = el.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      
      e.preventDefault();
    };

    const createGhostElement = (): HTMLElement => {
      const ghost = el.cloneNode(true) as HTMLElement;
      // Strip iframes to prevent duplicate network requests and postMessage handlers
      ghost.querySelectorAll('iframe').forEach(ifr => ifr.remove());
      ghost.classList.add('panel-drag-ghost');
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '10000';
      ghost.style.opacity = '0.8';
      ghost.style.boxShadow = '0 10px 40px rgba(0, 0, 0, 0.3)';
      ghost.style.transform = 'scale(1.02)';
      
      // Copy dimensions from original
      const rect = el.getBoundingClientRect();
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      
      document.body.appendChild(ghost);
      return ghost;
    };

    const createDropIndicator = (): HTMLElement => {
      const indicator = document.createElement('div');
      indicator.classList.add('panel-drop-indicator');
      // overlay on body so it doesn't shift grid children
      indicator.style.position = 'fixed';
      indicator.style.pointerEvents = 'none';
      indicator.style.zIndex = '9999';
      document.body.appendChild(indicator);
      return indicator;
    };

    const isWithinOriginalRect = (clientX: number, clientY: number) =>
      !!originalRect &&
      clientX >= originalRect.left &&
      clientX <= originalRect.right &&
      clientY >= originalRect.top &&
      clientY <= originalRect.bottom;

    const getAppendReference = (grid: HTMLElement): ChildNode | null => {
      if (grid.id !== 'panelsGrid') return null;
      return grid.querySelector('.add-panel-block');
    };

    const canAppendToGrid = (grid: HTMLElement, clientY: number): boolean => {
      if (grid !== originalParent) return true;
      const panelBottoms = Array.from(grid.children)
        .filter((child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child !== el &&
          child.classList.contains('panel') &&
          !child.classList.contains('hidden'),
        )
        .map((panel) => panel.getBoundingClientRect().bottom);
      if (panelBottoms.length === 0) return false;
      return clientY > Math.max(...panelBottoms);
    };

    const commitDrop = (dropPos: DropPosition, clientX: number, clientY: number): boolean => {
      const { grid, panel, insertBefore } = dropPos;

      if (panel) {
        if (panel === el || panel.parentElement !== grid) return false;

        if (insertBefore) {
          if (el.nextSibling === panel) return false;
        } else {
          if (panel.nextSibling === el) return false;
        }

        const referenceNode = insertBefore ? panel : panel.nextSibling;
        if (referenceNode && referenceNode.parentNode !== grid) return false;

        grid.insertBefore(el, referenceNode);
        return true;
      }

      if (grid === originalParent && isWithinOriginalRect(clientX, clientY)) {
        return false;
      }
      if (!canAppendToGrid(grid, clientY)) return false;

      const referenceNode = getAppendReference(grid);
      if (referenceNode && referenceNode.parentNode !== grid) return false;
      if (referenceNode === el) return false;
      if (el.parentElement === grid && el.nextSibling === referenceNode) return false;

      grid.insertBefore(el, referenceNode);
      return true;
    };

    const updateGhostPosition = (clientX: number, clientY: number) => {
      if (!ghostEl) return;
      ghostEl.style.left = (clientX - dragOffsetX) + 'px';
      ghostEl.style.top = (clientY - dragOffsetY) + 'px';
    };

    const findDropPosition = (clientX: number, clientY: number): DropPosition | null => {
      const grid = document.getElementById('panelsGrid');
      const bottomGrid = document.getElementById('mapBottomGrid');
      if (!grid || !bottomGrid) return null;

      // Temporarily hide the ghost to get accurate hit detection
      const prevPointerEvents = ghostEl?.style.pointerEvents;
      if (ghostEl) ghostEl.style.pointerEvents = 'none';
      const target = document.elementFromPoint(clientX, clientY);
      if (ghostEl && typeof prevPointerEvents === 'string') ghostEl.style.pointerEvents = prevPointerEvents;

      if (!target) return null;

      const targetGrid = (target.closest('.panels-grid') || target.closest('.map-bottom-grid')) as HTMLElement | null;
      const targetPanel = target.closest('.panel') as HTMLElement | null;

      if (!targetGrid && !targetPanel) return null;

      const currentTargetGrid = targetGrid || (targetPanel ? targetPanel.parentElement as HTMLElement : null);
      if (!currentTargetGrid || (currentTargetGrid !== grid && currentTargetGrid !== bottomGrid)) return null;
      const panel = targetPanel && targetPanel !== el ? targetPanel : null;
      let insertBefore = false;
      if (panel) {
        const panelRect = panel.getBoundingClientRect();
        insertBefore = clientY < panelRect.top + panelRect.height / 2;
      }

      return {
        grid: currentTargetGrid,
        panel,
        insertBefore,
      };
    };

    let lastTargetPanel: HTMLElement | null = null;

    const updateDropIndicator = (clientX: number, clientY: number) => {
      const dropPos = findDropPosition(clientX, clientY);
      if (!dropPos) {
        if (dropIndicator) dropIndicator.style.opacity = '0';
        if (lastTargetPanel) {
          lastTargetPanel.classList.remove('panel-drop-target');
          lastTargetPanel = null;
        }
        return;
      }

      const { grid, panel, insertBefore } = dropPos;
      if (!dropIndicator) return;

      const noOpEmptyDrop = !panel &&
        ((grid === originalParent && isWithinOriginalRect(clientX, clientY)) || !canAppendToGrid(grid, clientY));
      if (noOpEmptyDrop) {
        dropIndicator.style.opacity = '0';
        if (lastTargetPanel) {
          lastTargetPanel.classList.remove('panel-drop-target');
          lastTargetPanel = null;
        }
        return;
      }

      // highlight hovered panel
      if (panel !== lastTargetPanel) {
        if (lastTargetPanel) lastTargetPanel.classList.remove('panel-drop-target');
        if (panel) panel.classList.add('panel-drop-target');
        lastTargetPanel = panel;
      }

      // compute absolute coordinates for the indicator
      let top = 0;
      let left = 0;
      let width = 0;

      if (panel) {
        const panelRect = panel.getBoundingClientRect();
        width = panelRect.width;
        left = panelRect.left;
        top = insertBefore ? panelRect.top - 4 : panelRect.bottom;
      } else {
        // dropping into empty grid: position at grid bottom
        const gridRect = grid.getBoundingClientRect();
        width = gridRect.width;
        left = gridRect.left;
        top = gridRect.bottom;
      }

      dropIndicator.style.width = width + 'px';
      dropIndicator.style.left = left + 'px';
      dropIndicator.style.top = top + 'px';
      dropIndicator.style.opacity = '0.8';
    };

    let lastX = 0;
    let lastY = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      if (!dragStarted) {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        dragStarted = true;
        
        // Initialize drag visualization
        el.classList.add('dragging-source');
        originalParent = el.parentElement as HTMLElement;
        originalIndex = Array.from(originalParent.children).indexOf(el);
        originalRect = el.getBoundingClientRect();
        ghostEl = createGhostElement();
        dropIndicator = createDropIndicator();
        onKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            // Cancel drag and restore original position
            el.classList.remove('dragging-source');
            if (ghostEl) {
              ghostEl.style.opacity = '0';
              const g = ghostEl;
              setTimeout(() => g.remove(), 200);
              ghostEl = null;
            }
            if (dropIndicator) {
              dropIndicator.style.opacity = '0';
              const d = dropIndicator;
              setTimeout(() => d.remove(), 200);
              dropIndicator = null;
            }
            if (lastTargetPanel) {
              lastTargetPanel.classList.remove('panel-drop-target');
              lastTargetPanel = null;
            }

            if (originalParent && originalIndex >= 0) {
              const children = Array.from(originalParent.children);
              const insertBefore = children[originalIndex];
              if (insertBefore) {
                originalParent.insertBefore(el, insertBefore);
              } else {
                originalParent.appendChild(el);
              }
            }

            document.removeEventListener('keydown', onKeyDown!);
            onKeyDown = null;
            isDragging = false;
            dragStarted = false;
            originalRect = null;
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          }
        };
        document.addEventListener('keydown', onKeyDown);
      }

      lastX = e.clientX;
      lastY = e.clientY;
      const cx = e.clientX;
      const cy = e.clientY;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (dragStarted) {
          updateGhostPosition(cx, cy);
          updateDropIndicator(cx, cy);
        }
        rafId = 0;
      });
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      
      if (dragStarted) {
        // Find final drop position using most recent cursor coords
        const dropPos = findDropPosition(lastX, lastY);
        const moved = dropPos ? commitDrop(dropPos, lastX, lastY) : false;
        
        // Clean up drag visualization
        el.classList.remove('dragging-source');
        if (ghostEl) {
          ghostEl.style.opacity = '0';
          const g = ghostEl;
          setTimeout(() => g.remove(), 200);
          ghostEl = null;
        }
        if (dropIndicator) {
          dropIndicator.style.opacity = '0';
          const d = dropIndicator;
          setTimeout(() => d.remove(), 200);
          dropIndicator = null;
        }
        if (lastTargetPanel) {
          lastTargetPanel.classList.remove('panel-drop-target');
          lastTargetPanel = null;
        }
        
        if (moved) {
          const isInBottom = !!el.closest('.map-bottom-grid');
          if (isInBottom) {
            this.bottomSetMemory.add(key);
          } else {
            this.bottomSetMemory.delete(key);
          }
          this.savePanelOrder();
        }
      }
      dragStarted = false;
      originalRect = null;
      if (onKeyDown) {
        document.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
      }
    };

    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    this.panelDragCleanupHandlers.push(() => {
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (onKeyDown) {
        document.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (ghostEl) ghostEl.remove();
      if (dropIndicator) dropIndicator.remove();
      isDragging = false;
      dragStarted = false;
      originalRect = null;
      el.classList.remove('dragging-source');
    });
  }

  getLocalizedPanelName(panelKey: string, fallback: string): string {
    if (panelKey === 'runtime-config') {
      return t('modals.runtimeConfig.title');
    }
    const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
    const lookup = `panels.${key}`;
    const localized = t(lookup);
    return localized === lookup ? fallback : localized;
  }

  getAllSourceNames(): string[] {
    const sources = new Set<string>();
    // Preset feeds + sources from any custom news panels the user added, so
    // the source manager stays in sync with what loadNews() actually fetches.
    const categories = resolveNewsCategories(FEEDS, CANONICAL_FEEDS, enabledNewsCategoryKeys(this.ctx.newsPanels, this.ctx.panels, this.ctx.panelSettings));
    categories.forEach(({ feeds }) => feeds.forEach(f => sources.add(f.name)));
    INTEL_SOURCES.forEach(f => sources.add(f.name));
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }

  // ─── OSINT Tactical Workspace and Tabbed navigation ───
  private mockRepoData = [
    { id: "DOC-2026-001", name: "Suwalki Gap Tactical Troop Movements Report", zone: "Suwalki Gap", threat: "high", classification: "SECRET // NOFORN", time: "2026-06-01 10:14:02" },
    { id: "DOC-2026-002", name: "South China Sea Naval Task Force Telemetry", zone: "South China Sea", threat: "critical", classification: "TOP SECRET // SI", time: "2026-05-30 08:24:51" },
    { id: "DOC-2026-003", name: "Bab al-Mandab Strait AIS Spoofing Advisory", zone: "Bab al-Mandab Strait", threat: "medium", classification: "CONFIDENTIAL", time: "2026-05-29 16:45:10" }
  ];

  private setupTacticalWorkspace(): void {
    const container = this.ctx.container;
    const appEl = document.getElementById('app');

    // ─── Retractable Sidebar ───
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    if (sidebarToggleBtn && appEl) {
      // Set initial state from storage
      const collapsed = localStorage.getItem('wm-sidebar-collapsed') === 'true';
      if (collapsed) {
        appEl.classList.add('sidebar-collapsed');
      }

      sidebarToggleBtn.addEventListener('click', () => {
        const isCollapsed = appEl.classList.toggle('sidebar-collapsed');
        localStorage.setItem('wm-sidebar-collapsed', String(isCollapsed));
        // Force map resize
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
      });
    }

    // ─── Browser Tab Swapping ───
    const tabItems = container.querySelectorAll('.tactical-tab-bar .tab-item');
    const tabContents = container.querySelectorAll('.tactical-tab-viewport .tactical-tab-content');

    tabItems.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        if (!targetTab) return;

        tabItems.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        const targetContent = document.getElementById(`tab-${targetTab}`);
        if (targetContent) {
          targetContent.classList.add('active');
        }

        // Home tab needs map resize
        if (targetTab === 'home') {
          setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        }
      });
    });

    // ─── Gemini-Style Floating AI Chat Popup Logic ───
    const aiChatOverlay = document.getElementById('aiChatPopupOverlay') as HTMLElement | null;
    const aiChatCloseBtn = document.getElementById('aiChatPopupCloseBtn');
    const aiChatBody = document.getElementById('aiChatPopupBody');
    const aiChatWelcome = document.getElementById('aiChatWelcomeWrapper');
    const aiChatMsgList = document.getElementById('aiChatPopupMessagesList');
    const aiChatTextarea = document.getElementById('aiChatPopupTextarea') as HTMLTextAreaElement | null;
    const aiChatImportBtn = document.getElementById('aiChatPopupImportBtn');
    const aiChatModelSelect = document.getElementById('aiChatPopupModelSelect') as HTMLSelectElement | null;

    let chatHistory: Array<{ role: string; content: string }> = [];

    const toggleAiChat = () => {
      if (!aiChatOverlay) return;
      const isOpen = aiChatOverlay.classList.toggle('open');
      if (isOpen && aiChatTextarea) {
        setTimeout(() => aiChatTextarea.focus(), 100);
      }
    };

    window.addEventListener('wm:toggle-ai-chat', toggleAiChat);

    if (aiChatCloseBtn) {
      aiChatCloseBtn.addEventListener('click', toggleAiChat);
    }

    if (aiChatOverlay) {
      aiChatOverlay.addEventListener('click', (e) => {
        if (e.target === aiChatOverlay) toggleAiChat();
      });
      // Esc key to close popup
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && aiChatOverlay.classList.contains('open')) {
          toggleAiChat();
        }
      });
    }

    // Import Active Intel button logic (+)
    if (aiChatImportBtn && aiChatTextarea) {
      aiChatImportBtn.addEventListener('click', () => {
        const opName = (document.getElementById('planner-op-name') as HTMLInputElement)?.value || 'OP SENTINEL ESCORT';
        const zone = (document.getElementById('planner-op-zone') as HTMLSelectElement)?.value || 'South China Sea';
        const posture = (document.getElementById('planner-op-posture') as HTMLSelectElement)?.value || 'DEFCON 3';
        const assets = (document.getElementById('planner-op-assets') as HTMLInputElement)?.value || 'None';
        aiChatTextarea.value = `Analyzing Operational Theater: ${opName}. \nZone: ${zone}. \nAlert Status: ${posture}. \nDeployments: ${assets}. \nProvide risk assessment.`;
        aiChatTextarea.style.height = 'auto';
        aiChatTextarea.style.height = `${aiChatTextarea.scrollHeight}px`;
        aiChatTextarea.focus();
      });
    }

    const appendAiChatBubble = (role: 'user' | 'assistant', text: string) => {
      if (!aiChatMsgList || !aiChatBody) return;
      aiChatWelcome?.setAttribute('style', 'display:none !important;');
      aiChatMsgList.style.display = 'flex';

      const row = document.createElement('div');
      row.className = `ai-chat-msg-row ai-chat-msg-row--${role}`;
      row.innerHTML = `<strong>${role === 'user' ? 'ANALYST' : 'CHANAKYA TACTICAL AI'}</strong><div class="msg-content">${text}</div>`;

      if (role === 'assistant') {
        const actionBar = document.createElement('div');
        actionBar.className = 'ai-chat-action-bar';
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'ai-chat-action-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(text);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        };

        const saveBtn = document.createElement('button');
        saveBtn.className = 'ai-chat-action-btn';
        saveBtn.textContent = 'Save to Repo';
        saveBtn.onclick = async () => {
          const docId = `INTEL-${Math.floor(1000 + Math.random() * 9000)}`;
          const filename = `${docId}.txt`;
          
          try {
            saveBtn.textContent = 'Storing...';
            // Call local fs write API
            const resp = await fetch('/api/store-intel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: filename,
                type: 'text',
                data: `SECURE TACTICAL LOG // CHANAKYA AI\nLOG ID: ${docId}\nTIMESTAMP: ${new Date().toISOString()}\n\n---\n\n${text}`
              })
            });

            const resData = await resp.json();
            if (resData.success) {
              const newDoc = {
                id: docId,
                name: `AI Intel Log: ${docId}`,
                zone: "Global Threat Intel",
                threat: "medium",
                classification: "SECRET // NOFORN",
                time: new Date().toISOString().replace('T', ' ').substring(0, 19)
              };
              this.mockRepoData.unshift(newDoc);
              this.renderRepositoryTable();
              alert(`Geopolitical intelligence securely written to repository absolute path:\n${resData.path}`);
              saveBtn.textContent = 'Stored!';
            } else {
              throw new Error(resData.error || 'Server rejected');
            }
          } catch (err: any) {
            console.error('[ai-chat] Save failed:', err);
            // Fallback: browser download
            const blob = new Blob([text], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            alert(`Stored locally via browser download:\n${filename}`);
            saveBtn.textContent = 'Saved!';
          }
        };

        actionBar.appendChild(copyBtn);
        actionBar.appendChild(saveBtn);
        row.appendChild(actionBar);
      }

      aiChatMsgList.appendChild(row);
      aiChatBody.scrollTop = aiChatBody.scrollHeight;
    };

    const handleAiChatSubmit = async () => {
      if (!aiChatTextarea) return;
      const text = aiChatTextarea.value.trim();
      if (!text) return;

      appendAiChatBubble('user', text);
      aiChatTextarea.value = '';
      aiChatTextarea.style.height = 'auto';

      appendAiChatBubble('assistant', 'Secure tunnel active... Analyzing Geopolitical context telemetries...');
      const assistantRows = aiChatMsgList?.querySelectorAll('.ai-chat-msg-row--assistant');
      const latestAssistantRow = assistantRows?.[assistantRows.length - 1];
      const contentEl = latestAssistantRow?.querySelector('.msg-content');

      chatHistory.push({ role: 'user', content: text });

      try {
        const response = await fetch('/api/chat-analyst', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: text,
            history: chatHistory.slice(-10),
            model: aiChatModelSelect?.value || 'flash'
          })
        });

        if (!response.ok || !response.body) {
          throw new Error('Streaming connection failed');
        }

        if (contentEl) contentEl.textContent = '';
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let accumulatedText = "";

        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          const chunkValue = decoder.decode(value);
          const lines = chunkValue.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim();
              if (payload === '[DONE]') {
                done = true;
                break;
              }
              try {
                const parsed = JSON.parse(payload);
                if (parsed.delta) {
                  accumulatedText += parsed.delta;
                  if (contentEl) {
                    contentEl.textContent = accumulatedText;
                    if (aiChatBody) aiChatBody.scrollTop = aiChatBody.scrollHeight;
                  }
                }
              } catch { }
            }
          }
        }
        chatHistory.push({ role: 'assistant', content: accumulatedText });

      } catch (error) {
        // High quality tactical fallback streaming simulator if SSE fails (offline / local dev / credentials missing)
        let fallbackText = `TACTICAL THREAT LEVEL SUMMARY RESOLVED:
1. Geopolitical intelligence feeds indicate escalating maneuvers around primary maritime chokepoints.
2. Direct Action Plan: Synchronize carrier strike teams and execute persistent radar scouting sweeps.
3. Ideate Strategy: Establish secure communication lines and mobilize nearby defense clusters to deter forward posture expansion.`;
        
        if (text.toLowerCase().includes('south china sea')) {
          fallbackText = `REGIONAL THREAT TELEMETRY REPORT: SOUTH CHINA SEA (ZONE-1)
1. Shandong Carrier task group monitored east of Hainan; US carrier strike group Reagan conducts tactical patrolling maneuvers.
2. Recommended Posture: DEFCON 2 high mobility. Increase surveillance drone flight frequencies to establish complete spatial mapping.`;
        } else if (text.toLowerCase().includes('bab al-mandab') || text.toLowerCase().includes('strait')) {
          fallbackText = `REGIONAL THREAT TELEMETRY REPORT: BAB AL-MANDAB STRAIT (ZONE-2)
1. Active AIS transponder spoofing anomalous telemetry detected. Commercial vessels warned of asymmetric surface threats.
2. Mitigation Protocol: Escort strike assets deployed, increase surveillance and enforce strict defense perimeters.`;
        }

        if (contentEl) contentEl.textContent = '';
        let index = 0;
        const interval = setInterval(() => {
          if (index < fallbackText.length) {
            if (contentEl) {
              contentEl.textContent += fallbackText[index];
              if (aiChatBody) aiChatBody.scrollTop = aiChatBody.scrollHeight;
            }
            index++;
          } else {
            clearInterval(interval);
            chatHistory.push({ role: 'assistant', content: fallbackText });
          }
        }, 15);
      }
    };

    if (aiChatTextarea) {
      aiChatTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleAiChatSubmit();
        }
      });
      // Auto-resize textarea
      aiChatTextarea.addEventListener('input', () => {
        aiChatTextarea.style.height = 'auto';
        aiChatTextarea.style.height = `${aiChatTextarea.scrollHeight}px`;
      });
    }


    // ─── D3 Interactive Graph Sandbox Engine ───
    interface SandboxNode extends d3.SimulationNodeDatum {
      id: string;
      label: string;
      type: string;
      definition: string;
    }

    interface SandboxLink extends d3.SimulationLinkDatum<SandboxNode> {
      label: string;
    }

    let nodes: SandboxNode[] = [];
    let links: SandboxLink[] = [];
    let selectedNodes = new Set<string>();
    let sandboxMode: 'drag' | 'lasso' | 'connect' = 'drag';
    let connectSourceNode: SandboxNode | null = null;

    const svg = d3.select<SVGSVGElement, unknown>('#sandbox-svg');
    const plannerSaveBtn = document.getElementById('planner-save-btn') as HTMLButtonElement | null;
    const width = 600;
    const height = 400;

    // Outer group to host zoom/pan changes
    const g = svg.append('g').attr('class', 'sandbox-main-group');

    // Create D3 Force directed simulation
    const simulation = d3.forceSimulation<SandboxNode>()
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(28))
      .force('link', d3.forceLink<SandboxNode, SandboxLink>().id(d => d.id).distance(80));

    // Handle standard D3 Zoom/Pan
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        if (sandboxMode === 'drag' || sandboxMode === 'connect') {
          g.attr('transform', event.transform);
        }
      });

    svg.call(zoomBehavior);

    // Initial default Nodes Setup matching the target selected Zone
    const initSandboxData = () => {
      const opName = (document.getElementById('planner-op-name') as HTMLInputElement)?.value || 'OP SENTINEL ESCORT';
      const zone = (document.getElementById('planner-op-zone') as HTMLSelectElement)?.value || 'South China Sea';
      
      nodes = [
        { id: 'root', label: opName, type: 'Location', definition: `Geopolitical operation target: ${zone}` },
        { id: 'zone-1', label: `${zone} Base`, type: 'Place', definition: `Strategic theater baseline center for ${opName}` },
        { id: 'asset-1', label: 'USS Ronald Reagan', type: 'People', definition: 'US Carrier Strike Group deployed to secure spatial corridor.' },
        { id: 'intel-1', label: 'Swarm Radar Anomaly', type: 'Intel', definition: 'Multiple radar traces tracked conducting persistent surveillance.' }
      ];

      links = [
        { source: 'root', target: 'zone-1', label: 'coordinates' },
        { source: 'zone-1', target: 'asset-1', label: 'deploys' },
        { source: 'asset-1', target: 'intel-1', label: 'intercepts' }
      ];

      selectedNodes.clear();
      updateLegendCount();
      updateSandboxGraph();
    };

    const updateLegendCount = () => {
      const counts = { Intel: 0, Place: 0, People: 0, Location: 0, News: 0, Feed: 0 };
      nodes.forEach(n => {
        const t = n.type as keyof typeof counts;
        if (counts[t] !== undefined) {
          counts[t]++;
        }
      });
      (Object.keys(counts) as Array<keyof typeof counts>).forEach(type => {
        const el = document.getElementById(`legend-${type.toLowerCase()}`);
        const countVal = counts[type];
        if (el && typeof countVal === 'number') {
          el.textContent = `${type}: ${countVal}`;
        }
      });
    };

    const getNodeColor = (type: string) => {
      switch (type) {
        case 'Intel': return '#f59e0b';
        case 'Place': return '#a855f7';
        case 'People': return '#f97316';
        case 'Location': return '#3b82f6';
        case 'News': return '#ef4444';
        case 'Feed': return '#10b981';
        default: return '#94a3b8';
      }
    };

    const dragNode = (sim: d3.Simulation<SandboxNode, undefined>) => {
      function dragstarted(event: any, d: SandboxNode) {
        if (sandboxMode !== 'drag') return;
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      function dragged(event: any, d: SandboxNode) {
        if (sandboxMode !== 'drag') return;
        d.fx = event.x;
        d.fy = event.y;
      }
      function dragended(event: any, d: SandboxNode) {
        if (sandboxMode !== 'drag') return;
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }
      return d3.drag<any, SandboxNode>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended);
    };

    const updateSandboxGraph = () => {
      // Clear outer elements
      g.selectAll('*').remove();

      // Render Directed Edges
      const linkElements = g.selectAll('.link-line')
        .data(links)
        .enter()
        .append('line')
        .attr('class', 'link-line');

      const linkLabelElements = g.selectAll('.link-label')
        .data(links)
        .enter()
        .append('text')
        .attr('class', 'link-label')
        .text(d => d.label);

      // Render Nodes group
      const nodeElements = g.selectAll('.node-group')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', 'node-group')
        .style('cursor', sandboxMode === 'connect' ? 'cell' : 'pointer')
        .call(dragNode(simulation) as any);

      // Node circles
      nodeElements.append('circle')
        .attr('class', 'node-circle')
        .attr('r', 8)
        .attr('fill', d => getNodeColor(d.type))
        .attr('stroke', '#0d0f14')
        .attr('stroke-width', 1.5)
        .classed('selected', d => selectedNodes.has(d.id));

      // Node text labels
      nodeElements.append('text')
        .attr('class', 'node-label')
        .attr('y', -14)
        .text(d => d.label);

      // Node Interaction click
      nodeElements.on('click', (event, d) => {
        event.stopPropagation();
        if (sandboxMode === 'connect') {
          if (!connectSourceNode) {
            connectSourceNode = d;
            showToast(`Connected node parent selected: ${d.label}. Click child node to link them!`);
          } else {
            if (connectSourceNode.id !== d.id) {
              const linkLabel = prompt('Enter Relationship Verb (e.g. monitors, deploys, tracks):', 'links') || 'links';
              links.push({ source: connectSourceNode.id, target: d.id, label: linkLabel });
              connectSourceNode = null;
              updateSandboxGraph();
            }
          }
          return;
        }

        // Toggle selected state
        if (selectedNodes.has(d.id)) {
          selectedNodes.delete(d.id);
        } else {
          selectedNodes.add(d.id);
        }
        
        // Render Inspector or summary details in outline preview
        const infoHtml = `SECURE PLANNER NODE INSPECTOR // CLASSIFICATION: CONFIDENTIAL
-----------------------------------------------------------
NODE CODENAME   : ${d.label.toUpperCase()}
NODE CATEGORY   : ${d.type.toUpperCase()}
INTELLIGENCE    : ${d.definition}
ID / Telemetry  : ${d.id}

CONNECTED LINKS:
${links.filter(l => {
  const sId = typeof l.source === 'object' ? l.source.id : l.source;
  const tId = typeof l.target === 'object' ? l.target.id : l.target;
  return sId === d.id || tId === d.id;
}).map(l => {
  const sLabel = typeof l.source === 'object' ? l.source.label : nodes.find(n => n.id === l.source)?.label || l.source;
  const tLabel = typeof l.target === 'object' ? l.target.label : nodes.find(n => n.id === l.target)?.label || l.target;
  return `  - ${sLabel} --(${l.label})--> ${tLabel}`;
}).join('\n')}`;
        
        const preview = document.getElementById('planner-output');
        if (preview) {
          setTrustedHtml(preview, trustedHtml(infoHtml, "legacy direct innerHTML migration"));
        }

        updateSandboxGraph();
        updateSelectionBubble();
      });

      // Update force simulation data
      simulation.nodes(nodes);
      const linkForce = simulation.force('link') as d3.ForceLink<SandboxNode, SandboxLink>;
      if (linkForce) linkForce.links(links);

      simulation.alpha(1).restart();

      // Hook up D3 Tick loop to update coordinate positioning
      simulation.on('tick', () => {
        linkElements
          .attr('x1', d => (d.source as SandboxNode).x ?? 0)
          .attr('y1', d => (d.source as SandboxNode).y ?? 0)
          .attr('x2', d => (d.target as SandboxNode).x ?? 0)
          .attr('y2', d => (d.target as SandboxNode).y ?? 0);

        linkLabelElements
          .attr('x', d => (((d.source as SandboxNode).x ?? 0) + ((d.target as SandboxNode).x ?? 0)) / 2)
          .attr('y', d => (((d.source as SandboxNode).y ?? 0) + ((d.target as SandboxNode).y ?? 0)) / 2 - 4);

        nodeElements.attr('transform', d => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
      });
    };

    const updateSelectionBubble = () => {
      const countEl = document.getElementById('selected-nodes-count');
      const bubble = document.getElementById('sandbox-selection-info');
      if (countEl && bubble) {
        countEl.textContent = String(selectedNodes.size);
        bubble.style.display = selectedNodes.size > 0 ? 'block' : 'none';
      }
    };

    // Mode Selector listeners
    document.getElementById('sandbox-tool-drag')?.addEventListener('click', (e) => {
      sandboxMode = 'drag';
      connectSourceNode = null;
      document.querySelectorAll('.sandbox-ctrl-btn').forEach(b => b.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
      document.getElementById('plannerSandboxCol')?.setAttribute('class', 'tactical-card planner-sandbox-col');
      updateSandboxGraph();
    });

    document.getElementById('sandbox-tool-lasso')?.addEventListener('click', (e) => {
      sandboxMode = 'lasso';
      connectSourceNode = null;
      document.querySelectorAll('.sandbox-ctrl-btn').forEach(b => b.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
      document.getElementById('plannerSandboxCol')?.setAttribute('class', 'tactical-card planner-sandbox-col lasso-cursor');
      updateSandboxGraph();
    });

    document.getElementById('sandbox-tool-connect')?.addEventListener('click', (e) => {
      sandboxMode = 'connect';
      connectSourceNode = null;
      document.querySelectorAll('.sandbox-ctrl-btn').forEach(b => b.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
      document.getElementById('plannerSandboxCol')?.setAttribute('class', 'tactical-card planner-sandbox-col connect-cursor');
      updateSandboxGraph();
    });

    document.getElementById('sandbox-tool-reset')?.addEventListener('click', () => {
      svg.transition().duration(750).call(zoomBehavior.transform, d3.zoomIdentity);
    });

    // Manual Node Creator binding
    document.getElementById('sandbox-add-node-btn')?.addEventListener('click', () => {
      const labelInput = document.getElementById('sandbox-new-node-label') as HTMLInputElement | null;
      const typeSelect = document.getElementById('sandbox-new-node-type') as HTMLSelectElement | null;
      const defInput = document.getElementById('sandbox-new-node-def') as HTMLInputElement | null;

      if (!labelInput || !typeSelect || !defInput) return;
      const label = labelInput.value.trim();
      const type = typeSelect.value;
      const definition = defInput.value.trim() || 'Custom created intelligence element.';

      if (!label) {
        showToast('Node Title is required.');
        return;
      }

      const newId = `node-${Math.floor(1000 + Math.random() * 9000)}`;
      nodes.push({ id: newId, label, type, definition });

      // If there is an active selected node, connect them automatically!
      if (selectedNodes.size === 1) {
        const parentId = Array.from(selectedNodes)[0];
        if (parentId) {
          links.push({ source: parentId, target: newId, label: 'relates' });
        }
      } else if (nodes.length > 1) {
        // Link to root by default
        links.push({ source: 'root', target: newId, label: 'tracks' });
      }

      labelInput.value = '';
      defInput.value = '';

      updateLegendCount();
      updateSandboxGraph();
    });

    // Drag Lasso Selection Box Logic (Canvas Drag Box)
    let lassoStartPos = { x: 0, y: 0 };
    let isDrawingLasso = false;
    let lassoRect: any = null;

    svg.on('mousedown', (event) => {
      if (sandboxMode !== 'lasso') return;
      event.preventDefault();
      
      const coords = d3.pointer(event, svg.node());
      lassoStartPos = { x: coords[0], y: coords[1] };
      isDrawingLasso = true;
      selectedNodes.clear();

      lassoRect = svg.append('rect')
        .attr('class', 'lasso-box')
        .attr('x', lassoStartPos.x)
        .attr('y', lassoStartPos.y)
        .attr('width', 0)
        .attr('height', 0);
    });

    svg.on('mousemove', (event) => {
      if (!isDrawingLasso || !lassoRect) return;
      const coords = d3.pointer(event, svg.node());
      const currentPos = { x: coords[0], y: coords[1] };

      const x = Math.min(lassoStartPos.x, currentPos.x);
      const y = Math.min(lassoStartPos.y, currentPos.y);
      const w = Math.abs(lassoStartPos.x - currentPos.x);
      const h = Math.abs(lassoStartPos.y - currentPos.y);

      lassoRect
        .attr('x', x)
        .attr('y', y)
        .attr('width', w)
        .attr('height', h);

      // Walk through D3 nodes and highlight those within the box
      // In D3 force simulations, nodes has .x and .y containing D3 simulation coordinates.
      // Since SVG itself is zoomed, we do a basic spatial query.
      nodes.forEach(d => {
        const nodeX = d.x ?? 0;
        const nodeY = d.y ?? 0;
        if (nodeX >= x && nodeX <= x + w && nodeY >= y && nodeY <= y + h) {
          selectedNodes.add(d.id);
        } else {
          selectedNodes.delete(d.id);
        }
      });

      updateSelectionBubble();
      // Temporarily highlight nodes on SVG without D3 tick
      svg.selectAll('.node-circle').classed('selected', (d: any) => selectedNodes.has(d.id));
    });

    svg.on('mouseup', () => {
      if (!isDrawingLasso) return;
      isDrawingLasso = false;
      if (lassoRect) {
        lassoRect.remove();
        lassoRect = null;
      }
      updateSandboxGraph();
    });


    // ─── Ctrl+X AI Node Extension (Backwards Graph Context Crawler) ───
    const crawlGraphPath = (tailId: string): string => {
      const pathNodes: SandboxNode[] = [];
      let currentId = tailId;
      const visited = new Set<string>();

      // Walk backwards by looking at incoming links: parent --(label)--> child
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const node = nodes.find(n => n.id === currentId);
        if (node) pathNodes.unshift(node);

        const incomingEdge = links.find(l => {
          const tId = typeof l.target === 'object' ? l.target.id : l.target;
          return tId === currentId;
        });

        if (incomingEdge) {
          const src = incomingEdge.source;
          currentId = typeof src === 'object' ? src.id : String(src);
        } else {
          break;
        }
      }

      return pathNodes.map(n => `[${n.type}] ${n.label} (${n.definition})`).join(' -> ');
    };

    window.addEventListener('keydown', async (e) => {
      // ─── Ctrl+X: Add AI Nodes via Groq ───
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;

        if (selectedNodes.size !== 1) {
          showToast('Select exactly one node to extend via Groq AI.');
          return;
        }

        e.preventDefault();
        const clickedNodeId = Array.from(selectedNodes)[0];
        if (!clickedNodeId) return;
        const clickedNode = nodes.find(n => n.id === clickedNodeId);
        if (!clickedNode) return;

        const userComment = prompt(`Tactical extension on node "${clickedNode.label}".\n\nEnter Analyst Comment / Mission Directive:`, 'Analyze threat anomalies and suggest next targets');
        if (!userComment) return;

        const pathContext = crawlGraphPath(clickedNodeId);
        const preview = document.getElementById('planner-output');
        if (preview) preview.textContent = 'CONNECTING TO GROQ TACTICAL AI... RETRIEVING JSON SCHEMAS...';

        try {
          const resp = await fetch('/api/sandbox-groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'generate',
              context: pathContext,
              userComment,
              type: clickedNode.type,
              clickedNodeId,
              existingNodes: nodes.map(n => ({ id: n.id, label: n.label, type: n.type }))
            })
          });

          const data = await resp.json();
          if (data.success && data.graph) {
            const newNodes: SandboxNode[] = data.graph.nodes || [];
            const newEdges: SandboxLink[] = data.graph.edges || [];

            newNodes.forEach(n => {
              if (!nodes.some(existing => existing.id === n.id)) {
                nodes.push(n);
              }
            });

            newEdges.forEach(l => {
              links.push({
                source: typeof l.source === 'object' ? (l.source as any).id : l.source,
                target: typeof l.target === 'object' ? (l.target as any).id : l.target,
                label: l.label
              });
            });

            updateLegendCount();
            updateSandboxGraph();
            showToast(`Groq AI expanded the map with ${newNodes.length} new threat nodes!`);
            
            if (preview) {
              const formattedList = newNodes.map(n => `<h3>[${n.type.toUpperCase()}] ${n.label}</h3><p>${n.definition}</p><hr>`).join('');
              setTrustedHtml(preview, trustedHtml(`<h3>SECURE INTEL EXTENSION COMPLETED</h3>${formattedList}`, "legacy direct innerHTML migration"));
            }
          } else {
            throw new Error(data.error || 'Server error');
          }
        } catch (err: any) {
          console.error('[sandbox-ai-gen] Failed:', err);
          
          // High-grade offline simulation fallback if endpoint is offline -- highly dynamic & logical!
          const zone = (document.getElementById('planner-op-zone') as HTMLSelectElement)?.value || 'South China Sea';
          
          const labelPrefixes = {
            Intel: ['Target Track', 'Telemetry Scan', 'Frequency Spoof', 'Deception Signal', 'Sonar Ping'],
            Place: ['Naval Corridor', 'Scouting Zone', 'Strategic Anchorage', 'Border Checkpoint', 'Supply Hub'],
            People: ['Surveillance Division', 'Task Force Commander', 'Adversary Air Group', 'Undersea Command', 'Scout Team'],
            Location: ['Theater Sector B-2', 'Chokepoint Channel', 'Anchorage Sector', 'Buffer Line', 'Grid-X4'],
            News: ['Breaking Brief', 'Tactical Dispatch', 'Intel Flash', 'OSINT Alert', 'Local Wire'],
            Feed: ['Sat Tracker', 'AIS Log Delta', 'Flight Path Trace', 'UAV Live Feed', 'Sonar Array']
          };

          const getRandomElement = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)] || '';
          const targetType = getRandomElement(['Intel', 'Place', 'People', 'Location', 'News', 'Feed']) as 'Intel' | 'Place' | 'People' | 'Location' | 'News' | 'Feed';
          const prefixArr = labelPrefixes[targetType] || ['Track'];
          const dynamicLabel = `${getRandomElement(prefixArr)} - ${clickedNode.label.substring(0, 14)}`;
          const dynamicDef = `Secondary tactical coordination link triggered under "${userComment || 'routine surveillance'}". Located near the ${zone} operational perimeter.`;

          const mockId = `node-${Math.floor(1000 + Math.random() * 9000)}-ext`;
          const newMockNode: SandboxNode = {
            id: mockId,
            label: dynamicLabel,
            type: targetType,
            definition: dynamicDef
          };

          nodes.push(newMockNode);
          links.push({ source: clickedNodeId, target: mockId, label: 'extends' });

          updateLegendCount();
          updateSandboxGraph();
          showToast('[Offline Mode] Spawned dynamic context coordination node.');
          
          if (preview) {
            setTrustedHtml(preview, trustedHtml(`<h3>SECURE INTEL EXTENSION COMPLETED (OFFLINE SIMULATION)</h3>
              <p>Based on crawls, added next threat step:</p>
              <h3>[${newMockNode.type.toUpperCase()}] ${newMockNode.label}</h3>
              <p>${newMockNode.definition}</p>`, "legacy direct innerHTML migration"));
          }
        }
      }

      // ─── Ctrl+Y: Summarize Selected Geopolitical Events ───
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;

        if (selectedNodes.size === 0) {
          showToast('Select a cluster of nodes using Lasso Mode (+) or click to summarize.');
          return;
        }

        e.preventDefault();
        const selectedList = nodes.filter(n => selectedNodes.has(n.id));
        const preview = document.getElementById('planner-output');
        if (preview) preview.textContent = 'COMPILING SELECTED GEO-TELEMETRY NODES... CALCULATING COURSES OF ACTION...';

        try {
          const resp = await fetch('/api/sandbox-groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'summarize',
              nodes: selectedList
            })
          });

          const data = await resp.json();
          if (data.success && data.report) {
            if (preview) {
              setTrustedHtml(preview, trustedHtml(data.report, "legacy direct innerHTML migration"));
            }
            if (plannerSaveBtn) {
              plannerSaveBtn.removeAttribute('disabled');
              plannerSaveBtn.onclick = () => {
                const briefId = `COA-${Math.floor(1000 + Math.random() * 9000)}`;
                const newDoc = {
                  id: briefId,
                  name: `AI Threat Summary & COA: ${briefId}`,
                  zone: selectedList.find(n => n.type === 'Location')?.label || "Tactical Sandboxed Theater",
                  threat: selectedList.some(n => n.definition.toLowerCase().includes('escalat') || n.definition.toLowerCase().includes('alert')) ? 'high' : 'medium',
                  classification: 'SECRET // NOFORN',
                  time: new Date().toISOString().replace('T', ' ').substring(0, 19)
                };
                this.mockRepoData.unshift(newDoc);
                this.renderRepositoryTable();
                alert(`Tactical Threat COA report ${briefId} successfully saved to secure vault!`);
                const repoTab = container.querySelector('.tab-item[data-tab="repository"]') as HTMLElement | null;
                repoTab?.click();
              };
            }
          } else {
            throw new Error(data.error || 'Server error');
          }
        } catch (err: any) {
          console.error('[sandbox-ai-summary] Failed:', err);
          // High-grade offline simulation fallback if endpoint is offline
          const fallbackReport = `### SECURE GEOPOLITICAL ASSESSMENT // OFF-TUNNEL COA
-----------------------------------------------------------
**1. EVENT SUMMARY**
Aggregated telemetry data resolved across ${selectedList.length} monitored nodes. High warning postures detected around deployed fleet strike carrier groups.

**2. REGIONAL THREAT & POSTURING ANALYSIS**
*   **Active Hostilities**: Multi-sector radar sweeps confirm persistent UAV tracking.
*   **Infrastructure Risks**: Intercept routes align with maritime commercial corridors.

**3. PROPOSED COURSES OF ACTION (COA)**
*   **COA-1 (Defense Escalation)**: Transition to DEFCON 1 posture and deploy special operations units to secure Babb al-Mandab/South China Sea.
*   **COA-2 (Information War)**: Spoof transponder frequencies to mask asset vectors and mobilize cyber deterrence shields immediately.`;

          if (preview) {
            setTrustedHtml(preview, trustedHtml(fallbackReport, "legacy direct innerHTML migration"));
          }
          if (plannerSaveBtn) {
            plannerSaveBtn.removeAttribute('disabled');
            plannerSaveBtn.onclick = () => {
              const briefId = `COA-${Math.floor(1000 + Math.random() * 9000)}`;
              const newDoc = {
                id: briefId,
                name: `AI Threat Summary & COA: ${briefId}`,
                zone: selectedList.find(n => n.type === 'Location')?.label || "Tactical Sandboxed Theater",
                threat: 'medium',
                classification: 'SECRET // NOFORN',
                time: new Date().toISOString().replace('T', ' ').substring(0, 19)
              };
              this.mockRepoData.unshift(newDoc);
              this.renderRepositoryTable();
              alert(`Tactical Threat COA report ${briefId} successfully saved to secure vault!`);
              const repoTab = container.querySelector('.tab-item[data-tab="repository"]') as HTMLElement | null;
              repoTab?.click();
            };
          }
        }
      }
    });

    // Wire up planner-generate-btn to generate a crisp strategic tactical plan
    const plannerGenBtn = document.getElementById('planner-generate-btn');
    if (plannerGenBtn) {
      plannerGenBtn.addEventListener('click', () => {
        const opName = (document.getElementById('planner-op-name') as HTMLInputElement)?.value || 'OP SENTINEL ESCORT';
        const zone = (document.getElementById('planner-op-zone') as HTMLSelectElement)?.value || 'South China Sea';
        const posture = (document.getElementById('planner-op-posture') as HTMLSelectElement)?.value || 'DEFCON 3';
        const assets = (document.getElementById('planner-op-assets') as HTMLInputElement)?.value || 'None';
        const notes = (document.getElementById('planner-op-notes') as HTMLTextAreaElement)?.value || 'None';

        const baseReport = `### SECURE OPERATIONAL BRIEFING: ${opName.toUpperCase()}
-----------------------------------------------------------
**1. THEATER TARGET ZONE**
- Primary Sector: ${zone}
- Alert posture Status: ${posture}

**2. DEPLOYED DEFENSE CORRIDOR**
- Active assets: ${assets}

**3. STRATEGIC CONTEXT & OBJECTIVES**
${notes || 'No objectives specified.'}

**4. GEO-INTELLIGENCE SUMMARY**
Initial tactical blueprint established. Direct tactical forces to maintain communication buffers and log incident telemetries.`;
        
        const preview = document.getElementById('planner-output');
        if (preview) {
          setTrustedHtml(preview, trustedHtml(baseReport, "legacy direct innerHTML migration"));
        }
        if (plannerSaveBtn) {
          plannerSaveBtn.removeAttribute('disabled');
          plannerSaveBtn.onclick = () => {
            const briefId = `OP-${Math.floor(1000 + Math.random() * 9000)}`;
            const newDoc = {
              id: briefId,
              name: `Tactical Plan: ${opName}`,
              zone: zone,
              threat: posture.includes('DEFCON 1') ? 'high' : posture.includes('DEFCON 2') ? 'high' : 'medium',
              classification: 'SECRET // NOFORN',
              time: new Date().toISOString().replace('T', ' ').substring(0, 19)
            };
            this.mockRepoData.unshift(newDoc);
            this.renderRepositoryTable();
            alert(`Tactical Plan ${briefId} successfully saved to secure vault!`);
            const repoTab = container.querySelector('.tab-item[data-tab="repository"]') as HTMLElement | null;
            repoTab?.click();
          };
        }
      });
    }

    // Populate initial Nodes & Edges Setup
    initSandboxData();

    // Trigger update when parameters are modified
    document.getElementById('planner-op-name')?.addEventListener('change', initSandboxData);
    document.getElementById('planner-op-zone')?.addEventListener('change', initSandboxData);

    // ─── Draggable and Minimizable Widgets Controller ───
    const makePopupDraggableAndMinimizable = (popupId: string) => {
      const popup = document.getElementById(popupId);
      if (!popup) return;
      const header = popup.querySelector('.tactical-card-title') as HTMLElement | null;
      const minBtn = popup.querySelector('.popup-minimize-btn') as HTMLButtonElement | null;
      const body = popup.querySelector('.tactical-card-body') as HTMLElement | null;

      if (header) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        header.onmousedown = (e: MouseEvent) => {
          if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
          e.preventDefault();
          pos3 = e.clientX;
          pos4 = e.clientY;
          
          document.onmouseup = () => {
            document.onmouseup = null;
            document.onmousemove = null;
          };
          
          document.onmousemove = (ev: MouseEvent) => {
            ev.preventDefault();
            pos1 = pos3 - ev.clientX;
            pos2 = pos4 - ev.clientY;
            pos3 = ev.clientX;
            pos4 = ev.clientY;
            
            const newTop = popup.offsetTop - pos2;
            const newLeft = popup.offsetLeft - pos1;
            
            popup.style.top = `${newTop}px`;
            popup.style.left = `${newLeft}px`;
            popup.style.bottom = 'auto';
            popup.style.right = 'auto';
          };
        };
      }

      if (minBtn && body) {
        minBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isCollapsed = body.style.display === 'none';
          if (isCollapsed) {
            body.style.setProperty('display', 'flex', 'important');
            minBtn.textContent = '−';
          } else {
            body.style.setProperty('display', 'none', 'important');
            minBtn.textContent = '＋';
          }
        });
      }
    };

    makePopupDraggableAndMinimizable('popup-op-controls');
    makePopupDraggableAndMinimizable('popup-node-mgmt');
    makePopupDraggableAndMinimizable('popup-intel-briefing');

    // ─── File & Edit Menu Actions Wiring ───
    
    // New Sandbox Blueprint
    document.getElementById('menu-file-new')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to clear the active sandbox and create a new blueprint?')) {
        initSandboxData();
        const fileLabel = document.getElementById('sandbox-current-file-label');
        if (fileLabel) fileLabel.textContent = 'Active: unsaved_blueprint.json';
        localStorage.removeItem('wm-active-sandbox-name');
        showToast('New sandbox blueprint initialized.');
      }
    });

    // Save Sandbox Blueprint
    document.getElementById('menu-file-save')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const opName = (document.getElementById('planner-op-name') as HTMLInputElement)?.value || 'OP SENTINEL ESCORT';
      const zone = (document.getElementById('planner-op-zone') as HTMLSelectElement)?.value || 'South China Sea';
      const cleanOpName = opName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const defaultFilename = `sandbox_${cleanOpName}.json`;
      
      const filename = prompt('Enter a secure blueprint filename to save:', defaultFilename);
      if (!filename) return;

      const fileLabel = document.getElementById('sandbox-current-file-label');
      const secureFilename = filename.endsWith('.json') ? filename : `${filename}.json`;

      const graphPayload = {
        opName,
        zone,
        posture: (document.getElementById('planner-op-posture') as HTMLSelectElement)?.value || '',
        assets: (document.getElementById('planner-op-assets') as HTMLInputElement)?.value || '',
        notes: (document.getElementById('planner-op-notes') as HTMLTextAreaElement)?.value || '',
        nodes,
        links: links.map(l => ({
          source: typeof l.source === 'object' ? (l.source as any).id : l.source,
          target: typeof l.target === 'object' ? (l.target as any).id : l.target,
          label: l.label
        }))
      };

      try {
        showToast('Writing blueprint to secure disk vault...');
        const resp = await fetch('/api/store-intel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: secureFilename,
            type: 'json',
            data: graphPayload
          })
        });

        const resData = await resp.json();
        if (resData.success) {
          if (fileLabel) fileLabel.textContent = `Active: ${secureFilename}`;
          localStorage.setItem('wm-active-sandbox-name', secureFilename);
          localStorage.setItem(`wm-sandbox-file-${secureFilename}`, JSON.stringify(graphPayload));
          
          const docId = `PLAN-${Math.floor(1000 + Math.random() * 9000)}`;
          const existingDoc = this.mockRepoData.find(d => d.name === `Sandbox Blueprint: ${secureFilename}`);
          if (!existingDoc) {
            const newDoc = {
              id: docId,
              name: `Sandbox Blueprint: ${secureFilename}`,
              zone: zone,
              threat: 'medium',
              classification: 'SECRET // NOFORN',
              time: new Date().toISOString().replace('T', ' ').substring(0, 19)
            };
            this.mockRepoData.unshift(newDoc);
            this.renderRepositoryTable();
          }
          alert(`Geopolitical sandbox blueprint saved successfully to secure vault path:\n${resData.path}`);
        } else {
          throw new Error(resData.error || 'Server error');
        }
      } catch (err: any) {
        console.error('[sandbox-save] Failed:', err);
        localStorage.setItem(`wm-sandbox-file-${secureFilename}`, JSON.stringify(graphPayload));
        localStorage.setItem('wm-active-sandbox-name', secureFilename);
        if (fileLabel) fileLabel.textContent = `Active: ${secureFilename} (Offline)`;
        showToast('Blueprint saved locally to browser storage.');
      }
    });

    // Open Sandbox Blueprint Modal
    const openModal = document.getElementById('sandboxOpenModal');
    const openSelect = document.getElementById('sandboxOpenSelect') as HTMLSelectElement | null;

    document.getElementById('menu-file-open')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!openModal || !openSelect) return;

      openSelect.innerHTML = '';
      
      const blueprints = this.mockRepoData.filter(d => d.name.startsWith('Sandbox Blueprint: '));
      blueprints.forEach(bp => {
        const filename = bp.name.replace('Sandbox Blueprint: ', '');
        const opt = document.createElement('option');
        opt.value = filename;
        opt.textContent = filename;
        openSelect.appendChild(opt);
      });

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('wm-sandbox-file-')) {
          const filename = key.replace('wm-sandbox-file-', '');
          if (!blueprints.some(bp => bp.name.includes(filename))) {
            const opt = document.createElement('option');
            opt.value = filename;
            opt.textContent = `${filename} (Offline)`;
            openSelect.appendChild(opt);
          }
        }
      }

      if (openSelect.options.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '-- No blueprints saved yet --';
        openSelect.appendChild(opt);
      }

      openModal.style.display = 'flex';
    });

    document.getElementById('sandboxOpenModalCloseBtn')?.addEventListener('click', () => {
      if (openModal) openModal.style.display = 'none';
    });

    document.getElementById('sandboxOpenLoadBtn')?.addEventListener('click', async () => {
      if (!openModal || !openSelect) return;
      const selectedFile = openSelect.value;
      if (!selectedFile) return;

      try {
        let dataPayload: any = null;
        const localData = localStorage.getItem(`wm-sandbox-file-${selectedFile}`);
        if (localData) {
          dataPayload = JSON.parse(localData);
        } else {
          const response = await fetch(`/repo/json/${selectedFile}`);
          if (response.ok) {
            dataPayload = await response.json();
          } else {
            throw new Error('File not found in repo');
          }
        }

        if (dataPayload) {
          (document.getElementById('planner-op-name') as HTMLInputElement).value = dataPayload.opName || '';
          (document.getElementById('planner-op-zone') as HTMLSelectElement).value = dataPayload.zone || '';
          (document.getElementById('planner-op-posture') as HTMLSelectElement).value = dataPayload.posture || '';
          (document.getElementById('planner-op-assets') as HTMLInputElement).value = dataPayload.assets || '';
          (document.getElementById('planner-op-notes') as HTMLTextAreaElement).value = dataPayload.notes || '';

          nodes = dataPayload.nodes || [];
          links = dataPayload.links || [];

          const fileLabel = document.getElementById('sandbox-current-file-label');
          if (fileLabel) fileLabel.textContent = `Active: ${selectedFile}`;
          localStorage.setItem('wm-active-sandbox-name', selectedFile);

          updateLegendCount();
          updateSandboxGraph();
          openModal.style.display = 'none';
          showToast(`Loaded secure blueprint: ${selectedFile}`);
        }
      } catch (err) {
        console.error('[sandbox-open] Failed:', err);
        alert('Failed to load selected sandbox blueprint.');
      }
    });

    // Clear Selected Nodes
    document.getElementById('menu-edit-clear')?.addEventListener('click', (e) => {
      e.preventDefault();
      selectedNodes.clear();
      updateSelectionBubble();
      updateSandboxGraph();
      showToast('Cleared active graph selections.');
    });

    // Delete Selected Nodes
    const deleteSelectedNodes = () => {
      if (selectedNodes.size === 0) {
        showToast('No nodes selected to delete.');
        return;
      }
      nodes = nodes.filter(n => !selectedNodes.has(n.id));
      links = links.filter(l => {
        const sId = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const tId = typeof l.target === 'object' ? (l.target as any).id : l.target;
        return !selectedNodes.has(sId) && !selectedNodes.has(tId);
      });
      selectedNodes.clear();
      updateSelectionBubble();
      updateLegendCount();
      updateSandboxGraph();
      showToast('Pruned selected nodes from threat graph.');
    };

    document.getElementById('menu-edit-delete')?.addEventListener('click', (e) => {
      e.preventDefault();
      deleteSelectedNodes();
    });

    // Keyboard global Delete/Backspace handler
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
        const plannerTab = document.getElementById('tab-planner');
        if (plannerTab && plannerTab.classList.contains('active')) {
          e.preventDefault();
          deleteSelectedNodes();
        }
      }
    });

    // Load Last Active Sandbox automatically
    const lastActiveFile = localStorage.getItem('wm-active-sandbox-name');
    if (lastActiveFile) {
      const fileLabel = document.getElementById('sandbox-current-file-label');
      if (fileLabel) fileLabel.textContent = `Active: ${lastActiveFile}`;
      const localData = localStorage.getItem(`wm-sandbox-file-${lastActiveFile}`);
      if (localData) {
        try {
          const dataPayload = JSON.parse(localData);
          (document.getElementById('planner-op-name') as HTMLInputElement).value = dataPayload.opName || '';
          (document.getElementById('planner-op-zone') as HTMLSelectElement).value = dataPayload.zone || '';
          (document.getElementById('planner-op-posture') as HTMLSelectElement).value = dataPayload.posture || '';
          (document.getElementById('planner-op-assets') as HTMLInputElement).value = dataPayload.assets || '';
          (document.getElementById('planner-op-notes') as HTMLTextAreaElement).value = dataPayload.notes || '';
          nodes = dataPayload.nodes || [];
          links = dataPayload.links || [];
          setTimeout(() => {
            updateLegendCount();
            updateSandboxGraph();
          }, 300);
        } catch {}
      }
    }

    // ─── AI Terminal Geopolitical Analyst Chat Logic ───
    const sendBtn = document.getElementById('terminal-send-btn');
    const chatInput = document.getElementById('terminal-input') as HTMLInputElement | null;
    const terminalLogs = document.getElementById('terminal-logs');

    const appendMessage = (sender: 'agent' | 'user', text: string) => {
      if (!terminalLogs) return;
      const msg = document.createElement('div');
      msg.className = `terminal-row terminal-row--${sender}`;
      msg.innerHTML = `<strong>[${sender === 'user' ? 'TRANSMITTING' : 'HARVESTED ANALYST'}]</strong> ${text}`;
      terminalLogs.appendChild(msg);
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
    };

    if (sendBtn && chatInput && terminalLogs) {
      const handleSend = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        appendMessage('user', text);
        chatInput.value = '';

        setTimeout(() => {
          let reply = `Secure audit resolved for query: "${text}". Geopolitical postures are stable. Primary warning level is DEFCON 5 (NORMAL).`;
          if (text.toLowerCase().includes('south china sea')) {
            reply = `ANALYSIS COMPLED FOR SOUTH CHINA SEA (ZONE-1):
1. Chinese carrier task force (Shandong Strike Group) currently positioned 120nm East of Hainan.
2. US Naval force (USS Ronald Reagan) conducts freedom of navigation maneuvers.
3. High recommendation: Increase reconnaissance flights to monitor regional defense clusters.`;
          } else if (text.toLowerCase().includes('gps') || text.toLowerCase().includes('delay')) {
            reply = `ANALYSIS COMPLETED FOR REGIONAL TELEMETRY DISRUPTIONS:
1. Significant GPS Jamming anomalies detected over the Baltic Sea corridor, impacting civil aviation flight schedules.
2. 14 standard air transit delays recorded over Suwalki airspace.
3. Threat status: High cyber disruption probability.`;
          } else if (text.toLowerCase().includes('undersea') || text.toLowerCase().includes('ais')) {
            reply = `ANALYSIS COMPLETED FOR INFRASTRUCTURE INCIDENTS:
1. Undersea fiber transit fault recorded off the Gulf of Finland.
2. 3 dark vessels (AIS disabled) tracked Eastern Mediterranean.
3. Direct action: Monitor repair ship transits via live maritime tracking.`;
          }
          appendMessage('agent', reply);
        }, 800);
      };

      sendBtn.addEventListener('click', handleSend);
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSend();
      });

      // Suggestion chips
      container.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const query = chip.getAttribute('data-query');
          if (query && chatInput) {
            chatInput.value = query;
            handleSend();
          }
        });
      });
    }

    // ─── Harvester OSINT Scraping Logic ───
    const harvesterBtn = document.getElementById('harvester-start-btn');
    const harvesterExportBtn = document.getElementById('harvester-export-btn') as HTMLButtonElement | null;
    const harvesterConsole = document.getElementById('harvester-console-output');
    const harvesterStats = document.getElementById('harvester-stats');

    if (harvesterBtn && harvesterConsole && harvesterStats) {
      harvesterBtn.addEventListener('click', () => {
        const url = (document.getElementById('harvester-url') as HTMLInputElement)?.value || 'https://ajnav.com';
        harvesterBtn.setAttribute('disabled', 'true');
        if (harvesterExportBtn) harvesterExportBtn.setAttribute('disabled', 'true');
        setTrustedHtml(harvesterConsole, trustedHtml('', "legacy direct innerHTML migration"));
        harvesterStats.textContent = 'Status: Harvesting Geopolitical Data...';

        const logs = [
          `[SYSTEM] Connecting to secure target: ${url}...`,
          `[SYSTEM] Bypassing target cloudflare CDN shields... [OK]`,
          `[HARVEST] Extracted raw HTML data payload. Size: 1.2MB.`,
          `[HARVEST] Parsing document structure for entities...`,
          `[ENTITY-HARVEST] Discovered Geopolitical Zone: South China Sea Defense Ring`,
          `[ENTITY-HARVEST] Discovered Geopolitical Zone: Suwalki Corridor Defense Perimeter`,
          `[ENTITY-HARVEST] Discovered Military Asset: Carrier USS Gerald R. Ford`,
          `[ENTITY-HARVEST] Discovered Undersea Cable: Baltic-Connector Fiber-1`,
          `[SYSTEM] Harvesting compiled. Discovered 4 critical intelligence elements.`
        ];

        let index = 0;
        const interval = setInterval(() => {
          if (index < logs.length) {
            const current = harvesterConsole.innerHTML;
            harvesterConsole.innerHTML = (current ? current + '<br>' : '') + logs[index];
            harvesterConsole.scrollTop = harvesterConsole.scrollHeight;
            index++;
          } else {
            clearInterval(interval);
            harvesterBtn.removeAttribute('disabled');
            if (harvesterExportBtn) {
              harvesterExportBtn.removeAttribute('disabled');
              harvesterExportBtn.onclick = () => {
                const newDoc1 = {
                  id: `HARV-${Math.floor(1000 + Math.random() * 9000)}`,
                  name: `OSINT Harvester: ${url.replace('https://', '')}`,
                  zone: "South China Sea / Baltic Corridor",
                  threat: "high",
                  classification: "SECRET // NOFORN",
                  time: new Date().toISOString().replace('T', ' ').substring(0, 19)
                };
                this.mockRepoData.unshift(newDoc1);
                this.renderRepositoryTable();
                alert(`OSINT scraped document ${newDoc1.id} added successfully to Secure Vault!`);
                const repoTab = container.querySelector('.tab-item[data-tab="repository"]') as HTMLElement | null;
                repoTab?.click();
              };
            }
            harvesterStats.textContent = 'Status: Scan Completed (4 Entities Scraped)';
          }
        }, 400);
      });
    }

    // ─── Secure Repository Search & Render ───
    this.renderRepositoryTable();

    const repoSearch = document.getElementById('repo-search') as HTMLInputElement | null;
    if (repoSearch) {
      repoSearch.addEventListener('input', () => {
        this.renderRepositoryTable(repoSearch.value);
      });
    }

    // Export buttons
    const exportCsvBtn = document.getElementById('repo-export-csv');
    const exportJsonBtn = document.getElementById('repo-export-json');

    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        const headers = "Doc ID,Document / Log Name,Target Zone,Threat Level,Classification,Timestamp\n";
        const rows = this.mockRepoData.map(d => `"${d.id}","${d.name}","${d.zone}","${d.threat}","${d.classification}","${d.time}"`).join("\n");
        const blob = new Blob([headers + rows], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chanakya_intel_repository_${new Date().toISOString().substring(0, 10)}.csv`;
        a.click();
      });
    }

    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(this.mockRepoData, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chanakya_intel_repository_${new Date().toISOString().substring(0, 10)}.json`;
        a.click();
      });
    }
  }

  private renderRepositoryTable(filter: string = ''): void {
    const tableBody = document.getElementById('repo-table-body');
    if (!tableBody) return;

    const f = filter.toLowerCase();
    const filtered = this.mockRepoData.filter(d => 
      d.id.toLowerCase().includes(f) ||
      d.name.toLowerCase().includes(f) ||
      d.zone.toLowerCase().includes(f) ||
      d.threat.toLowerCase().includes(f) ||
      d.classification.toLowerCase().includes(f)
    );

    const rows = filtered.map(d => {
      const threatClass = `badge-threat--${d.threat}`;
      return `
        <tr>
          <td><strong>${d.id}</strong></td>
          <td>${d.name}</td>
          <td>${d.zone}</td>
          <td><span class="badge-threat ${threatClass}">${d.threat}</span></td>
          <td><span style="color:#64748b;font-weight:600;font-size:9px;">${d.classification}</span></td>
          <td><span style="font-family:var(--font-mono);font-size:10px;">${d.time}</span></td>
        </tr>
      `;
    }).join('');

    setTrustedHtml(tableBody, trustedHtml(rows || '<tr><td colspan="6" style="text-align:center;color:#64748b;">No documents match the filter criteria.</td></tr>', "legacy direct innerHTML migration"));
  }
}
