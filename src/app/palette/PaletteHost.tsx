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
    label: "In vs out",
    href: "/money/reports/in-out",
    icon: ChartColumn,
    roles: ["admin"],
    keywords: ["cash flow", "money in", "money out", "quarter", "profit"],
  },
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

export function PaletteHost({
  role,
  children,
}: {
  role: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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

  // Actions (A-89): idle rows in the palette, and the same keys work anywhere outside a text field: N, C, G then T.
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
    // Typing "paste", "photo" or "capture" finds the paste-or-photo action; the other actions are idle-only (destinations answer typed text).
    return {
      id: "actions",
      group: "Actions",
      order: 90,
      idle: () => items,
      search: (q) => filterItems([captureItem], q),
    };
  }, [openCapture]);

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
      if (k === "n") {
        e.preventDefault();
        navigate(INTAKE_ROUTE);
      } else if (k === "c" && openCapture) {
        e.preventDefault();
        openCapture();
      } else if (k === "t" && armed) {
        e.preventDefault();
        navigate(TODAY_ROUTE);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openCapture]);

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
      open: () => {
        setLoaded(true);
        setOpen(true);
      },
      register,
    }),
    [register],
  );

  return (
    <PaletteContext.Provider value={api}>
      {children}
      {loaded || open ? (
        <Suspense fallback={null}>
          <CommandPalette
            open={open}
            onOpenChange={setOpen}
            sources={sources}
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
    </PaletteContext.Provider>
  );
}
