import {
  Suspense,
  lazy,
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
  Import,
  Keyboard,
  Landmark,
  Percent,
  Plus,
  Receipt,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { navItemsForRole } from "@/app/navConfig";
import { settingsLinksFor } from "@/features/settings/settingsLinks";
import { CaptureContext } from "@/app/capture/useCapture";
import { PaletteContext, type PaletteApi } from "@/app/palette/usePalette";
import { CAPTURE_LABEL } from "@/app/shell/TopBar";
import { KEYBOARD_MEDIA } from "@/app/shell/shortcuts";
import { Kbd } from "@/ui/Kbd";
import { shortcutsEnabled } from "@/ui/useShortcutsSetting";
import {
  filterItems,
  type PaletteItem,
  type PaletteSource,
} from "@/ui/paletteSources";

/** Where the shortcut actions go. Capture opens the capture sheet (its palette row comes from the capture feature). */
const INTAKE_ROUTE = "/rfqs/new";
const TODAY_ROUTE = "/today";

/**
 * Money pages Jump to finds by name (the Money tabs since ux/money-today). Admin and sales see Who owes us, Invoices & GST and
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
    label: "Who owes us",
    href: "/money/receivables",
    icon: HandCoins,
    roles: ["admin", "sales"],
    keywords: ["receivables", "balances"],
  },
  {
    id: "money:gst",
    label: "Invoices & GST",
    href: "/money/gst-register",
    icon: Receipt,
    roles: ["admin", "sales"],
    keywords: ["gst register", "invoices"],
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
    label: "Month end",
    href: "/money/month-end",
    icon: CalendarCheck,
    roles: ["admin"],
  },
  {
    id: "money:bank",
    label: "Match bank statement",
    href: "/money/month-end/bank",
    icon: Landmark,
    roles: ["admin"],
    keywords: ["bank tick"],
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
    label: "Things to check",
    href: "/money/exceptions",
    icon: CircleAlert,
    roles: ["admin"],
    keywords: ["exceptions"],
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

/** True when a key press belongs to something the person is typing into or a dialog they are in. */
function isTypingContext(e: KeyboardEvent): boolean {
  const t = e.target;
  if (t instanceof HTMLElement) {
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      return true;
    if (
      t.closest(
        '[role="textbox"],[role="combobox"],[role="searchbox"],[role="listbox"],[role="menu"]',
      )
    )
      return true;
  }
  return Boolean(
    document.querySelector('[role="dialog"],[role="alertdialog"]'),
  );
}

/*
 * Palette host (U08). Owns the open state of the one command palette in the
 * shell, the registry of sources, and the built-in "Go to" source (the role's
 * destinations, so a role never sees a place it cannot open). Features add their
 * own sources with usePaletteSource(): R12 registers search (companies, contacts,
 * RFQ numbers), screens register their actions ("New RFQ") while they are mounted.
 */
// The palette (and cmdk) load after the first screen: on idle, or at once when it is opened (bundle budget, P04).
const loadPalette = () => import("@/ui/CommandPalette");
const CommandPalette = lazy(() =>
  loadPalette().then((m) => ({ default: m.CommandPalette })),
);
// The Keyboard shortcuts sheet loads only when someone asks for it (?, the account menu, the palette action).
const ShortcutsSheet = lazy(() =>
  import("@/app/shell/ShortcutsSheet").then((m) => ({
    default: m.ShortcutsSheet,
  })),
);

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
  const onPaletteOpenChange = useCallback((next: boolean) => {
    if (!next) setInitialQuery("");
    setOpen(next);
  }, []);
  const [extra, setExtra] = useState<PaletteSource[]>([]);
  const seq = useRef(0);
  const openCapture = useContext(CaptureContext)?.openCapture;

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
    // "capture" and "paste" still find it: the old name, and the word people reach for.
    const captureItem: PaletteItem = {
      id: "capture",
      label: CAPTURE_LABEL,
      meta: "Action",
      keywords: ["capture", "paste"],
      icon: Import,
      shortcut: ["C"],
      onSelect: () => openCapture?.(),
    };
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
        label: "New RFQ",
        meta: "Go to intake",
        icon: Plus,
        shortcut: ["N"],
        href: INTAKE_ROUTE,
      },
      captureItem,
      {
        id: "go-today",
        label: "Go to Today",
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
    // Typing "paste", "photo" or "capture" finds the paste-or-photo action, "keys" or "shortcuts" the shortcuts sheet; the
    // other actions are idle-only (destinations answer typed text).
    return {
      id: "actions",
      group: "Actions",
      order: 90,
      idle: () => (hasKeyboard() ? [...items, shortcutsItem] : items),
      search: (q) =>
        filterItems(hasKeyboard() ? [captureItem, shortcutsItem] : [captureItem], q),
    };
  }, [openCapture, openShortcuts]);

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
  }, [navigate, openShortcuts]);

  // Until the palette has loaded, Ctrl+K here opens it (and loads it); after that the palette's own key handles it.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = window.setTimeout(() => setLoaded(true), 1200);
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setLoaded(true);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [loaded]);

  const sources = useMemo(
    () => [...extra, actions, goTo],
    [extra, actions, goTo],
  );
  const api = useMemo<PaletteApi>(
    () => ({
      open: (query?: string) => {
        // Buttons pass `open` straight to onClick, so a click event can arrive here: only a string is a query.
        setInitialQuery(typeof query === "string" ? query.trim() : "");
        setLoaded(true);
        setOpen(true);
      },
      openShortcuts,
      register,
    }),
    [register, openShortcuts],
  );

  return (
    <PaletteContext.Provider value={api}>
      {children}
      {loaded || open ? (
        <Suspense fallback={null}>
          <CommandPalette
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
                Search covers RFQs, orders, companies and items. Try one word,
                or press <Kbd>N</Kbd> to start an RFQ.
              </>
            }
          />
        </Suspense>
      ) : null}
      {shortcutsLoaded ? (
        <Suspense fallback={null}>
          <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </Suspense>
      ) : null}
    </PaletteContext.Provider>
  );
}
