import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  CalendarCheck,
  ChartColumn,
  CircleAlert,
  HandCoins,
  Keyboard,
  Landmark,
  Percent,
  Plus,
  Receipt,
  ReceiptText,
  Settings,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { navItemsForRole } from "@/app/navConfig";
import { settingsLinksFor } from "@/features/settings/settingsLinks";
import { PaletteContext, type PaletteApi } from "@/app/palette/usePalette";
import { KEYBOARD_MEDIA } from "@/app/shell/shortcuts";
import { Kbd } from "@/ui/Kbd";
import { LoadBoundary } from "@/ui/LoadBoundary";
import { ToastContext } from "@/ui/useToast";
import { useRetryableLazy } from "@/lib/importWithReload";
import { blockingOverlayOpen, shortcutsEnabled } from "@/ui/useShortcutsSetting";
import {
  filterItems,
  type PaletteItem,
  type PaletteSource,
} from "@/ui/paletteSources";

/** The old destination names, kept as search words: RFQs and Orders are Jobs now; To collect is To collect (a Money page). */
const NAV_SYNONYMS: Record<string, string[]> = {
  today: ["today", "tasks"],
  jobs: ["rfqs", "rfq", "orders", "order", "enquiries", "enquiry", "quotations"],
  money: ["payments", "invoices", "expenses"],
  companies: ["customers", "suppliers"],
};

/** Where the shortcut actions go. Capture opens the capture sheet (its palette row comes from the capture feature). */
const INTAKE_ROUTE = "/enquiries/new";
const TODAY_ROUTE = "/todo";
const NEW_ORDER_ROUTE = "/orders?new=1";

/**
 * Money pages Jump to finds by name (the Money tabs since ux/money-today). Admin and sales see To collect, Invoices and
 * Reports; the rest is admin only, as the Money tabs are. "Add expenses" opens the burst sheet straight away.
 */
const MONEY_PLACES: ReadonlyArray<{
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  roles: readonly string[];
  meta?: string;
  keywords?: string[];
}> = [
  {
    id: "money:receivables",
    label: "To collect",
    href: "/money/receivables",
    icon: HandCoins,
    roles: ["admin", "sales"],
    keywords: ["who owes us", "receivables", "balances", "outstanding"],
  },
  {
    id: "money:gst",
    label: "Invoices",
    href: "/money/gst-register",
    icon: Receipt,
    roles: ["admin", "sales"],
    keywords: ["invoices & gst", "gst register", "gst"],
  },
  {
    id: "money:reports",
    label: "Reports",
    href: "/money/reports",
    icon: ChartColumn,
    roles: ["admin", "sales"],
  },
  {
    id: "money:expenses",
    label: "Expenses",
    href: "/money/expenses",
    icon: Wallet,
    roles: ["admin"],
  },
  {
    id: "money:burst",
    label: "Add expenses",
    href: "/money/expenses?burst=1",
    icon: Plus,
    roles: ["admin"],
    meta: "Action",
    keywords: ["money", "burst", "add expense", "spend", "fuel", "water", "petrol"],
  },
  {
    id: "money:in-out",
    label: "Money in and out",
    href: "/money/reports/in-out",
    icon: ChartColumn,
    roles: ["admin"],
    keywords: ["in vs out", "cash flow", "money in", "money out", "quarter", "profit"],
  },
  // round 3: every money report is found by name (each opens in Money > Reports)
  { id: "money:pnl", label: "Profit and loss", href: "/money/reports/pnl", icon: ChartColumn, roles: ["admin"], keywords: ["p&l", "profit", "result"] },
  { id: "money:aging", label: "Overdue by age", href: "/money/reports/aging", icon: ChartColumn, roles: ["admin"], keywords: ["aging", "overdue"] },
  { id: "money:owe", label: "We owe suppliers", href: "/money/reports/owe", icon: ChartColumn, roles: ["admin"], keywords: ["payables", "suppliers", "we owe"] },
  { id: "money:gst-month", label: "GST and FBR", href: "/money/reports/gst", icon: ChartColumn, roles: ["admin"], keywords: ["fbr", "gst month", "input tax"] },
  { id: "money:team", label: "Sales by person", href: "/money/reports/team", icon: ChartColumn, roles: ["admin"], keywords: ["team", "targets", "credited"] },
  { id: "money:categories", label: "Expenses by category", href: "/money/reports/categories", icon: ChartColumn, roles: ["admin"], keywords: ["categories", "spend"] },
  { id: "money:enquiries", label: "Enquiries and customers", href: "/money/reports/enquiries", icon: ChartColumn, roles: ["admin", "sales"], keywords: ["win rate", "repeat customers"] },
  {
    id: "money:month-end",
    label: "Lock a month",
    href: "/money/month-end",
    icon: CalendarCheck,
    roles: ["admin"],
    keywords: ["month end", "close month", "close through"],
  },
  {
    id: "money:bank",
    label: "Bank check",
    href: "/money/month-end/bank",
    icon: Landmark,
    roles: ["admin"],
    keywords: ["match bank statement", "bank tick", "bank statement"],
  },
  {
    id: "money:margins",
    label: "Order margins",
    href: "/money/margins",
    icon: Percent,
    roles: ["admin"],
  },
  {
    id: "money:exceptions",
    label: "Mistakes to fix",
    href: "/money/exceptions",
    icon: CircleAlert,
    roles: ["admin"],
    keywords: ["exceptions", "things to check"],
  },
];

/**
 * The places Jump to finds by name, besides the main destinations (audit: they were only in the avatar menu). Searched,
 * not shown idle. The Settings pages come from the same list as the Settings menu (settingsLinks.ts), so a role is offered
 * exactly what that menu offers; the Money pages follow the Money tabs' roles.
 */
function placesFor(role: string): PaletteItem[] {
  return [
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      meta: "Go to",
      href: "/settings",
    },
    ...settingsLinksFor(role).map((l) => ({
      id: `settings:${l.to}`,
      label: l.label,
      icon: l.icon,
      meta: "Settings",
      href: l.to,
    })),
    ...MONEY_PLACES.filter((p) => p.roles.includes(role)).map((p) => ({
      id: p.id,
      label: p.label,
      icon: p.icon,
      meta: p.meta ?? "Money",
      keywords: p.keywords,
      href: p.href,
    })),
  ];
}

/**
 * True when a key press belongs to something the person is typing into, or to a dialog or menu that is open. The desktop
 * Help panel sits beside the page (non-modal), so it does not stop the page's keys.
 */
function isTypingContext(e: KeyboardEvent): boolean {
  const t = e.target;
  if (t instanceof HTMLElement) {
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      return true;
    if (
      t.closest(
        '[role="textbox"],[role="combobox"],[role="searchbox"],[role="listbox"],[role="menu"],[role="dialog"],[role="alertdialog"]',
      )
    )
      return true;
  }
  return blockingOverlayOpen();
}

/*
 * Palette host (U08). Owns the open state of the one command palette in the
 * shell, the registry of sources, and the built-in "Go to" source (the role's
 * destinations, so a role never sees a place it cannot open). Features add their
 * own sources with usePaletteSource(): R12 registers search (companies, contacts,
 * job and RFQ numbers), screens register their actions while they are mounted.
 */
// The palette (and cmdk) load after the first screen: on idle, or at once when it is opened (bundle budget, P04).
// Both load through useRetryableLazy inside <LoadBoundary>: with no signal, a chunk that was never downloaded fails only
// search (or the sheet), with a "Try again", never the whole app and what is being typed (hunt HE-2).
const loadPalette = () =>
  import("@/ui/CommandPalette").then((m) => ({ default: m.CommandPalette }));
// Quick add expense (the E key) loads only when someone asks for it: it brings the whole Quick add.
const loadQuickExpense = () =>
  import("@/app/shell/QuickExpenseDialog").then((m) => ({
    default: m.QuickExpenseDialog,
  }));
// The Keyboard shortcuts sheet loads only when someone asks for it (?, the account menu, the palette action).
const loadShortcuts = () =>
  import("@/app/shell/ShortcutsSheet").then((m) => ({
    default: m.ShortcutsSheet,
  }));

/** The plain sentence of a load failure (importWithReload's StaleAppError), or a general one. */
function loadFailureText(err: unknown): string {
  return err instanceof Error && err.name === "StaleAppError"
    ? err.message
    : "Check your signal, then try again.";
}

function hasKeyboard(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(KEYBOARD_MEDIA).matches
    : true;
}

export function PaletteHost({
  role,
  personId,
  children,
}: {
  role: string;
  personId?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Mounted from the first time it opens (not before), so it closes with its own animation and focus return.
  const [shortcutsLoaded, setShortcutsLoaded] = useState(false);
  const openShortcuts = useCallback(() => {
    setShortcutsLoaded(true);
    setShortcutsOpen(true);
  }, []);
  // Quick add expense, admin only: mounted from the first time it opens, so it closes with its own animation.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickLoaded, setQuickLoaded] = useState(false);
  const quick = useRetryableLazy(loadQuickExpense);
  const openQuickExpense = useCallback(() => {
    setQuickLoaded(true);
    setQuickOpen(true);
  }, []);
  const onPaletteOpenChange = useCallback((next: boolean) => {
    if (!next) setInitialQuery("");
    setOpen(next);
  }, []);
  const [extra, setExtra] = useState<PaletteSource[]>([]);
  const toast = useContext(ToastContext)?.toast;
  const palette = useRetryableLazy(loadPalette);
  const shortcuts = useRetryableLazy(loadShortcuts);
  // The palette chunk failed to load (idle preload or an open): nothing is mounted until the next open tries again.
  const [paletteFailed, setPaletteFailed] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const seq = useRef(0);

  const register = useCallback((source: PaletteSource) => {
    const tagged = { ...source, id: `${source.id}#${seq.current++}` };
    setExtra((list) => [...list, tagged]);
    return () => setExtra((list) => list.filter((s) => s !== tagged));
  }, []);

  const goTo = useMemo<PaletteSource>(() => {
    const items: PaletteItem[] = [
      ...navItemsForRole(role).map((n) => ({
        id: n.key,
        label: n.label,
        icon: n.icon,
        meta: "Go to",
        href: n.path,
        // the old words still find their new home (redesign phase 5: one door per action, plus Search)
        keywords: NAV_SYNONYMS[n.key],
      })),
      ...placesFor(role),
    ];
    return {
      id: "go-to",
      group: "Jump to",
      order: 5,
      search: (q) => filterItems(items, q),
    };
  }, [role]);

  // Actions (A-89): idle rows in the palette, and the same keys work anywhere outside a text field: N, C, G then T, ?.
  const actions = useMemo<PaletteSource>(() => {
    // Desktop only (a keyboard is likely); found by "keys" or "shortcuts" too.
    const shortcutsItem: PaletteItem = {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      meta: "Action",
      keywords: ["keys", "shortcuts", "keyboard", "hotkeys"],
      icon: Keyboard,
      shortcut: ["?"],
      onSelect: openShortcuts,
    };
    const items: PaletteItem[] = [
      {
        id: "new-rfq",
        label: "New enquiry",
        meta: "Go to intake",
        icon: Plus,
        shortcut: ["N"],
        href: INTAKE_ROUTE,
        // the old names stay findable: RFQ, and the top-bar button this replaced (P4-A)
        keywords: ["new rfq", "rfq", "paste or photo", "paste", "capture", "photo", "pdf", "enquiry"],
      },
      ...(role === "admin"
        ? [{ id: "new-expense", label: "Add an expense", meta: "Quick add", icon: ReceiptText, shortcut: ["E"], onSelect: openQuickExpense } satisfies PaletteItem]
        : []),
      ...(role === "admin" || role === "sales"
        ? [{ id: "new-order", label: "Order without enquiry", meta: "Go to Orders", icon: ShoppingCart, shortcut: ["O"], href: NEW_ORDER_ROUTE } satisfies PaletteItem]
        : []),
      {
        id: "go-today",
        label: "Go to To do",
        icon: CalendarCheck,
        shortcut: ["G T"],
        href: TODAY_ROUTE,
      },
      {
        id: "new-company",
        label: "New company",
        icon: Building2,
        href: "/companies?new=1",
      },
    ];
    // Typing "paste", "photo" or "capture" finds New enquiry (what Paste or photo became), "keys" or "shortcuts" the shortcuts sheet; the
    // other actions are idle-only (destinations answer typed text).
    return {
      id: "actions",
      group: "Actions",
      order: 90,
      idle: () => (hasKeyboard() ? [...items, shortcutsItem] : items),
      search: (q) =>
        filterItems(hasKeyboard() ? [items[0], shortcutsItem] : [items[0]], q),
    };
  }, [openShortcuts, openQuickExpense, role]);

  useEffect(() => {
    let armedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.repeat ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isTypingContext(e) ||
        !shortcutsEnabled()
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        armedAt = Date.now();
        return;
      }
      const armed = Date.now() - armedAt < 1000;
      armedAt = 0;
      // C (Paste or photo) is CaptureProvider's: it handles the key first and prevents default, so it is not matched here.
      if (k === "n") {
        e.preventDefault();
        navigate(INTAKE_ROUTE);
      } else if (k === "e" && role === "admin") {
        // Quick add expense from anywhere (admin only: expenses are admin only, 0010)
        e.preventDefault();
        openQuickExpense();
      } else if (k === "o" && (role === "admin" || role === "sales")) {
        // An order without an enquiry: the new-order dialog on the Orders list
        e.preventDefault();
        navigate(NEW_ORDER_ROUTE);
      } else if (k === "?") {
        e.preventDefault();
        openShortcuts();
      } else if (k === "t" && armed) {
        e.preventDefault();
        navigate(TODAY_ROUTE);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openShortcuts, openQuickExpense, role]);

  // Until the palette has loaded, Ctrl+K here opens it (and loads it); after that the palette's own key handles it.
  const [loaded, setLoaded] = useState(false);
  // After a failed load the next open mounts a fresh attempt (palette.retry() already made it).
  const openPalette = useCallback(() => {
    setPaletteFailed(false);
    setLoaded(true);
    setOpen(true);
  }, []);
  const retryPalette = palette.retry;
  const onPaletteLoadError = useCallback(
    (err: unknown) => {
      setPaletteFailed(true);
      retryPalette();
      // Failed in the background: say nothing now, the next open tries again. Failed while open: close it and say so.
      if (!openRef.current) return;
      setOpen(false);
      toast?.({
        tone: "danger",
        title: "Search could not open",
        body: loadFailureText(err),
        action: { label: "Try again", onClick: openPalette },
      });
    },
    [toast, openPalette, retryPalette],
  );
  const retryShortcuts = shortcuts.retry;
  const onShortcutsLoadError = useCallback(
    (err: unknown) => {
      setShortcutsOpen(false);
      setShortcutsLoaded(false);
      retryShortcuts();
      toast?.({
        tone: "danger",
        title: "Keyboard shortcuts could not open",
        body: loadFailureText(err),
        action: { label: "Try again", onClick: openShortcuts },
      });
    },
    [toast, openShortcuts, retryShortcuts],
  );
  useEffect(() => {
    if (loaded && !paletteFailed) return;
    // Preloaded first, then mounted (perf/lcp): a download that fails (no signal yet) never mounts anything; the next open
    // mounts a fresh attempt inside <LoadBoundary>, whose failure stays local (HE-2).
    const t = loaded
      ? undefined
      : window.setTimeout(() => {
          loadPalette().then(
            () => setLoaded(true),
            () => {},
          );
        }, 1200);
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        // Not on top of an open dialog or menu: its half-typed text stays where it is.
        if (blockingOverlayOpen()) return;
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [loaded, paletteFailed, openPalette]);

  const sources = useMemo(
    () => [...extra, actions, goTo],
    [extra, actions, goTo],
  );
  const api = useMemo<PaletteApi>(
    () => ({
      open: (query?: string) => {
        // Buttons pass `open` straight to onClick, so a click event can arrive here: only a string is a query.
        setInitialQuery(typeof query === "string" ? query.trim() : "");
        openPalette();
      },
      openShortcuts,
      openQuickExpense: role === "admin" ? openQuickExpense : undefined,
      register,
    }),
    [register, openShortcuts, openQuickExpense, openPalette, role],
  );

  return (
    <PaletteContext.Provider value={api}>
      {children}
      {(loaded || open) && !paletteFailed ? (
        <LoadBoundary key={palette.attempt} onError={onPaletteLoadError}>
        <Suspense fallback={null}>
          <palette.Component
            open={open}
            onOpenChange={onPaletteOpenChange}
            sources={sources}
            personId={personId}
            initialQuery={initialQuery}
            shortcutsHint
            onNavigate={(href, { newTab }) =>
              newTab ? window.open(href, "_blank", "noopener") : navigate(href)
            }
            emptyHint={
              <>
                {role === "engineer"
                  ? "Search covers RFQs, orders, purchase orders, companies, contacts and order items."
                  : "Search covers RFQs, orders, invoices, purchase orders, companies, contacts and order items."}{" "}
                Try one word, or press <Kbd>N</Kbd> to start an RFQ.
              </>
            }
          />
        </Suspense>
        </LoadBoundary>
      ) : null}
      {quickLoaded && role === "admin" ? (
        <LoadBoundary key={quick.attempt}>
          <Suspense fallback={null}>
            <quick.Component open={quickOpen} onOpenChange={setQuickOpen} />
          </Suspense>
        </LoadBoundary>
      ) : null}
      {shortcutsLoaded ? (
        <LoadBoundary key={shortcuts.attempt} onError={onShortcutsLoadError}>
          <Suspense fallback={null}>
            <shortcuts.Component open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          </Suspense>
        </LoadBoundary>
      ) : null}
    </PaletteContext.Provider>
  );
}
