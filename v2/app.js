const {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useContext,
  createContext,
  useRef
} = React;

// ============================================================
// Icon helper
// ============================================================
function Icon({
  name,
  className = "",
  fill = false,
  size = 24
}) {
  const style = {
    fontSize: size,
    fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`
  };
  return /*#__PURE__*/React.createElement("span", {
    className: `material-symbols-outlined select-none ${className}`,
    style: style
  }, name);
}

// ============================================================
// NutritionContext
// ============================================================
const NutritionContext = createContext(null);
function NutritionProvider({
  children
}) {
  const [state, setStateRaw] = useState(() => {
    const saved = LocalStore.loadState();
    return saved ? {
      ...DEFAULT_STATE,
      ...saved
    } : {
      ...DEFAULT_STATE
    };
  });
  const [apiKey, setApiKeyRaw] = useState(() => LocalStore.loadApiKey());
  const setState = useCallback(updater => {
    setStateRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
  }, []);

  // Persist state off the keystroke path: debounce 250ms and flush on unmount.
  const saveTimerRef = useRef(null);
  const latestStateRef = useRef(state);
  const didMountRef = useRef(false);
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      LocalStore.saveState(latestStateRef.current);
    }, 250);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [state]);
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        LocalStore.saveState(latestStateRef.current);
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  // Apply theme mode to <html> classList
  useEffect(() => {
    const mode = state.themeMode || "dark";
    let isDark;
    if (mode === "dark") {
      document.documentElement.classList.add("dark");
      isDark = true;
    } else if (mode === "light") {
      document.documentElement.classList.remove("dark");
      isDark = false;
    } else {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", isDark);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDark ? "#000000" : "#fafafe");
  }, [state.themeMode]);
  const setApiKey = useCallback(key => {
    setApiKeyRaw(key);
    LocalStore.saveApiKey(key);
  }, []);
  const allRecipes = useMemo(() => Modules.Recipes.getAllRecipes(), []);
  const runningTotals = useMemo(() => Modules.GapEngine.computeRunningTotals(state), [state.dayLog, state.fatSolubleCarryover]);
  const gapsClosed = useMemo(() => Modules.GapEngine.computeGapsClosed(runningTotals), [runningTotals]);
  const value = useMemo(() => ({
    state,
    setState,
    runningTotals,
    gapsClosed,
    allRecipes,
    apiKey,
    setApiKey
  }), [state, setState, runningTotals, gapsClosed, allRecipes, apiKey, setApiKey]);
  return /*#__PURE__*/React.createElement(NutritionContext.Provider, {
    value: value
  }, children);
}
function useNutrition() {
  return useContext(NutritionContext);
}

// ============================================================
// AuthContext (Phase 3 — UI only, no read/write yet)
// ============================================================
const AuthContext = createContext(null);
function AuthProvider({
  children
}) {
  const Identity = window.Modules && window.Modules.Identity;
  const configured = !!(Identity && Identity.isConfigured());
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(configured ? "loading" : "unconfigured");
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    Identity.getSession().then(s => {
      if (cancelled) return;
      setSession(s);
      setStatus(s ? "signed_in" : "signed_out");
    }).catch(() => {
      if (!cancelled) setStatus("signed_out");
    });
    const unsub = Identity.onAuthStateChange(s => {
      setSession(s);
      setStatus(s ? "signed_in" : "signed_out");
    });
    return () => {
      cancelled = true;
      unsub && unsub();
    };
  }, [configured]);
  const signIn = useCallback((email, password) => Identity.signIn(email, password), [Identity]);
  const signOut = useCallback(() => Identity.signOut(), [Identity]);
  const value = useMemo(() => ({
    configured,
    status,
    session,
    user: session && session.user || null,
    signIn,
    signOut
  }), [configured, status, session, signIn, signOut]);
  return /*#__PURE__*/React.createElement(AuthContext.Provider, {
    value: value
  }, children);
}
function useAuth() {
  return useContext(AuthContext);
}

// ============================================================
// CloudSync — Phase 4 read-only hydration (cloud → device)
//
// Runs once per mount when (cloudSync toggle on) AND (signed in) AND
// (RemoteStore available). Defers the actual fetch to requestIdleCallback
// so LCP is not blocked. Merge is append-only:
//   - dayHistory dedup by date
//   - dayLog dedup by id (cloud rows use idempotency_key, local rows use
//     genId(); the two namespaces never collide).
// No deletes or overwrites in this phase — Phase 5 introduces LWW.
// ============================================================
function CloudSync() {
  const {
    state,
    setState
  } = useNutrition();
  const auth = useAuth();
  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current) return;
    if (!state.cloudSync) return;
    if (!auth || auth.status !== "signed_in" || !auth.user) return;
    if (!window.RemoteStore || !window.RemoteStore.isAvailable()) return;
    ranRef.current = true;
    const userId = auth.user.id;
    const run = () => {
      Promise.all([window.RemoteStore.fetchDays(userId), window.RemoteStore.fetchEntries(userId, state.currentDate)]).then(([days, entries]) => {
        setState(s => {
          const localDates = new Set((s.dayHistory || []).map(d => d.date));
          const newHistoryRows = (days || []).filter(d => !localDates.has(d.date));
          const mergedHistory = (s.dayHistory || []).concat(newHistoryRows).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
          const localIds = new Set((s.dayLog || []).map(e => e.id));
          const newEntries = (entries || []).filter(e => !localIds.has(e.id));
          const mergedLog = (s.dayLog || []).concat(newEntries);
          return Object.assign({}, s, {
            dayHistory: mergedHistory,
            dayLog: mergedLog
          });
        });
      }).catch(err => {
        console.warn("Cloud hydration failed:", err && err.message);
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, {
        timeout: 1500
      });
    } else {
      setTimeout(run, 0);
    }
  }, [state.cloudSync, auth && auth.status, auth && auth.user, state.currentDate, setState]);
  return null;
}

// ============================================================
// Toast Context
// ============================================================
const ToastContext = createContext(null);
function ToastProvider({
  children
}) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const showToast = useCallback(msg => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({
      ...msg,
      exiting: false
    });
    timerRef.current = setTimeout(() => {
      setToast(t => t ? {
        ...t,
        exiting: true
      } : null);
      setTimeout(() => setToast(null), 300);
    }, 8000);
  }, []);
  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(t => t ? {
      ...t,
      exiting: true
    } : null);
    setTimeout(() => setToast(null), 300);
  }, []);
  return /*#__PURE__*/React.createElement(ToastContext.Provider, {
    value: {
      toast,
      showToast,
      dismissToast
    }
  }, children);
}
function useToast() {
  return useContext(ToastContext);
}

// ============================================================
// Toast Component
// ============================================================
function Toast() {
  const {
    toast,
    dismissToast
  } = useToast();
  const {
    setState
  } = useNutrition();
  if (!toast) return null;
  const handleUndo = () => {
    if (toast.entryId) {
      setState(s => Modules.Log.removeEntry(s, toast.entryId));
    }
    dismissToast();
  };
  return /*#__PURE__*/React.createElement("div", {
    className: `fixed bottom-24 left-4 right-4 z-50 flex justify-center ${toast.exiting ? "toast-exit" : "toast-enter"}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-2xl px-5 py-3 flex items-center gap-3 max-w-sm w-full"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-sm flex-1 truncate"
  }, toast.text), toast.macros && /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-on-surface-variant whitespace-nowrap"
  }, "P:", Math.round(toast.macros.protein), " C:", Math.round(toast.macros.carbs), " F:", Math.round(toast.macros.fat)), toast.entryId && /*#__PURE__*/React.createElement("button", {
    onClick: handleUndo,
    className: "text-xs font-semibold text-primary-fixed-dim hover:text-white transition"
  }, "Undo")));
}

// ============================================================
// BottomNav
// ============================================================
function BottomNav({
  activeTab,
  onTabChange
}) {
  const tabs = [{
    id: "home",
    icon: "add_circle",
    label: "Log"
  }, {
    id: "dashboard",
    icon: "bar_chart",
    label: "Dashboard"
  }, {
    id: "insights",
    icon: "monitoring",
    label: "Insights"
  }, {
    id: "settings",
    icon: "settings",
    label: "Settings"
  }];
  return /*#__PURE__*/React.createElement("nav", {
    className: "fixed bottom-4 left-1/2 -translate-x-1/2 z-40"
  }, /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-full px-2 py-2 flex items-center gap-1"
  }, tabs.map(tab => {
    const active = activeTab === tab.id;
    return /*#__PURE__*/React.createElement("button", {
      key: tab.id,
      onClick: () => onTabChange(tab.id),
      className: `flex items-center gap-2 px-5 py-2.5 rounded-full transition-all duration-200 ${active ? "bg-gradient-to-r from-blue-600 to-blue-400 text-white shadow-lg shadow-blue-500/20" : "text-on-surface-variant hover:text-primary"}`
    }, /*#__PURE__*/React.createElement(Icon, {
      name: tab.icon,
      fill: active,
      size: 22
    }), active && /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-semibold font-label"
    }, tab.label));
  })));
}

// ============================================================
// AppHeader
// ============================================================
function AppHeader() {
  const {
    state
  } = useNutrition();
  const auth = useAuth();
  const cloudOn = !!state.cloudSync;
  const signedIn = auth && auth.status === "signed_in";
  // Dimmed until Phase 4 (no data flowing yet); active = sync toggle on AND signed in.
  const indicatorActive = cloudOn && signedIn;
  const indicatorLabel = !cloudOn ? "Cloud sync off" : signedIn ? "Cloud sync on" : "Cloud sync — signed out";
  return /*#__PURE__*/React.createElement("header", {
    className: "fixed top-0 left-0 right-0 z-30 h-16 bg-surface/80 backdrop-blur-3xl flex items-center px-5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bubble_chart",
    className: "text-blue-500",
    size: 28,
    fill: true
  }), /*#__PURE__*/React.createElement("span", {
    className: "font-headline text-2xl font-extrabold tracking-tighter text-blue-500"
  }, "Vitality")), /*#__PURE__*/React.createElement("div", {
    className: "ml-auto flex items-center gap-1.5 text-xs",
    "data-testid": "cloud-sync-indicator",
    "data-active": indicatorActive ? "true" : "false",
    title: indicatorLabel,
    "aria-label": indicatorLabel
  }, /*#__PURE__*/React.createElement(Icon, {
    name: indicatorActive ? "cloud_done" : "cloud_off",
    size: 18,
    className: indicatorActive ? "text-blue-400" : "text-on-surface-variant/40"
  })));
}

// ============================================================
// ProgressRing
// ============================================================
function ProgressRing({
  closed,
  total
}) {
  const pct = total > 0 ? closed / total : 0;
  const r = 45;
  const circ = 2 * Math.PI * r; // ~282.7
  const offset = circ * (1 - pct);
  return /*#__PURE__*/React.createElement("div", {
    className: "relative flex items-center justify-center mx-auto",
    style: {
      width: 264,
      height: 264
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 liquid-glass rounded-full"
  }), /*#__PURE__*/React.createElement("svg", {
    width: "264",
    height: "264",
    viewBox: "0 0 100 100",
    className: "relative z-10 -rotate-90"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: "primaryGradient",
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#0058bc"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#0070eb"
  }))), /*#__PURE__*/React.createElement("circle", {
    cx: "50",
    cy: "50",
    r: r,
    fill: "none",
    stroke: "rgb(var(--color-ring-bg) / 0.05)",
    strokeWidth: "6"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "50",
    cy: "50",
    r: r,
    fill: "none",
    stroke: "url(#primaryGradient)",
    strokeWidth: "6",
    strokeLinecap: "round",
    strokeDasharray: circ,
    strokeDashoffset: offset,
    style: {
      transition: "stroke-dashoffset 0.8s ease"
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 flex flex-col items-center justify-center z-20"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-headline text-6xl font-extrabold tracking-tight"
  }, closed, "/", total), /*#__PURE__*/React.createElement("span", {
    className: "text-on-surface-variant font-semibold text-xs mt-2 flex items-center gap-1"
  }, closed === total ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "check_circle",
    fill: true,
    size: 14,
    className: "text-green-400"
  }), " All Goals Met") : "Goals Reached")), /*#__PURE__*/React.createElement("div", {
    className: "specular-highlight",
    style: {
      top: 24,
      right: 80
    }
  }));
}

// ============================================================
// FocusPoints
// ============================================================
function FocusPoints({
  gaps,
  runningTotals
}) {
  const shown = gaps.slice(0, 4);
  if (shown.length === 0) return /*#__PURE__*/React.createElement("div", {
    className: "text-center py-6"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check_circle",
    className: "text-green-400",
    size: 32,
    fill: true
  }), /*#__PURE__*/React.createElement("p", {
    className: "text-on-surface-variant text-sm mt-2"
  }, "All gaps closed for today"));
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-end px-2"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline font-bold text-xl text-on-surface"
  }, "Focus Points"), /*#__PURE__*/React.createElement("span", {
    className: "text-on-surface-variant text-xs font-medium"
  }, "Daily Highlights")), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-3"
  }, shown.map(gap => {
    const st = getStatus(gap.key, runningTotals[gap.key] || 0);
    const pctVal = Math.min(100, st.pct);
    const isOver = gap.type === "over";
    const color = isOver ? "#f97316" : "#3b82f6";
    const r2 = 16;
    const c2 = 2 * Math.PI * r2;
    const off2 = c2 * (1 - pctVal / 100);
    return /*#__PURE__*/React.createElement("div", {
      key: gap.key,
      className: "liquid-glass p-6 rounded-3xl flex flex-col gap-3"
    }, /*#__PURE__*/React.createElement("svg", {
      width: "36",
      height: "36",
      viewBox: "0 0 40 40",
      className: "-rotate-90"
    }, /*#__PURE__*/React.createElement("circle", {
      cx: "20",
      cy: "20",
      r: r2,
      fill: "none",
      stroke: "rgb(var(--color-ring-bg) / 0.06)",
      strokeWidth: "3"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "20",
      cy: "20",
      r: r2,
      fill: "none",
      stroke: color,
      strokeWidth: "3",
      strokeLinecap: "round",
      strokeDasharray: c2,
      strokeDashoffset: off2
    })), /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-semibold font-headline"
    }, gap.label), /*#__PURE__*/React.createElement("span", {
      className: `text-xs ${isOver ? "text-orange-400" : "text-blue-400"}`
    }, isOver ? "Over limit" : "Below target"));
  })));
}

// ============================================================
// AISkeleton — renders inside the reserved food-log row shell
// ============================================================
function AISkeleton() {
  return /*#__PURE__*/React.createElement("div", {
    "data-testid": "ai-skeleton",
    "aria-busy": "true",
    "aria-label": "Estimating nutrition",
    className: "liquid-glass rounded-2xl px-4 py-3 flex items-center gap-3 min-h-[4.5rem]"
  }, /*#__PURE__*/React.createElement("span", {
    className: "shimmer-block w-8 h-8 rounded-full"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0 space-y-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "shimmer-block block h-3 w-2/5 rounded"
  }), /*#__PURE__*/React.createElement("span", {
    className: "shimmer-block block h-2.5 w-3/5 rounded"
  })));
}

// ============================================================
// HomeScreen
// ============================================================
function HomeScreen({
  onOpenLog,
  onTabChange
}) {
  const {
    runningTotals,
    gapsClosed,
    state,
    setState,
    apiKey,
    allRecipes
  } = useNutrition();
  const {
    showToast
  } = useToast();
  const [quickText, setQuickText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const gaps = useMemo(() => getOpenGaps(runningTotals), [runningTotals]);
  const handleAIEstimate = async () => {
    if (aiLoading) return;
    if (!quickText.trim()) return;
    if (!apiKey) {
      showToast({
        text: "Set your Claude API key in Settings first"
      });
      return;
    }
    setAiLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const trimmed = quickText.slice(0, MAX_QUICK_TEXT);
    const span = typeof window !== "undefined" && window.__tracer ? window.__tracer.startSpan("ai.request", {
      model: state.aiModel || "claude-sonnet-4-6",
      "input.length": trimmed.length
    }) : null;
    try {
      const sysPrompt = `You are a nutrition estimation assistant. Given a food description, respond with ONLY a JSON object containing these 16 nutrient keys with numeric values (no text, no markdown): ${NUTRIENT_KEYS.join(", ")}. Units: protein/carbs/fat/fiber/sat_fat in g, epa_dha/calcium/iron/zinc/potassium/magnesium/vit_c in mg, vit_d in IU, vit_e in mg, b12 in mcg, folate in mcg. Estimate reasonable values for a single serving.`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: state.aiModel || "claude-sonnet-4-6",
          max_tokens: 300,
          system: sysPrompt,
          messages: [{
            role: "user",
            content: trimmed
          }]
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.status === 429) throw new Error("Rate limited. Try again shortly.");
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const data = await resp.json();
      const text = data.content?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse AI response");
      const nutrients = JSON.parse(jsonMatch[0]);
      // validate
      for (const k of NUTRIENT_KEYS) {
        if (typeof nutrients[k] !== "number" || nutrients[k] < 0) nutrients[k] = 0;
      }
      const entryId = genId();
      const entry = {
        id: entryId,
        recipeId: null,
        name: trimmed.slice(0, 50),
        emoji: "\uD83E\uDD16",
        nutrients,
        ingredientStates: [],
        timestamp: Date.now()
      };
      setState(s => Modules.Log.addEntry(s, entry));
      showToast({
        text: `\uD83E\uDD16 ${entry.name}`,
        macros: nutrients,
        entryId
      });
      setQuickText("");
      if (span) span.end("ok", {
        "http.status_code": resp.status
      });
    } catch (err) {
      showToast({
        text: `AI error: ${err.message}`
      });
      if (span) span.end("error", {
        "error.message": String(err && err.message || err).slice(0, 120)
      });
    } finally {
      clearTimeout(timer);
      setAiLoading(false);
    }
  };
  const removeMeal = entryId => {
    setState(s => Modules.Log.removeEntry(s, entryId));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "pt-20 pb-28 px-4 space-y-6"
  }, /*#__PURE__*/React.createElement(ProgressRing, {
    closed: gapsClosed,
    total: 16
  }), /*#__PURE__*/React.createElement(FocusPoints, {
    gaps: gaps,
    runningTotals: runningTotals
  }), gaps.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => onTabChange("dashboard"),
    className: "w-full text-center text-sm text-primary-fixed-dim hover:text-white transition py-2"
  }, "View Full Report"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline text-lg font-bold"
  }, "Quick Entry"), /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-full flex items-center px-4 py-2 gap-2"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    className: "text-on-surface-variant",
    size: 20
  }), /*#__PURE__*/React.createElement("input", {
    type: "text",
    placeholder: "Describe what you ate...",
    value: quickText,
    onChange: e => setQuickText(e.target.value),
    onKeyDown: e => e.key === "Enter" && handleAIEstimate(),
    className: "flex-1 bg-transparent text-sm placeholder:text-on-surface-variant/50 font-body"
  }), quickText.trim() && /*#__PURE__*/React.createElement("button", {
    onClick: handleAIEstimate,
    disabled: aiLoading,
    className: "p-1.5 rounded-full bg-gradient-to-r from-blue-600 to-blue-400 hover:opacity-90 transition disabled:opacity-50"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: aiLoading ? "hourglass_empty" : "auto_awesome",
    size: 18,
    className: "text-white"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: onOpenLog,
    className: "p-1.5 rounded-full hover:bg-on-surface/10 transition"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "add_circle",
    size: 22,
    className: "text-blue-400",
    fill: true
  })))), (state.dayLog.length > 0 || aiLoading) && /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline text-lg font-bold"
  }, "Today's Meals"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2 min-h-[4.5rem]"
  }, aiLoading && /*#__PURE__*/React.createElement(AISkeleton, null), state.dayLog.map(entry => /*#__PURE__*/React.createElement("div", {
    key: entry.id,
    className: "liquid-glass rounded-2xl px-4 py-3 flex items-center gap-3 min-h-[4.5rem]"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl"
  }, entry.emoji), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold truncate"
  }, entry.name), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, Math.round(computeCalories(entry.nutrients)), " kcal", " \u00B7 ", "P:", Math.round(entry.nutrients.protein), "g", " C:", Math.round(entry.nutrients.carbs), "g", " F:", Math.round(entry.nutrients.fat), "g")), /*#__PURE__*/React.createElement("button", {
    onClick: () => removeMeal(entry.id),
    className: "text-on-surface-variant hover:text-error transition"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 18
  })))))), /*#__PURE__*/React.createElement(LogDayButton, null));
}

// ============================================================
// LogDayButton + Modal
// ============================================================
function LogDayButton() {
  const [showModal, setShowModal] = useState(false);
  const {
    state,
    gapsClosed
  } = useNutrition();
  if (state.dayLog.length === 0) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowModal(true),
    className: "w-full liquid-gradient rounded-full py-3.5 text-white font-semibold font-headline text-sm tracking-wide"
  }, "Log Day"), showModal && /*#__PURE__*/React.createElement(LogDayModal, {
    onClose: () => setShowModal(false)
  }));
}
function LogDayModal({
  onClose
}) {
  const {
    state,
    setState,
    gapsClosed,
    runningTotals
  } = useNutrition();
  const {
    showToast
  } = useToast();
  const [energy, setEnergy] = useState(3);
  const [digestion, setDigestion] = useState(3);
  const [notes, setNotes] = useState("");
  const handleLogDay = () => {
    const entry = Modules.History.buildEntry(state, {
      runningTotals,
      gapsClosed,
      energy,
      digestion,
      notes
    });
    const carry = Modules.Carryover.computeCarryover(state);
    setState(s => ({
      ...s,
      dayHistory: [...(s.dayHistory || []), entry],
      dayLog: [],
      currentDate: todayStr(),
      fatSolubleCarryover: carry.carryover,
      carryoverDaysRemaining: carry.daysRemaining
    }));
    showToast({
      text: `Day logged! ${gapsClosed}/16 gaps closed`
    });
    onClose();
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm"
  }), /*#__PURE__*/React.createElement("div", {
    className: "glass-sheet squircle p-6 w-full max-w-sm relative z-10 space-y-5",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline text-xl font-bold"
  }, "Log Day"), /*#__PURE__*/React.createElement("span", {
    className: "text-sm text-on-surface-variant"
  }, gapsClosed, "/16")), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-sm font-semibold font-label text-on-surface-variant"
  }, "Energy Level"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-5 gap-2"
  }, [1, 2, 3, 4, 5].map(v => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setEnergy(v),
    className: `py-3 rounded-3xl text-center font-semibold text-sm transition-all ${energy === v ? "bg-primary text-white scale-110 shadow-lg shadow-primary/30" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-variant"}`
  }, v)))), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-sm font-semibold font-label text-on-surface-variant"
  }, "Digestion"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-5 gap-2"
  }, ["LOW", "2", "3", "4", "HIGH"].map((label, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => setDigestion(i + 1),
    className: `py-3 rounded-3xl text-center font-semibold text-xs transition-all ${digestion === i + 1 ? "bg-primary text-white scale-110 shadow-lg shadow-primary/30" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-variant"}`
  }, label)))), /*#__PURE__*/React.createElement("textarea", {
    value: notes,
    onChange: e => setNotes(e.target.value),
    placeholder: "Notes (optional)...",
    rows: 3,
    className: "w-full bg-on-surface/5 rounded-2xl px-4 py-3 text-sm placeholder:text-on-surface-variant/40 resize-none font-body"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: handleLogDay,
    className: "w-full liquid-gradient rounded-full py-3.5 text-white font-semibold font-headline text-sm"
  }, "Log & Start New Day")));
}

// ============================================================
// LogDaySheet (Bottom Sheet)
// ============================================================
function LogDaySheet({
  onClose
}) {
  const {
    allRecipes,
    setState
  } = useNutrition();
  const {
    showToast
  } = useToast();
  const [tab, setTab] = useState("meals");
  const [selectedRecipes, setSelectedRecipes] = useState([]);
  const [ingredientStates, setIngredientStates] = useState([]);
  const [closing, setClosing] = useState(false);
  const selectedRecipe = selectedRecipes.length === 1 ? selectedRecipes[0] : null;
  const mealRecipes = useMemo(() => Object.entries(allRecipes).filter(([, r]) => r.type === "meal" || r.type === "snack" || r.type === "supplement_food"), [allRecipes]);
  const suppRecipes = useMemo(() => Object.entries(allRecipes).filter(([, r]) => r.type === "supplement"), [allRecipes]);
  const [checkedSupps, setCheckedSupps] = useState({});
  const handleSelectRecipe = id => {
    const recipe = allRecipes[id];
    if (!recipe) return;
    setSelectedRecipes(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (next.length === 1) {
        const r = allRecipes[next[0]];
        setIngredientStates(r.ingredients.map(ing => ({
          id: ing.id,
          qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
          swapGroup: ing.swapGroup
        })));
      } else {
        setIngredientStates([]);
      }
      return next;
    });
  };
  const updateIngQty = (idx, qty) => {
    setIngredientStates(prev => prev.map((s, i) => i === idx ? {
      ...s,
      qty: Math.max(0, qty)
    } : s));
  };
  const swapIngredient = (idx, newId) => {
    setIngredientStates(prev => prev.map((s, i) => i === idx ? {
      ...s,
      id: newId,
      qty: Modules.Catalog.getIngredient(newId)?.defaultQty || 1
    } : s));
  };
  const projectedNutrients = useMemo(() => {
    if (!selectedRecipe) return emptyNutrients();
    return Modules.Recipes.computeMealNutrients(allRecipes[selectedRecipe], ingredientStates);
  }, [selectedRecipe, ingredientStates, allRecipes]);
  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 300);
  };
  const handleConfirmMeal = () => {
    const mealEntries = selectedRecipes.map(rid => {
      const recipe = allRecipes[rid];
      if (!recipe) return null;
      const isSingle = selectedRecipes.length === 1;
      const ingStates = isSingle ? [...ingredientStates] : recipe.ingredients.map(ing => ({
        id: ing.id,
        qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
        swapGroup: ing.swapGroup
      }));
      const nutrients = isSingle ? projectedNutrients : Modules.Recipes.computeMealNutrients(recipe, ingStates);
      return {
        id: genId(),
        recipeId: rid,
        name: recipe.name,
        emoji: recipe.emoji,
        nutrients,
        ingredientStates: ingStates,
        timestamp: Date.now()
      };
    }).filter(Boolean);
    if (mealEntries.length > 0) {
      setState(s => Modules.Log.addEntries(s, mealEntries));
      if (mealEntries.length === 1) {
        const e = mealEntries[0];
        showToast({
          text: `${e.emoji} ${e.name}`,
          macros: e.nutrients,
          entryId: e.id
        });
      } else {
        showToast({
          text: `Added ${mealEntries.length} meals`
        });
      }
    }
    // Add checked supplements
    Object.entries(checkedSupps).forEach(([suppId, checked]) => {
      if (!checked) return;
      const recipe = allRecipes[suppId];
      if (!recipe) return;
      const entryId = genId();
      const entry = {
        id: entryId,
        recipeId: suppId,
        name: recipe.name,
        emoji: recipe.emoji,
        nutrients: {
          ...recipe.verifiedTotal
        },
        ingredientStates: recipe.ingredients.map(ing => ({
          id: ing.id,
          qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
          swapGroup: null
        })),
        timestamp: Date.now()
      };
      setState(s => Modules.Log.addEntry(s, entry));
    });
    if (Object.values(checkedSupps).some(Boolean)) {
      const count = Object.values(checkedSupps).filter(Boolean).length;
      showToast({
        text: `Added ${count} supplement${count > 1 ? "s" : ""}`
      });
    }
    handleClose();
  };
  const toggleSupp = id => {
    setCheckedSupps(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 animate-fade-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm",
    onClick: handleClose
  }), /*#__PURE__*/React.createElement("div", {
    className: `absolute bottom-0 left-0 right-0 bg-surface-container dark:bg-[#0a0a0a] modal-sheet max-h-[85vh] flex flex-col ${closing ? "animate-slide-down" : "animate-slide-up"}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-center pt-3 pb-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-10 h-1 rounded-full bg-on-surface/20"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between px-5 pb-3"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline text-lg font-bold"
  }, "Log Entry"), /*#__PURE__*/React.createElement("button", {
    onClick: handleClose,
    className: "p-1 hover:bg-on-surface/10 rounded-full transition"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 22
  }))), /*#__PURE__*/React.createElement("div", {
    className: "px-5 pb-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-on-surface/5 p-1 rounded-full flex"
  }, ["meals", "supplements"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setTab(t),
    className: `flex-1 py-2 rounded-full text-sm font-semibold font-label transition-all ${tab === t ? "pill-active text-white" : "text-on-surface-variant"}`
  }, t === "meals" ? "Meals" : "Supplements")))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto px-5 pb-24 space-y-4"
  }, tab === "meals" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, mealRecipes.map(([id, r]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => handleSelectRecipe(id),
    "aria-pressed": selectedRecipes.includes(id),
    className: `px-4 py-2 rounded-full text-sm font-label transition-all border ${selectedRecipes.includes(id) ? "border-primary/40 bg-primary/10 text-white" : "border-on-surface/10 bg-on-surface/5 text-on-surface-variant hover:border-on-surface/20"}`
  }, r.emoji, " ", r.name))), selectedRecipe && allRecipes[selectedRecipe] && /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-headline text-base font-semibold"
  }, "Ingredients"), ingredientStates.map((ing, idx) => {
    const ingData = Modules.Catalog.getIngredient(ing.id);
    if (!ingData) return null;
    return /*#__PURE__*/React.createElement("div", {
      key: idx,
      className: "liquid-glass p-4 rounded-3xl space-y-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-between"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-semibold"
    }, ingData.name), ing.swapGroup && Modules.Catalog.getSwapGroup(ing.swapGroup) && /*#__PURE__*/React.createElement(SwapDropdown, {
      group: ing.swapGroup,
      currentId: ing.id,
      onSwap: newId => swapIngredient(idx, newId)
    })), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("input", {
      type: "number",
      value: ing.qty,
      onChange: e => updateIngQty(idx, parseFloat(e.target.value) || 0),
      className: "w-20 bg-on-surface/5 rounded-xl px-3 py-1.5 text-sm text-center"
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-xs text-on-surface-variant"
    }, ingData.unit)));
  }), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-headline text-base font-semibold"
  }, "Projected Macros"), /*#__PURE__*/React.createElement("div", {
    className: "asymmetric-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-3xl p-4 flex flex-col justify-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-3xl font-headline font-extrabold"
  }, computeCalories(projectedNutrients)), /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-on-surface-variant mt-1"
  }, "kcal")), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-2xl p-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-on-surface-variant"
  }, "Protein"), /*#__PURE__*/React.createElement("p", {
    className: "font-semibold text-sm"
  }, Math.round(projectedNutrients.protein), "g")), /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-2xl p-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-on-surface-variant"
  }, "Carbs"), /*#__PURE__*/React.createElement("p", {
    className: "font-semibold text-sm"
  }, Math.round(projectedNutrients.carbs), "g"))))))), tab === "supplements" && /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, suppRecipes.map(([id, r]) => {
    const checked = !!checkedSupps[id];
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => toggleSupp(id),
      className: `flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all ${checked ? "liquid-glass" : "bg-on-surface/5 opacity-50"}`
    }, /*#__PURE__*/React.createElement(Icon, {
      name: checked ? "check_circle" : "radio_button_unchecked",
      size: 20,
      fill: checked,
      className: checked ? "text-primary-container" : "text-on-surface-variant"
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-label truncate"
    }, r.name));
  })), /*#__PURE__*/React.createElement(ClosingGaps, {
    suppRecipes: suppRecipes,
    checkedSupps: checkedSupps,
    onToggle: toggleSupp
  }))), /*#__PURE__*/React.createElement("div", {
    className: "absolute bottom-0 left-0 right-0 p-5 sheet-bottom-fade"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: handleConfirmMeal,
    disabled: selectedRecipes.length === 0 && !Object.values(checkedSupps).some(Boolean),
    className: "w-full pill-active rounded-full py-3.5 text-white font-semibold font-headline text-sm disabled:opacity-40 transition"
  }, selectedRecipes.length > 1 ? `Confirm Entry (${selectedRecipes.length})` : "Confirm Entry"))));
}

// ============================================================
// SwapDropdown
// ============================================================
function SwapDropdown({
  group,
  currentId,
  onSwap
}) {
  const [open, setOpen] = useState(false);
  const options = Modules.Catalog.getSwapGroup(group) || [];
  if (options.length <= 1) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(!open),
    className: "text-xs text-primary-fixed-dim hover:text-white transition font-label"
  }, "Change"), open && /*#__PURE__*/React.createElement("div", {
    className: "absolute right-0 top-6 z-20 bg-surface-container-highest rounded-xl border border-on-surface/10 shadow-xl overflow-hidden min-w-[160px]"
  }, options.map(optId => {
    const ing = Modules.Catalog.getIngredient(optId);
    if (!ing) return null;
    return /*#__PURE__*/React.createElement("button", {
      key: optId,
      onClick: () => {
        onSwap(optId);
        setOpen(false);
      },
      className: `w-full text-left px-4 py-2.5 text-sm hover:bg-on-surface/10 transition ${optId === currentId ? "text-primary-fixed-dim font-semibold" : "text-on-surface-variant"}`
    }, ing.name);
  })));
}

// ============================================================
// ClosingGaps (supplements that help close remaining gaps)
// ============================================================
function ClosingGaps({
  suppRecipes,
  checkedSupps,
  onToggle
}) {
  const {
    runningTotals
  } = useNutrition();
  const gaps = useMemo(() => getOpenGaps(runningTotals), [runningTotals]);
  const helpfulSupps = useMemo(() => {
    const result = [];
    for (const [id, r] of suppRecipes) {
      if (checkedSupps[id]) continue;
      const helps = gaps.filter(g => g.type === "under" && (r.verifiedTotal[g.key] || 0) > 0);
      if (helps.length > 0) result.push({
        id,
        name: r.name,
        helps: helps.map(h => h.label)
      });
    }
    return result;
  }, [suppRecipes, checkedSupps, gaps]);
  if (helpfulSupps.length === 0) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-headline text-sm font-semibold text-on-surface-variant"
  }, "Close remaining gaps"), helpfulSupps.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    onClick: () => onToggle(s.id),
    className: "w-full liquid-glass-light rounded-2xl px-4 py-3 flex items-center gap-3 text-left"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "add_circle",
    size: 18,
    className: "text-blue-400"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, s.name), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant truncate"
  }, "Helps: ", s.helps.join(", "))))));
}

// ============================================================
// DashboardScreen
// ============================================================
function DashboardScreen() {
  const {
    runningTotals
  } = useNutrition();
  const cals = computeCalories(runningTotals);
  const calPct = Math.min(100, Math.round(cals / CALORIE_TARGET * 100));
  return /*#__PURE__*/React.createElement("div", {
    className: "pt-20 pb-28 px-4 space-y-6"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "font-headline text-[34px] font-extrabold leading-tight"
  }, "Dashboard"), /*#__PURE__*/React.createElement("p", {
    className: "text-on-surface-variant text-sm mt-1"
  }, "Overview of your daily intake")), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "col-span-2 liquid-glass p-5 rounded-[24px]"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-sm text-on-surface-variant font-label"
  }, "Calories"), /*#__PURE__*/React.createElement("span", {
    className: "text-sm text-on-surface-variant"
  }, cals, " / ", CALORIE_TARGET, " kcal")), /*#__PURE__*/React.createElement("div", {
    className: "w-full h-3 rounded-full bg-on-surface/5 overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 progress-glow transition-all duration-500",
    style: {
      width: `${calPct}%`
    }
  })), /*#__PURE__*/React.createElement("p", {
    className: "font-headline text-3xl font-extrabold mt-3"
  }, cals), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, "kcal")), /*#__PURE__*/React.createElement(MacroCard, {
    label: "Protein",
    nutrientKey: "protein",
    color: "blue"
  }), /*#__PURE__*/React.createElement(MacroCard, {
    label: "Carbs",
    nutrientKey: "carbs",
    color: "green"
  })), /*#__PURE__*/React.createElement(NutrientGroup, {
    title: "Vitamins",
    keys: VITAMIN_KEYS,
    accent: "blue"
  }), /*#__PURE__*/React.createElement(NutrientGroup, {
    title: "Minerals",
    keys: MINERAL_KEYS,
    accent: "green"
  }), /*#__PURE__*/React.createElement(NutrientGroup, {
    title: "Additional",
    keys: ["fiber", "sat_fat", "epa_dha"],
    accent: "purple"
  }));
}
function MacroCard({
  label,
  nutrientKey,
  color
}) {
  const {
    runningTotals
  } = useNutrition();
  const val = runningTotals[nutrientKey] || 0;
  const status = getStatus(nutrientKey, val);
  const pct = Math.min(100, status.pct);
  const colorMap = {
    blue: "from-blue-600 to-blue-400",
    green: "from-green-600 to-green-400",
    purple: "from-purple-600 to-purple-400"
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass p-4 rounded-[24px] h-40 flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-on-surface-variant font-label"
  }, label), /*#__PURE__*/React.createElement("p", {
    className: "font-headline text-2xl font-bold mt-1"
  }, fmtVal(nutrientKey, val))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-on-surface-variant mb-1"
  }, getTargetStr(nutrientKey)), /*#__PURE__*/React.createElement("div", {
    className: "w-full h-2 rounded-full bg-on-surface/5 overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `h-full rounded-full bg-gradient-to-r ${colorMap[color]} transition-all duration-500`,
    style: {
      width: `${pct}%`
    }
  }))));
}
function NutrientGroup({
  title,
  keys,
  accent
}) {
  const {
    runningTotals
  } = useNutrition();
  const accentColor = accent === "green" ? "bg-green-400" : accent === "purple" ? "bg-purple-400" : "bg-blue-400";
  const barColor = accent === "green" ? "from-green-600 to-green-400" : accent === "purple" ? "from-purple-600 to-purple-400" : "from-blue-600 to-blue-400";
  return /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-[24px] overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 pt-5 pb-3"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline text-lg font-bold"
  }, title)), keys.map((k, i) => {
    const val = runningTotals[k] || 0;
    const status = getStatus(k, val);
    const pct = Math.min(100, status.pct);
    const icon = NUTRIENT_ICONS[k] || "science";
    return /*#__PURE__*/React.createElement("div", {
      key: k
    }, i > 0 && /*#__PURE__*/React.createElement("div", {
      className: "mx-4 h-[0.5px] bg-on-surface/5"
    }), /*#__PURE__*/React.createElement("div", {
      className: "px-5 py-3 flex items-center gap-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: `w-8 h-8 rounded-full ${accentColor}/20 flex items-center justify-center`
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 16,
      className: accentColor.replace("bg-", "text-")
    })), /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-between"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-label"
    }, NUTRIENT_LABELS[k]), /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-semibold"
    }, fmtVal(k, val))), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2 mt-1"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 h-1.5 rounded-full bg-on-surface/5 overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`,
      style: {
        width: `${pct}%`
      }
    })), /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] text-on-surface-variant whitespace-nowrap"
    }, getTargetStr(k))))));
  }));
}

// ============================================================
// InsightsScreen — Weekly Report Card + Nutrient Heatmap
// ============================================================

function heatmapColor(pct, isDark, isMaxType) {
  if (pct === null || pct === undefined) {
    return isDark ? "hsl(0,0%,18%)" : "hsl(0,0%,92%)";
  }
  // For "maximum" type (sat_fat): low = good (green), high = bad (red)
  var effective = isMaxType ? Math.max(0, 120 - pct) : Math.min(pct, 120);
  var hue = Math.max(0, Math.min(effective, 120)) / 120 * 130;
  if (isDark) {
    var sat = effective === 0 && !isMaxType ? 0 : 60;
    var light = effective === 0 && !isMaxType ? 18 : 25 + effective / 120 * 10;
    return "hsl(" + hue + "," + sat + "%," + light + "%)";
  }
  var sat = effective === 0 && !isMaxType ? 0 : 50;
  var light = effective === 0 && !isMaxType ? 92 : 82 - effective / 120 * 18;
  return "hsl(" + hue + "," + sat + "%," + light + "%)";
}
function InsightsScreen() {
  const {
    state,
    runningTotals,
    gapsClosed
  } = useNutrition();
  const [range, setRange] = useState(7);
  const [selectedCell, setSelectedCell] = useState(null);
  const isDark = state.themeMode === "dark" || state.themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  // Build days array from history + today
  const days = useMemo(() => Modules.Insights.buildDays(state, runningTotals, gapsClosed), [state.dayHistory, state.dayLog, state.currentDate, runningTotals, gapsClosed]);
  const sliced = useMemo(() => days.slice(-range), [days, range]);
  const heatmapGridStyle = useMemo(() => ({
    gridTemplateColumns: "72px repeat(" + sliced.length + ", minmax(20px, 36px))"
  }), [sliced.length]);

  // Report card stats
  const stats = useMemo(() => Modules.Insights.aggregate(sliced), [sliced]);

  // Heatmap data: nutrientKey -> array of { pct, value, date }
  const heatmapData = useMemo(() => Modules.Insights.buildHeatmap(sliced, isDark, heatmapColor), [sliced, isDark]);
  const formatShortDate = dateStr => {
    const d = new Date(dateStr + "T12:00:00");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate();
  };

  // Empty state
  if (days.length === 0) {
    return /*#__PURE__*/React.createElement("div", {
      className: "pt-20 pb-28 px-4 flex flex-col items-center justify-center min-h-[60vh]"
    }, /*#__PURE__*/React.createElement("div", {
      className: "liquid-glass rounded-[24px] p-8 text-center max-w-sm"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "monitoring",
      size: 48,
      className: "text-on-surface-variant mx-auto mb-4"
    }), /*#__PURE__*/React.createElement("h2", {
      className: "font-headline text-xl font-bold mb-2"
    }, "No Insights Yet"), /*#__PURE__*/React.createElement("p", {
      className: "text-on-surface-variant text-sm"
    }, "Log your first full day to start seeing nutrition trends and patterns here.")));
  }
  const groups = [{
    label: "Macros",
    keys: MACRO_KEYS
  }, {
    label: "Vitamins",
    keys: VITAMIN_KEYS
  }, {
    label: "Minerals",
    keys: MINERAL_KEYS
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "pt-20 pb-28 px-4 space-y-6"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "font-headline text-[34px] font-extrabold leading-tight"
  }, "Insights"), /*#__PURE__*/React.createElement("p", {
    className: "text-on-surface-variant text-sm mt-1"
  }, "Your nutrition trends", sliced.length < range && sliced.length > 0 && /*#__PURE__*/React.createElement("span", {
    className: "ml-1 opacity-60"
  }, "(", sliced.length, " of ", range, " days)"))), stats && /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-[24px] p-5 space-y-4"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline text-lg font-bold"
  }, "Report Card"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass-light rounded-2xl p-3 text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-2xl font-bold"
  }, sliced.length), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-on-surface-variant"
  }, "Days Logged")), /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass-light rounded-2xl p-3 text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-2xl font-bold"
  }, Math.round(stats.avgGaps * 10) / 10), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-on-surface-variant"
  }, "Avg Gaps Closed / 16")), /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass-light rounded-2xl p-3 text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-2xl font-bold"
  }, stats.avgEnergy !== null ? Math.round(stats.avgEnergy * 10) / 10 : "—"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-on-surface-variant"
  }, "Avg Energy")), /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass-light rounded-2xl p-3 text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-2xl font-bold"
  }, stats.avgDigestion !== null ? Math.round(stats.avgDigestion * 10) / 10 : "—"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-on-surface-variant"
  }, "Avg Digestion"))), stats.topHits.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-semibold text-on-surface-variant mb-2"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check_circle",
    size: 14,
    className: "text-green-500 mr-1 inline-block align-middle"
  }), "Consistently Hit"), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-1.5"
  }, stats.topHits.map(k => /*#__PURE__*/React.createElement("span", {
    key: k,
    className: "px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400"
  }, NUTRIENT_LABELS[k], " (", Math.round(stats.hitRate[k] * sliced.length), "/", sliced.length, ")")))), stats.chronicGaps.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-semibold text-on-surface-variant mb-2"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "warning",
    size: 14,
    className: "text-amber-500 mr-1 inline-block align-middle"
  }), "Chronic Gaps"), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-1.5"
  }, stats.chronicGaps.map(k => /*#__PURE__*/React.createElement("span", {
    key: k,
    className: "px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400"
  }, NUTRIENT_LABELS[k], " (", Math.round(stats.hitRate[k] * sliced.length), "/", sliced.length, ")"))))), /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass rounded-[24px] p-5 space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "font-headline text-lg font-bold"
  }, "Nutrient Heatmap"), /*#__PURE__*/React.createElement("div", {
    className: "flex bg-on-surface/5 rounded-full p-0.5 gap-0.5"
  }, [7, 14, 30].map(r => /*#__PURE__*/React.createElement("button", {
    key: r,
    className: `px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${range === r ? "bg-gradient-to-r from-blue-600 to-blue-400 text-white shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`,
    onClick: () => {
      setRange(r);
      setSelectedCell(null);
    }
  }, r, "d")))), selectedCell && /*#__PURE__*/React.createElement("div", {
    className: "liquid-glass-light rounded-xl p-3 text-sm flex items-center justify-between animate-fade-in"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "font-semibold"
  }, NUTRIENT_LABELS[selectedCell.key]), /*#__PURE__*/React.createElement("span", {
    className: "text-on-surface-variant ml-2"
  }, fmtVal(selectedCell.key, selectedCell.value), " / ", getTargetStr(selectedCell.key))), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-on-surface-variant"
  }, formatShortDate(selectedCell.date))), /*#__PURE__*/React.createElement("div", {
    "data-testid": "nutrient-heatmap",
    className: "overflow-x-auto -mx-1 px-1 min-h-[18rem]",
    style: {
      WebkitOverflowScrolling: "touch"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "heatmap-grid mb-1",
    style: heatmapGridStyle
  }, /*#__PURE__*/React.createElement("div", null), sliced.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "heatmap-date"
  }, sliced.length <= 14 ? formatShortDate(d.date).split(" ")[0] : new Date(d.date + "T12:00:00").getDate()))), groups.map((group, gi) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: group.label
  }, gi > 0 && /*#__PURE__*/React.createElement("div", {
    className: "h-2"
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1 pl-1"
  }, group.label), group.keys.map(k => {
    return /*#__PURE__*/React.createElement("div", {
      key: k,
      className: "heatmap-grid mb-0.5",
      style: heatmapGridStyle
    }, /*#__PURE__*/React.createElement("div", {
      className: "heatmap-label text-on-surface-variant"
    }, NUTRIENT_LABELS[k]), heatmapData[k].map((cell, ci) => /*#__PURE__*/React.createElement("div", {
      key: ci,
      className: "heatmap-cell cursor-pointer",
      style: {
        backgroundColor: cell.color
      },
      onClick: () => setSelectedCell(selectedCell && selectedCell.key === k && selectedCell.date === cell.date ? null : {
        key: k,
        value: cell.value,
        date: cell.date,
        pct: cell.pct
      }),
      title: NUTRIENT_LABELS[k] + ": " + fmtVal(k, cell.value)
    })));
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center gap-2 text-[10px] text-on-surface-variant pt-1"
  }, /*#__PURE__*/React.createElement("span", null, "Less"), [0, 25, 50, 75, 100].map(p => /*#__PURE__*/React.createElement("div", {
    key: p,
    className: "w-3.5 h-3.5 rounded-sm",
    style: {
      backgroundColor: heatmapColor(p, isDark, false)
    }
  })), /*#__PURE__*/React.createElement("span", null, "More"))));
}

// ============================================================
// SettingsScreen
// ============================================================
function SettingsScreen() {
  const {
    apiKey,
    setApiKey,
    state,
    setState
  } = useNutrition();
  const auth = useAuth();
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);
  const cloudSyncOn = !!state.cloudSync;
  const signedIn = auth && auth.status === "signed_in";
  const handleCloudSyncToggle = () => {
    if (cloudSyncOn) {
      // Turn off — keep session intact; user can re-enable without re-auth.
      setState(s => ({
        ...s,
        cloudSync: false
      }));
    } else {
      if (!auth || !auth.configured) {
        setSignInError("Cloud sync is not configured yet.");
        setShowSignIn(true);
        return;
      }
      if (signedIn) {
        setState(s => ({
          ...s,
          cloudSync: true
        }));
      } else {
        setSignInError("");
        setShowSignIn(true);
      }
    }
  };
  const handleSignInSubmit = async e => {
    e.preventDefault();
    setSignInError("");
    setSignInBusy(true);
    try {
      await auth.signIn(signInEmail.trim(), signInPassword);
      setState(s => ({
        ...s,
        cloudSync: true
      }));
      setShowSignIn(false);
      setSignInEmail("");
      setSignInPassword("");
    } catch (err) {
      setSignInError(err && err.message || "Sign-in failed.");
    } finally {
      setSignInBusy(false);
    }
  };
  const handleSignOut = async () => {
    try {
      await auth.signOut();
    } catch (_) {/* ignore */}
    setState(s => ({
      ...s,
      cloudSync: false
    }));
  };
  const maskedKey = apiKey ? "\u2022\u2022\u2022\u2022" + apiKey.slice(-4) : "Not set";
  const handleSaveKey = () => {
    setApiKey(keyInput);
    setEditingKey(false);
  };
  const handleExport = () => {
    const data = JSON.stringify({
      state,
      exportedAt: new Date().toISOString()
    }, null, 2);
    const blob = new Blob([data], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vitality-export-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleClear = () => {
    LocalStore.clearState();
    LocalStore.clearApiKey();
    setState({
      ...DEFAULT_STATE
    });
    setApiKey("");
    setShowClearConfirm(false);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "pt-20 pb-28 px-4 space-y-6"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "font-headline text-4xl font-extrabold"
  }, "Settings"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-1"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label"
  }, "Intelligence"), /*#__PURE__*/React.createElement("div", {
    className: "glass-card rounded-xl overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-3.5 flex items-center gap-3 min-h-[3.5rem]"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-blue-600/20 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 18,
    className: "text-blue-400"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, "Claude API Key"), editingKey ? /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mt-1"
  }, /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: keyInput,
    onChange: e => setKeyInput(e.target.value),
    placeholder: "sk-ant-...",
    className: "flex-1 bg-on-surface/5 rounded-lg px-3 py-1.5 text-xs font-mono",
    autoFocus: true
  }), /*#__PURE__*/React.createElement("button", {
    onClick: handleSaveKey,
    className: "text-xs text-primary-fixed-dim font-semibold"
  }, "Save"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setEditingKey(false);
      setKeyInput(apiKey);
    },
    className: "text-xs text-on-surface-variant"
  }, "Cancel")) : /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant font-mono"
  }, maskedKey)), !editingKey && /*#__PURE__*/React.createElement("button", {
    onClick: () => setEditingKey(true),
    className: "p-1 hover:bg-on-surface/10 rounded-lg transition"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "edit",
    size: 18,
    className: "text-on-surface-variant"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "mx-4 h-[0.5px] bg-on-surface/5"
  }), /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-3.5 flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-indigo-600/20 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "neurology",
    size: 18,
    className: "text-indigo-400"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, "AI Model"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, state.aiModel || "claude-sonnet-4-6"))))), /*#__PURE__*/React.createElement("div", {
    className: "space-y-1"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label"
  }, "Personalization"), /*#__PURE__*/React.createElement("div", {
    className: "glass-card rounded-xl overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-3.5 flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-purple-600/20 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "dark_mode",
    size: 18,
    className: "text-purple-400"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, "Theme")), /*#__PURE__*/React.createElement("div", {
    className: "flex bg-on-surface/5 rounded-full p-0.5 gap-0.5"
  }, ["Auto", "Light", "Dark"].map(label => /*#__PURE__*/React.createElement("button", {
    key: label,
    className: `px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${(state.themeMode || "dark") === label.toLowerCase() ? "pill-active text-white" : "text-on-surface-variant hover:text-white"}`,
    onClick: () => setState(s => ({
      ...s,
      themeMode: label.toLowerCase()
    }))
  }, label)))), /*#__PURE__*/React.createElement("div", {
    className: "mx-4 h-[0.5px] bg-on-surface/5"
  }), /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-3.5 flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-emerald-600/20 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "track_changes",
    size: 18,
    className: "text-emerald-400"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, "Nutrient Targets"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, "Customize goals")), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron_right",
    size: 20,
    className: "text-on-surface-variant"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "space-y-1"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label"
  }, "Cloud Sync"), /*#__PURE__*/React.createElement("div", {
    className: "glass-card rounded-xl overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-3.5 flex items-center gap-3 min-h-[3.5rem]"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-cyan-600/20 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: cloudSyncOn ? "cloud_done" : "cloud_off",
    size: 18,
    className: "text-cyan-400"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, "Cloud Sync"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, cloudSyncOn ? signedIn ? `Signed in as ${auth.user && auth.user.email}` : "Signed out" : "Off — data stays on this device")), /*#__PURE__*/React.createElement("button", {
    onClick: handleCloudSyncToggle,
    "data-testid": "cloud-sync-toggle",
    "aria-pressed": cloudSyncOn ? "true" : "false",
    className: `w-11 h-6 rounded-full transition-colors flex items-center px-0.5 ${cloudSyncOn ? "bg-blue-600" : "bg-on-surface/15"}`
  }, /*#__PURE__*/React.createElement("span", {
    className: `block w-5 h-5 rounded-full bg-white transition-transform ${cloudSyncOn ? "translate-x-5" : "translate-x-0"}`
  }))), cloudSyncOn && signedIn && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "mx-4 h-[0.5px] bg-on-surface/5"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: handleSignOut,
    "data-testid": "cloud-sync-signout",
    className: "w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-on-surface/5 transition"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-on-surface/5 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "logout",
    size: 18,
    className: "text-on-surface-variant"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, "Sign Out"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, "Disable cloud sync on this device")))))), /*#__PURE__*/React.createElement("div", {
    className: "space-y-1"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label"
  }, "Data & Privacy"), /*#__PURE__*/React.createElement("div", {
    className: "glass-card rounded-xl overflow-hidden"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: handleExport,
    className: "w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-on-surface/5 transition"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ios_share",
    size: 18,
    className: "text-blue-400"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold"
  }, "Export All Data"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, "Download as JSON"))), /*#__PURE__*/React.createElement("div", {
    className: "mx-4 h-[0.5px] bg-on-surface/5"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowClearConfirm(true),
    className: "w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-on-surface/5 transition"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-9 h-9 rounded-xl bg-error/20 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "delete",
    size: 18,
    className: "text-error"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm font-semibold text-error"
  }, "Clear All Data"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant"
  }, "Remove all stored data"))))), showSignIn && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in",
    "data-testid": "cloud-signin-modal"
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm",
    onClick: () => setShowSignIn(false)
  }), /*#__PURE__*/React.createElement("form", {
    onSubmit: handleSignInSubmit,
    className: "glass-sheet squircle p-6 w-full max-w-xs relative z-10 space-y-4",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-headline text-lg font-bold"
  }, "Sign in to Cloud Sync"), (!auth || !auth.configured) && /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-on-surface-variant",
    "data-testid": "cloud-signin-unconfigured"
  }, "Cloud sync is not configured yet. Ask the project owner to provision Supabase credentials."), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("input", {
    type: "email",
    placeholder: "Email",
    value: signInEmail,
    onChange: e => setSignInEmail(e.target.value),
    autoComplete: "email",
    required: true,
    disabled: !auth || !auth.configured || signInBusy,
    className: "w-full bg-on-surface/5 rounded-lg px-3 py-2 text-sm"
  }), /*#__PURE__*/React.createElement("input", {
    type: "password",
    placeholder: "Password",
    value: signInPassword,
    onChange: e => setSignInPassword(e.target.value),
    autoComplete: "current-password",
    required: true,
    disabled: !auth || !auth.configured || signInBusy,
    className: "w-full bg-on-surface/5 rounded-lg px-3 py-2 text-sm"
  })), signInError && /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-error",
    "data-testid": "cloud-signin-error"
  }, signInError), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-3"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => {
      setShowSignIn(false);
      setSignInError("");
    },
    className: "flex-1 py-2.5 rounded-full border border-on-surface/10 text-sm font-semibold hover:bg-on-surface/5 transition"
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    disabled: !auth || !auth.configured || signInBusy,
    className: "flex-1 py-2.5 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition disabled:opacity-50"
  }, signInBusy ? "Signing in…" : "Sign In")))), showClearConfirm && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm",
    onClick: () => setShowClearConfirm(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "glass-sheet squircle p-6 w-full max-w-xs relative z-10 space-y-4",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-headline text-lg font-bold"
  }, "Clear All Data?"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-on-surface-variant"
  }, "This will permanently delete all your logged meals, history, and settings. This cannot be undone."), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-3"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowClearConfirm(false),
    className: "flex-1 py-2.5 rounded-full border border-on-surface/10 text-sm font-semibold hover:bg-on-surface/5 transition"
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: handleClear,
    className: "flex-1 py-2.5 rounded-full bg-error text-white text-sm font-semibold hover:bg-error/80 transition"
  }, "Clear")))));
}

// ============================================================
// App
// ============================================================
function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [showLogSheet, setShowLogSheet] = useState(false);
  const handleTabChange = useCallback(tab => {
    if (tab === "home" && activeTab === "home" && !showLogSheet) {
      setShowLogSheet(true);
    } else {
      setActiveTab(tab);
    }
  }, [activeTab, showLogSheet]);
  return /*#__PURE__*/React.createElement(NutritionProvider, null, /*#__PURE__*/React.createElement(AuthProvider, null, /*#__PURE__*/React.createElement(ToastProvider, null, /*#__PURE__*/React.createElement(CloudSync, null), /*#__PURE__*/React.createElement(AppHeader, null), activeTab === "home" && /*#__PURE__*/React.createElement(HomeScreen, {
    onOpenLog: () => setShowLogSheet(true),
    onTabChange: handleTabChange
  }), activeTab === "dashboard" && /*#__PURE__*/React.createElement(DashboardScreen, null), activeTab === "insights" && /*#__PURE__*/React.createElement(InsightsScreen, null), activeTab === "settings" && /*#__PURE__*/React.createElement(SettingsScreen, null), showLogSheet && /*#__PURE__*/React.createElement(LogDaySheet, {
    onClose: () => setShowLogSheet(false)
  }), /*#__PURE__*/React.createElement(Toast, null), /*#__PURE__*/React.createElement(BottomNav, {
    activeTab: activeTab,
    onTabChange: handleTabChange
  }))));
}

// ============================================================
// Mount
// ============================================================
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/*#__PURE__*/React.createElement(App, null));
