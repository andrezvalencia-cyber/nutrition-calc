    const { useState, useEffect, useCallback, useMemo, useContext, createContext, useRef } = React;

    // ============================================================
    // Icon helper
    // ============================================================
    function Icon({ name, className = "", fill = false, size = 24 }) {
      const style = { fontSize: size, fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}` };
      return <span className={`material-symbols-outlined select-none ${className}`} style={style}>{name}</span>;
    }

    // ============================================================
    // NutritionContext
    // ============================================================
    const NutritionContext = createContext(null);

    function NutritionProvider({ children }) {
      const [state, setStateRaw] = useState(() => { const saved = LocalStore.loadState(); return saved ? { ...DEFAULT_STATE, ...saved } : { ...DEFAULT_STATE }; });
      const [apiKey, setApiKeyRaw] = useState(() => LocalStore.loadApiKey());

      const setState = useCallback((updater) => {
        setStateRaw((prev) => {
          const next = typeof updater === "function" ? updater(prev) : updater;
          return next;
        });
      }, []);

      // Persist state off the keystroke path: debounce 250ms and flush on unmount.
      const saveTimerRef = useRef(null);
      const latestStateRef = useRef(state);
      const didMountRef = useRef(false);
      useEffect(() => { latestStateRef.current = state; }, [state]);
      useEffect(() => {
        if (!didMountRef.current) { didMountRef.current = true; return; }
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

      const setApiKey = useCallback((key) => {
        setApiKeyRaw(key);
        LocalStore.saveApiKey(key);
      }, []);

      const allRecipes = useMemo(() => Modules.Recipes.getAllRecipes(), []);

      const runningTotals = useMemo(
        () => Modules.GapEngine.computeRunningTotals(state),
        [state.dayLog, state.fatSolubleCarryover]
      );

      const gapsClosed = useMemo(
        () => Modules.GapEngine.computeGapsClosed(runningTotals),
        [runningTotals]
      );

      // First-run onboarding: seed example templates once, then mark onboarded.
      // Always sets onboarded=true (even when seeding yields []) so the rejection
      // budget can never spin this into a re-seed loop. Guarded inside the updater
      // so React's double-invoke / reloads never double-seed.
      useEffect(() => {
        setState((s) => {
          if (s.onboarded) return s;
          const seeded = (s.templates && s.templates.length)
            ? s.templates
            : Modules.Templates.seedExamples(EXAMPLE_TEMPLATE_SPECS, allRecipes);
          return { ...s, templates: seeded, onboarded: true };
        });
      }, []);

      // One-time migration: convert static RECIPES + SUPPLEMENT_RECIPES into
      // editable templates stored in state.templates. Idempotent — checks
      // sourceRecipeId to avoid duplicating items on re-runs.
      useEffect(() => {
        setState((s) => {
          if (s._recipesMigrated) return s;
          const existing = s.templates || [];
          const existingSourceIds = new Set(existing.filter(t => t.sourceRecipeId).map(t => t.sourceRecipeId));
          const migrated = [];
          Object.entries(allRecipes).forEach(([key, recipe]) => {
            if (existingSourceIds.has(key)) return;
            const ingredientLines = (recipe.ingredients || []).map(ing => {
              const data = Modules.Catalog.getIngredient(ing.id);
              if (!data) return ing.id;
              return (data.defaultQty || 1) + (data.unit || "g") + " " + data.name;
            });
            migrated.push({
              id: genId(),
              name: recipe.name,
              emoji: recipe.emoji,
              type: recipe.type || "meal",
              ingredientText: ingredientLines.join("\n"),
              nutrients: recipe.verifiedTotal ? { ...recipe.verifiedTotal } : null,
              sourceRecipeId: key,
              refs: recipe.ingredients ? recipe.ingredients.map(ing => ({ id: ing.id, swapGroup: ing.swapGroup })) : [],
              createdAt: Date.now(),
            });
          });
          return { ...s, templates: existing.concat(migrated), _recipesMigrated: true };
        });
      }, []);

      const value = useMemo(() => ({
        state, setState, runningTotals, gapsClosed, allRecipes, apiKey, setApiKey,
      }), [state, setState, runningTotals, gapsClosed, allRecipes, apiKey, setApiKey]);

      return <NutritionContext.Provider value={value}>{children}</NutritionContext.Provider>;
    }

    function useNutrition() { return useContext(NutritionContext); }

    // ============================================================
    // Shared AI nutrient estimation
    // ============================================================
    async function estimateNutrients(text, apiKey, aiModel) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const trimmed = text.slice(0, MAX_QUICK_TEXT);
      try {
        const sysPrompt = `You are a nutrition estimation assistant. Given a list of food ingredients with quantities, respond with ONLY a JSON object containing these 16 nutrient keys with numeric values (no text, no markdown): ${NUTRIENT_KEYS.join(", ")}. Units: protein/carbs/fat/fiber/sat_fat in g, epa_dha/calcium/iron/zinc/potassium/magnesium/vit_c in mg, vit_d in IU, vit_e in mg, b12 in mcg, folate in mcg. Estimate the combined nutritional content of all listed ingredients.`;
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: aiModel || "claude-sonnet-4-6",
            max_tokens: 300,
            system: sysPrompt,
            messages: [{ role: "user", content: trimmed }],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (resp.status === 429) throw new Error("Rate limited. Try again shortly.");
        if (!resp.ok) throw new Error(`API error: ${resp.status}`);
        const data = await resp.json();
        const respText = data.content?.[0]?.text || "";
        const jsonMatch = respText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Could not parse AI response");
        const nutrients = JSON.parse(jsonMatch[0]);
        for (const k of NUTRIENT_KEYS) {
          if (typeof nutrients[k] !== "number" || !isFinite(nutrients[k]) || nutrients[k] < 0) nutrients[k] = 0;
        }
        return nutrients;
      } finally {
        clearTimeout(timer);
      }
    }

    const FOOD_EMOJIS = ["\u{1F37D}", "\u{1F964}", "\u{1F957}", "\u{1F372}", "\u{1F35C}", "\u{1F96A}", "\u{1F34E}", "\u{1F955}", "\u{1F48A}", "\u{1F41F}", "\u{1F95B}", "\u{1F330}", "\u{1F373}", "\u{1F356}"];

    // ============================================================
    // AuthContext (Phase 3 — UI only, no read/write yet)
    // ============================================================
    const AuthContext = createContext(null);

    function AuthProvider({ children }) {
      const Identity = window.Modules && window.Modules.Identity;
      const configured = !!(Identity && Identity.isConfigured());
      const [session, setSession] = useState(null);
      const [status, setStatus] = useState(configured ? "loading" : "unconfigured");

      useEffect(() => {
        if (!configured) return;
        let cancelled = false;
        Identity.getSession().then((s) => {
          if (cancelled) return;
          setSession(s);
          setStatus(s ? "signed_in" : "signed_out");
        }).catch(() => { if (!cancelled) setStatus("signed_out"); });
        const unsub = Identity.onAuthStateChange((s) => {
          setSession(s);
          setStatus(s ? "signed_in" : "signed_out");
        });
        return () => { cancelled = true; unsub && unsub(); };
      }, [configured]);

      const signIn = useCallback((email, password) => Identity.signIn(email, password), [Identity]);
      const signOut = useCallback(() => Identity.signOut(), [Identity]);

      const value = useMemo(() => ({
        configured, status, session, user: (session && session.user) || null,
        signIn, signOut,
      }), [configured, status, session, signIn, signOut]);

      return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
    }

    function useAuth() { return useContext(AuthContext); }

    // ============================================================
    // CloudSync — Phase 4 hydration + Phase 6 multi-tab leader election
    //
    // Runs once per mount when (cloudSync toggle on) AND (signed in) AND
    // (RemoteStore available). Defers actual work to requestIdleCallback
    // so LCP is not blocked.
    //
    // Phase 6: only the elected leader tab fetches from RemoteStore.
    // Followers wait for the leader's payload via SyncLeader.onPayload()
    // and apply the same append-only merge — zero extra network reads.
    // Carryover values never cross the wire; each tab keeps using
    // Modules.Carryover.computeCarryover() locally at Log Day time.
    //
    // Merge is append-only:
    //   - dayHistory dedup by date
    //   - dayLog dedup by id (cloud rows use idempotency_key, local rows use
    //     genId(); the two namespaces never collide).
    // No deletes or overwrites in this phase — Phase 5 introduces LWW.
    // ============================================================
    function applyHydration(setState, days, entries) {
      setState((s) => Modules.SyncMap.mergeHydration(s, days, entries));
    }

    function CloudSync() {
      const { state, setState } = useNutrition();
      const auth = useAuth();
      const ranRef = useRef(false);

      useEffect(() => {
        if (ranRef.current) return;
        if (!state.cloudSync) return;
        if (!auth || auth.status !== "signed_in" || !auth.user) return;
        if (!window.RemoteStore || !window.RemoteStore.isAvailable()) return;
        ranRef.current = true;

        const userId = auth.user.id;
        const SL = window.SyncLeader;

        const run = () => {
          // No SyncLeader (very old browsers): fall back to per-tab fetch.
          if (!SL || typeof SL.whenReady !== "function") {
            Promise.all([
              window.RemoteStore.fetchDays(userId),
              window.RemoteStore.fetchEntries(userId, state.currentDate),
            ]).then(([days, entries]) => applyHydration(setState, days, entries))
              .catch((err) => console.warn("Cloud hydration failed:", err && err.message));
            return;
          }

          SL.whenReady().then(({ role }) => {
            if (role === "leader") {
              Promise.all([
                window.RemoteStore.fetchDays(userId),
                window.RemoteStore.fetchEntries(userId, state.currentDate),
              ]).then(([days, entries]) => {
                applyHydration(setState, days, entries);
                SL.broadcastPayload({ days: days, entries: entries, userId: userId, ts: Date.now() });
              }).catch((err) => {
                console.warn("Cloud hydration failed:", err && err.message);
              });
            } else {
              // Follower: wait for the leader's payload. Discard payloads
              // for a different account (rare race during sign-in churn).
              SL.onPayload((payload) => {
                if (!payload || payload.userId !== userId) return;
                applyHydration(setState, payload.days || [], payload.entries || []);
              });
            }
          });
        };

        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(run, { timeout: 1500 });
        } else {
          setTimeout(run, 0);
        }
      }, [state.cloudSync, auth && auth.status, auth && auth.user, state.currentDate, setState]);

      return null;
    }

    // ============================================================
    // Phase 5 — WriteBehind helpers (delegated to Modules.SyncMap)
    // ============================================================

    function buildEntryRow(entry, userId, dayDate) {
      return Modules.SyncMap.buildEntryRow(entry, userId, dayDate);
    }

    function buildDayRow(histEntry, carryover, userId) {
      return Modules.SyncMap.buildDayRow(histEntry, carryover, userId);
    }

    function isSyncEnabled(auth, state) {
      return Modules.SyncMap.isSyncEnabled(auth, state, !!window.WriteBehind);
    }

    // ============================================================
    // Toast Context
    // ============================================================
    const ToastContext = createContext(null);

    function ToastProvider({ children }) {
      const [toast, setToast] = useState(null);
      const timerRef = useRef(null);

      const showToast = useCallback((msg) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToast({ ...msg, exiting: false });
        timerRef.current = setTimeout(() => {
          setToast((t) => t ? { ...t, exiting: true } : null);
          setTimeout(() => setToast(null), 300);
        }, 8000);
      }, []);

      const dismissToast = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToast((t) => t ? { ...t, exiting: true } : null);
        setTimeout(() => setToast(null), 300);
      }, []);

      // Show a retry toast when a queued write exhausts all retries.
      useEffect(() => {
        const handler = () => showToast({ text: "Could not save — tap to retry" });
        window.addEventListener("wbq:failed", handler);
        return () => window.removeEventListener("wbq:failed", handler);
      }, [showToast]);

      return (
        <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
          {children}
        </ToastContext.Provider>
      );
    }

    function useToast() { return useContext(ToastContext); }

    // ============================================================
    // Toast Component
    // ============================================================
    function Toast() {
      const { toast, dismissToast } = useToast();
      const { setState } = useNutrition();
      if (!toast) return null;

      const handleUndo = () => {
        if (toast.entryId) {
          setState((s) => Modules.Log.removeEntry(s, toast.entryId));
        }
        dismissToast();
      };

      return (
        <div className={`fixed bottom-24 left-4 right-4 z-[60] flex justify-center ${toast.exiting ? "toast-exit" : "toast-enter"}`}>
          <div className="liquid-glass rounded-2xl px-5 py-3 flex items-center gap-3 max-w-sm w-full">
            <span className="text-sm flex-1 truncate">{toast.text}</span>
            {toast.macros && (
              <span className="text-xs text-on-surface-variant whitespace-nowrap">
                P:{Math.round(toast.macros.protein)} C:{Math.round(toast.macros.carbs)} F:{Math.round(toast.macros.fat)}
              </span>
            )}
            {toast.entryId && (
              <button onClick={handleUndo} className="text-xs font-semibold text-primary-fixed-dim hover:text-white transition">
                Undo
              </button>
            )}
          </div>
        </div>
      );
    }

    // ============================================================
    // BottomNav
    // ============================================================
    function BottomNav({ activeTab, onTabChange }) {
      const tabs = [
        { id: "home", icon: "add_circle", label: "Log" },
        { id: "dashboard", icon: "bar_chart", label: "Dashboard" },
        { id: "insights", icon: "monitoring", label: "Insights" },
        { id: "settings", icon: "settings", label: "Settings" },
      ];
      return (
        <nav data-testid="bottom-nav" className="fixed left-1/2 -translate-x-1/2 z-50" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="liquid-glass rounded-full px-2 py-2 flex items-center gap-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-full transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-r from-blue-600 to-blue-400 text-white shadow-lg shadow-blue-500/20"
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  <Icon name={tab.icon} fill={active} size={22} />
                  {active && <span className="text-sm font-semibold font-label">{tab.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>
      );
    }

    // ============================================================
    // AppHeader
    // ============================================================
    function AppHeader() {
      const { state } = useNutrition();
      const auth = useAuth();
      const cloudOn = !!state.cloudSync;
      const signedIn = auth && auth.status === "signed_in";
      // Dimmed until Phase 4 (no data flowing yet); active = sync toggle on AND signed in.
      const indicatorActive = cloudOn && signedIn;
      const indicatorLabel = !cloudOn ? "Cloud sync off" : (signedIn ? "Cloud sync on" : "Cloud sync — signed out");
      return (
        <header className="fixed top-0 left-0 right-0 z-30 h-16 bg-surface/80 backdrop-blur-3xl flex items-center px-5">
          <div className="flex items-center gap-2">
            <Icon name="bubble_chart" className="text-blue-500" size={28} fill />
            <span className="font-headline text-2xl font-extrabold tracking-tighter text-blue-500">Vitality</span>
          </div>
          <div
            className="ml-auto flex items-center gap-1.5 text-xs"
            data-testid="cloud-sync-indicator"
            data-active={indicatorActive ? "true" : "false"}
            title={indicatorLabel}
            aria-label={indicatorLabel}
          >
            <Icon
              name={indicatorActive ? "cloud_done" : "cloud_off"}
              size={18}
              className={indicatorActive ? "text-blue-400" : "text-on-surface-variant/40"}
            />
          </div>
        </header>
      );
    }

    // ============================================================
    // ProgressRing
    // ============================================================
    function ProgressRing({ closed, total }) {
      const pct = total > 0 ? closed / total : 0;
      const r = 45;
      const circ = 2 * Math.PI * r; // ~282.7
      const offset = circ * (1 - pct);

      return (
        <div className="relative flex items-center justify-center mx-auto" style={{ width: 264, height: 264 }}>
          <div className="absolute inset-0 liquid-glass rounded-full" />
          <svg width="264" height="264" viewBox="0 0 100 100" className="relative z-10 -rotate-90">
            <defs>
              <linearGradient id="primaryGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0058bc" />
                <stop offset="100%" stopColor="#0070eb" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--color-ring-bg) / 0.05)" strokeWidth="6" />
            <circle
              cx="50" cy="50" r={r} fill="none"
              stroke="url(#primaryGradient)" strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 0.8s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
            <span className="font-headline text-6xl font-extrabold tracking-tight">{closed}/{total}</span>
            <span className="text-on-surface-variant font-semibold text-xs mt-2 flex items-center gap-1">
              {closed === total
                ? <><Icon name="check_circle" fill size={14} className="text-green-400" /> All Goals Met</>
                : "Goals Reached"}
            </span>
          </div>
          <div className="specular-highlight" style={{ top: 24, right: 80 }} />
        </div>
      );
    }

    // ============================================================
    // MacroIndicator — radial progress for one macro vs its daily target
    // ============================================================
    function MacroIndicator({ macro, label, consumed, profile, gradientId, gradientStops, testId }) {
      const resolved = Modules.Fallbacks.resolveTarget(
        macro, profile, { defaults: FALLBACK_DEFAULTS, unity: 1.0 }
      );
      const target = resolved > 0 ? resolved : 1.0;
      const raw = (consumed / target) * 100;
      const pct = Number.isFinite(raw) ? Math.round(raw) : 0;
      const fill = Math.max(0, Math.min(100, pct));
      const r = 26, circ = 2 * Math.PI * r, offset = circ * (1 - fill / 100);
      const u = NUTRIENT_UNITS[macro];
      return (
        <div data-testid={testId} className="liquid-glass rounded-3xl p-5 flex items-center gap-4"
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill}
          aria-valuetext={`${pct}%`} aria-label={`${label}: ${pct}% of daily target`}>
          <div className="relative" style={{ width: 72, height: 72 }}>
            <svg width="72" height="72" viewBox="0 0 64 64" className="-rotate-90">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">{gradientStops}</linearGradient>
              </defs>
              <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(var(--color-ring-bg) / 0.06)" strokeWidth="5" />
              <circle cx="32" cy="32" r={r} fill="none" stroke={`url(#${gradientId})`} strokeWidth="5"
                strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
                style={{ transition: "stroke-dashoffset 0.8s ease" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span data-testid={`${testId}-pct`} className="text-sm font-bold font-headline">{pct}%</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold font-headline">{label}</span>
            <span data-testid={`${testId}-detail`} className="text-xs text-on-surface-variant">
              {Math.round(consumed)}{u} / {Math.round(target)}{u}
            </span>
          </div>
        </div>
      );
    }

    // ============================================================
    // FocusPoints
    // ============================================================
    function FocusPoints({ gaps, runningTotals }) {
      const shown = gaps.slice(0, 4);
      if (shown.length === 0) return (
        <div className="text-center py-6">
          <Icon name="check_circle" className="text-green-400" size={32} fill />
          <p className="text-on-surface-variant text-sm mt-2">All gaps closed for today</p>
        </div>
      );

      return (
        <div className="space-y-4">
          <div className="flex justify-between items-end px-2">
            <h2 className="font-headline font-bold text-xl text-on-surface">Focus Points</h2>
            <span className="text-on-surface-variant text-xs font-medium">Daily Highlights</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
          {shown.map((gap) => {
            const st = getStatus(gap.key, runningTotals[gap.key] || 0);
            const pctVal = Math.min(100, st.pct);
            const isOver = gap.type === "over";
            const color = isOver ? "#f97316" : "#3b82f6";
            const r2 = 16;
            const c2 = 2 * Math.PI * r2;
            const off2 = c2 * (1 - pctVal / 100);

            return (
              <div key={gap.key} className="liquid-glass p-6 rounded-3xl flex flex-col gap-3">
                <svg width="36" height="36" viewBox="0 0 40 40" className="-rotate-90">
                  <circle cx="20" cy="20" r={r2} fill="none" stroke="rgb(var(--color-ring-bg) / 0.06)" strokeWidth="3" />
                  <circle
                    cx="20" cy="20" r={r2} fill="none"
                    stroke={color} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={c2} strokeDashoffset={off2}
                  />
                </svg>
                <span className="text-sm font-semibold font-headline">{gap.label}</span>
                <span className={`text-xs ${isOver ? "text-orange-400" : "text-blue-400"}`}>
                  {isOver ? "Over limit" : "Below target"}
                </span>
              </div>
            );
          })}
          </div>
        </div>
      );
    }

    // ============================================================
    // AISkeleton — renders inside the reserved food-log row shell
    // ============================================================
    function AISkeleton() {
      return (
        <div
          data-testid="ai-skeleton"
          aria-busy="true"
          aria-label="Estimating nutrition"
          className="liquid-glass rounded-2xl px-4 py-3 flex items-center gap-3 min-h-[4.5rem]"
        >
          <span className="shimmer-block w-8 h-8 rounded-full" />
          <div className="flex-1 min-w-0 space-y-2">
            <span className="shimmer-block block h-3 w-2/5 rounded" />
            <span className="shimmer-block block h-2.5 w-3/5 rounded" />
          </div>
        </div>
      );
    }

    // ============================================================
    // CameraScanModal
    // ============================================================
    function CameraScanModal({ onDecode, onClose }) {
      const [denied, setDenied] = useState(false);
      const [starting, setStarting] = useState(true);
      const viewportRef = useRef(null);

      useEffect(() => {
        let cancelled = false;
        const Scanner = window.Modules && window.Modules.Scanner;
        if (!Scanner) { setDenied(true); setStarting(false); return; }

        Scanner.requestCamera()
          .then(() => {
            if (cancelled) return;
            return Scanner.start("scanner-viewport", {
              onDecode: (text) => {
                if (!cancelled) onDecode(text);
              },
            });
          })
          .then(() => { if (!cancelled) setStarting(false); })
          .catch(() => { if (!cancelled) { setDenied(true); setStarting(false); } });

        return () => {
          cancelled = true;
          if (Scanner) Scanner.stop();
        };
      }, []);

      return (
        <div className="fixed inset-0 z-[60] animate-fade-in">
          <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <div className="absolute bottom-0 left-0 right-0 bg-surface-container dark:bg-[#0a0a0a] modal-sheet max-h-[85vh] flex flex-col animate-slide-up">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-on-surface/20" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3">
              <h2 className="font-headline text-lg font-bold">Scan Barcode</h2>
              <button onClick={onClose} className="p-1 hover:bg-on-surface/10 rounded-full transition">
                <Icon name="close" size={22} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-8">
              {denied ? (
                <div data-testid="scanner-denied" className="text-center py-8 space-y-3">
                  <Icon name="videocam_off" size={48} className="text-on-surface-variant mx-auto" />
                  <p className="text-sm text-on-surface-variant">Camera access denied or unavailable.</p>
                  <button
                    onClick={() => { setDenied(false); setStarting(true); window.Modules.Scanner.requestCamera().then(() => window.Modules.Scanner.start("scanner-viewport", { onDecode })).then(() => setStarting(false)).catch(() => setDenied(true)); }}
                    className="text-sm text-blue-400 hover:underline"
                  >Try again</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {starting && <p className="text-sm text-on-surface-variant text-center">Starting camera…</p>}
                  <div id="scanner-viewport" className="w-full rounded-xl overflow-hidden" style={{ minHeight: 280 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // HomeScreen
    // ============================================================
    function HomeScreen({ onOpenLog, onTabChange }) {
      const { runningTotals, gapsClosed, state, setState, apiKey, allRecipes } = useNutrition();
      const { showToast } = useToast();
      const auth = useAuth();
      const [quickText, setQuickText] = useState("");
      const [aiLoading, setAiLoading] = useState(false);
      const [showScanner, setShowScanner] = useState(false);
      const gaps = useMemo(() => getOpenGaps(runningTotals), [runningTotals]);

      const handleAIEstimate = async () => {
        if (aiLoading) return;
        if (!quickText.trim()) return;
        if (!apiKey) {
          showToast({ text: "Set your Claude API key in Settings first" });
          return;
        }
        setAiLoading(true);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const trimmed = quickText.slice(0, MAX_QUICK_TEXT);
        const span = (typeof window !== "undefined" && window.__tracer)
          ? window.__tracer.startSpan("ai.request", {
              model: state.aiModel || "claude-sonnet-4-6",
              "input.length": trimmed.length,
            })
          : null;
        try {
          const sysPrompt = `You are a nutrition estimation assistant. Given a food description, respond with ONLY a JSON object containing these 16 nutrient keys with numeric values (no text, no markdown): ${NUTRIENT_KEYS.join(", ")}. Units: protein/carbs/fat/fiber/sat_fat in g, epa_dha/calcium/iron/zinc/potassium/magnesium/vit_c in mg, vit_d in IU, vit_e in mg, b12 in mcg, folate in mcg. Estimate reasonable values for a single serving.`;
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
              model: state.aiModel || "claude-sonnet-4-6",
              max_tokens: 300,
              system: sysPrompt,
              messages: [{ role: "user", content: trimmed }],
            }),
            signal: controller.signal,
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
            timestamp: Date.now(),
          };
          setState((s) => Modules.Log.addEntry(s, entry));
          if (isSyncEnabled(auth, state)) {
            window.WriteBehind.enqueue({
              table: "day_entries", op: "upsert",
              payload: buildEntryRow(entry, auth.user.id, state.currentDate),
              rollback: () => setState((s) => Modules.Log.removeEntry(s, entry.id)),
            });
          }
          showToast({ text: `\uD83E\uDD16 ${entry.name}`, macros: nutrients, entryId });
          setQuickText("");
          if (span) span.end("ok", { "http.status_code": resp.status });
        } catch (err) {
          showToast({ text: `AI error: ${err.message}` });
          if (span) span.end("error", { "error.message": String(err && err.message || err).slice(0, 120) });
        } finally {
          clearTimeout(timer);
          setAiLoading(false);
        }
      };

      const removeMeal = (entryId) => {
        const entry = state.dayLog.find((e) => e.id === entryId);
        setState((s) => Modules.Log.removeEntry(s, entryId));
        if (isSyncEnabled(auth, state) && entry) {
          window.WriteBehind.enqueue({
            table: "day_entries", op: "delete",
            payload: { idempotency_key: entry.id, user_id: auth.user.id },
            rollback: () => setState((s) => Modules.Log.addEntry(s, entry)),
          });
        }
      };

      return (
        <div className="pt-20 pb-28 px-4 space-y-6">
          <ProgressRing closed={gapsClosed} total={16} />

          {/* Quick Entry */}
          <div className="space-y-3">
            <h2 className="font-headline text-lg font-bold">Quick Entry</h2>
            <div className="liquid-glass rounded-full flex items-center px-4 py-2 gap-2">
              <Icon name="search" className="text-on-surface-variant" size={20} />
              <input
                type="text"
                placeholder="Describe what you ate..."
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAIEstimate()}
                className="flex-1 bg-transparent text-sm placeholder:text-on-surface-variant/50 font-body"
              />
              {quickText.trim() && (
                <button
                  onClick={handleAIEstimate}
                  disabled={aiLoading}
                  className="p-1.5 rounded-full bg-gradient-to-r from-blue-600 to-blue-400 hover:opacity-90 transition disabled:opacity-50"
                >
                  <Icon name={aiLoading ? "hourglass_empty" : "auto_awesome"} size={18} className="text-white" />
                </button>
              )}
              {window.Modules && window.Modules.Scanner && window.Modules.Scanner.isSupported() && (
                <button
                  data-testid="scan-camera"
                  onClick={() => setShowScanner(true)}
                  className="p-1.5 rounded-full hover:bg-on-surface/10 transition"
                >
                  <Icon name="barcode_scanner" size={22} className="text-blue-400" />
                </button>
              )}
              <button onClick={onOpenLog} data-testid="quick-entry-button" aria-label="Quick log entry" className="p-1.5 rounded-full hover:bg-on-surface/10 transition">
                <Icon name="add_circle" size={22} className="text-blue-400" fill />
              </button>
            </div>
          </div>

          <FocusPoints gaps={gaps} runningTotals={runningTotals} />

          {gaps.length > 0 && (
            <button
              onClick={() => onTabChange("dashboard")}
              className="w-full text-center text-sm text-primary-fixed-dim hover:text-white transition py-2"
            >
              View Full Report
            </button>
          )}

          {showScanner && (
            <CameraScanModal
              onDecode={(text) => { setQuickText(text.slice(0, MAX_QUICK_TEXT)); setShowScanner(false); }}
              onClose={() => setShowScanner(false)}
            />
          )}

          {/* Today's Meals */}
          {(state.dayLog.length > 0 || aiLoading) && (
            <div className="space-y-3">
              <h2 className="font-headline text-lg font-bold">Today's Meals</h2>
              <div className="space-y-2 min-h-[4.5rem]">
                {aiLoading && <AISkeleton />}
                {state.dayLog.map((entry) => (
                  <div key={entry.id} className="liquid-glass rounded-2xl px-4 py-3 flex items-center gap-3 min-h-[4.5rem]">
                    <span className="text-2xl">{entry.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{entry.name}</p>
                      <p className="text-xs text-on-surface-variant">
                        {Math.round(computeCalories(entry.nutrients))} kcal
                        {" \u00B7 "}P:{Math.round(entry.nutrients.protein)}g
                        {" C:"}
                        {Math.round(entry.nutrients.carbs)}g
                        {" F:"}
                        {Math.round(entry.nutrients.fat)}g
                      </p>
                    </div>
                    <button onClick={() => removeMeal(entry.id)} className="text-on-surface-variant hover:text-error transition">
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Log Day Button */}
          <LogDayButton />
        </div>
      );
    }

    // ============================================================
    // LogDayButton + Modal
    // ============================================================
    function LogDayButton() {
      const [showModal, setShowModal] = useState(false);
      const { state, gapsClosed } = useNutrition();

      if (state.dayLog.length === 0) return null;

      return (
        <>
          <button
            onClick={() => setShowModal(true)}
            className="w-full liquid-gradient rounded-full py-3.5 text-white font-semibold font-headline text-sm tracking-wide"
          >
            Log Day
          </button>
          {showModal && <LogDayModal onClose={() => setShowModal(false)} />}
        </>
      );
    }

    function LogDayModal({ onClose }) {
      const { state, setState, gapsClosed, runningTotals } = useNutrition();
      const { showToast } = useToast();
      const auth = useAuth();
      const [energy, setEnergy] = useState(3);
      const [digestion, setDigestion] = useState(3);
      const [notes, setNotes] = useState("");

      const handleLogDay = () => {
        const entry = Modules.History.buildEntry(state, {
          runningTotals, gapsClosed, energy, digestion, notes,
        });
        const carry = Modules.Carryover.computeCarryover(state);
        setState((s) => ({
          ...s,
          dayHistory: [...(s.dayHistory || []), entry],
          dayLog: [],
          currentDate: todayStr(),
          fatSolubleCarryover: carry.carryover,
          carryoverDaysRemaining: carry.daysRemaining,
        }));
        if (isSyncEnabled(auth, state)) {
          window.WriteBehind.enqueue({
            table: "days", op: "upsert",
            payload: buildDayRow(entry, carry.carryover, auth.user.id),
            immediate: true,
          });
        }
        showToast({ text: `Day logged! ${gapsClosed}/16 gaps closed` });
        onClose();
      };

      return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 animate-fade-in" onClick={onClose}>
          <div className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm" />
          <div className="glass-sheet squircle p-6 w-full max-w-sm relative z-10 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-xl font-bold">Log Day</h2>
              <span className="text-sm text-on-surface-variant">{gapsClosed}/16</span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold font-label text-on-surface-variant">Energy Level</label>
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    onClick={() => setEnergy(v)}
                    className={`py-3 rounded-3xl text-center font-semibold text-sm transition-all ${
                      energy === v
                        ? "bg-primary text-white scale-110 shadow-lg shadow-primary/30"
                        : "bg-surface-container-high text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >{v}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold font-label text-on-surface-variant">Digestive Comfort</label>
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    onClick={() => setDigestion(v)}
                    className={`py-3 rounded-3xl text-center font-semibold text-sm transition-all ${
                      digestion === v
                        ? "bg-primary text-white scale-110 shadow-lg shadow-primary/30"
                        : "bg-surface-container-high text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >{v}</button>
                ))}
              </div>
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any specific meals to note?"
              rows={3}
              className="w-full bg-on-surface/5 rounded-2xl px-4 py-3 text-sm placeholder:text-on-surface-variant/40 resize-none font-body"
            />

            <button
              onClick={handleLogDay}
              className="w-full liquid-gradient rounded-full py-3.5 text-white font-semibold font-headline text-sm"
            >
              Log & Start New Day
            </button>
          </div>
        </div>
      );
    }

    // ============================================================
    // LogDaySheet (Bottom Sheet)
    // ============================================================
    function LogDaySheet({ onClose }) {
      const { allRecipes, setState, state } = useNutrition();
      const { showToast } = useToast();
      const auth = useAuth();
      const [tab, setTab] = useState("meals");
      const [selectedRecipes, setSelectedRecipes] = useState([]);
      const [ingredientStates, setIngredientStates] = useState([]);
      const [closing, setClosing] = useState(false);
      const selectedRecipe = selectedRecipes.length === 1 ? selectedRecipes[0] : null;

      // ── Search ──────────────────────────────────────────────────────────────
      const [query, setQuery] = useState("");
      const searchRef = useRef(null);

      // ── Scanner ─────────────────────────────────────────────────────────────
      const [showScanner, setShowScanner] = useState(false);
      const scannerSupported = !!(window.Modules && window.Modules.Scanner && window.Modules.Scanner.isSupported());

      // ── Custom Food wizard ──────────────────────────────────────────────────
      const [wizardOpen, setWizardOpen] = useState(false);
      const [wizardEdit, setWizardEdit] = useState(null);
      const [wizardName, setWizardName] = useState("");
      const [wizardEmoji, setWizardEmoji] = useState("\u{1F372}");
      const [wizardNutrients, setWizardNutrients] = useState(() => emptyNutrients());
      const [wizardBarcode, setWizardBarcode] = useState(null);
      const [wizardReplaceId, setWizardReplaceId] = useState(null);
      const [wizardShowReplace, setWizardShowReplace] = useState(false);

      const openWizard = (prefill) => {
        setWizardEdit(null);
        setWizardName((prefill && prefill.name) || "");
        setWizardEmoji((prefill && prefill.emoji) || "\u{1F372}");
        setWizardNutrients(emptyNutrients());
        setWizardBarcode((prefill && prefill.barcode) || null);
        setWizardReplaceId(null);
        setWizardShowReplace(false);
        setWizardOpen(true);
      };

      const openWizardEdit = (cf) => {
        setWizardEdit(cf.id);
        setWizardName(cf.name);
        setWizardEmoji(cf.emoji || "\u{1F372}");
        setWizardNutrients({ ...cf.nutrients });
        setWizardBarcode(cf.barcode || null);
        setWizardReplaceId(null);
        setWizardShowReplace(false);
        setWizardOpen(true);
      };

      const saveWizard = () => {
        if (wizardEdit) {
          setState((s) => Modules.CustomFoods.updateCustomFood(s, wizardEdit, {
            name: wizardName, emoji: wizardEmoji, nutrients: wizardNutrients, barcode: wizardBarcode,
          }));
          showToast({ text: `Updated: ${wizardName.slice(0, Modules.CustomFoods.NAME_MAX)}` });
        } else {
          const atCap = rankedFoods.length >= FOOD_CAP;
          if (atCap && !wizardReplaceId) {
            setWizardShowReplace(true);
            if (leastUsedFood) setWizardReplaceId(leastUsedFood.id);
            return;
          }
          const cf = Modules.CustomFoods.buildCustomFood(wizardName, wizardEmoji, wizardNutrients, wizardBarcode);
          if (atCap && wizardReplaceId) {
            const replacedItem = rankedFoods.find((f) => f.id === wizardReplaceId);
            const replacedSnapshot = replacedItem ? { ...replacedItem } : null;
            setState((s) => {
              let next = s;
              if (replacedItem && replacedItem._kind === "custom") {
                next = Modules.CustomFoods.removeCustomFood(next, wizardReplaceId);
              } else {
                next = Modules.Templates.removeTemplate(next, wizardReplaceId);
              }
              return Modules.CustomFoods.addCustomFood(next, cf);
            });
            showToast({
              text: `Created: ${cf.name} · replaced ${replacedSnapshot ? replacedSnapshot.emoji + " " + replacedSnapshot.name : "item"}`,
              undo: replacedSnapshot ? () => {
                setState((s) => {
                  let next = Modules.CustomFoods.removeCustomFood(s, cf.id);
                  if (replacedSnapshot._kind === "custom") {
                    return Modules.CustomFoods.addCustomFood(next, replacedSnapshot);
                  }
                  return Modules.Templates.addTemplate(next, replacedSnapshot);
                });
              } : undefined,
            });
          } else {
            setState((s) => Modules.CustomFoods.addCustomFood(s, cf));
            showToast({ text: `Created: ${cf.name}` });
          }
        }
        setWizardOpen(false);
      };

      // ── Long-press for custom food editing ──────────────────────────────────
      const longPressTimer = useRef(null);
      const longPressFired = useRef(false);

      const startLongPress = (cf) => {
        longPressFired.current = false;
        longPressTimer.current = setTimeout(() => {
          longPressFired.current = true;
          openWizardEdit(cf);
        }, 500);
      };
      const cancelLongPress = () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
      };

      // ── Keyboard-safe layout ────────────────────────────────────────────────
      const [kbOffset, setKbOffset] = useState(0);
      useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;
        const update = () => {
          const diff = window.innerHeight - vv.height - vv.offsetTop;
          setKbOffset(diff > 0 ? diff : 0);
        };
        vv.addEventListener("resize", update);
        vv.addEventListener("scroll", update);
        return () => {
          vv.removeEventListener("resize", update);
          vv.removeEventListener("scroll", update);
        };
      }, []);

      // ── Focus the search field when the sheet opens (clean, ready-to-type) ──
      useEffect(() => {
        if (closing) return;
        const id = requestAnimationFrame(() => {
          const el = searchRef.current;
          if (el && el.isConnected) el.focus();
        });
        return () => cancelAnimationFrame(id);
      }, []);

      // ── Unified items from state.templates ────────────────────────────────
      const allTemplates = state.templates || [];
      const mealItems = useMemo(() =>
        allTemplates.filter(t => !t.type || t.type === "meal" || t.type === "snack" || t.type === "supplement_food"),
        [allTemplates]
      );
      const suppItems = useMemo(() =>
        allTemplates.filter(t => t.type === "supplement"),
        [allTemplates]
      );

      const customFoods = state.customFoods || [];

      // ── Usage ranking (derived from log history — no schema change) ────────
      const FOOD_CAP = 17;
      const usageIndex = useMemo(() => {
        const counts = {};
        const allLogs = (state.dayHistory || []).reduce((acc, h) => acc.concat(h.dayLog || []), []).concat(state.dayLog || []);
        allLogs.forEach((e) => {
          const key = e.recipeId || e.name;
          if (!key) return;
          if (!counts[key]) counts[key] = { count: 0, lastUsedAt: 0 };
          counts[key].count += 1;
          if (e.timestamp > counts[key].lastUsedAt) counts[key].lastUsedAt = e.timestamp;
        });
        return counts;
      }, [state.dayHistory, state.dayLog]);

      const rankedFoods = useMemo(() => {
        const unified = mealItems.map((item) => {
          const key = item.sourceRecipeId || item.id;
          const u = usageIndex[key] || { count: 0, lastUsedAt: 0 };
          return { ...item, _key: key, _count: u.count, _last: u.lastUsedAt, _kind: "template" };
        }).concat(customFoods.map((cf) => {
          const u = usageIndex[cf.name] || { count: 0, lastUsedAt: 0 };
          return { ...cf, _key: cf.name, _count: u.count, _last: u.lastUsedAt, _kind: "custom" };
        }));
        unified.sort((a, b) => b._count - a._count || b._last - a._last || (a.name || "").localeCompare(b.name || ""));
        return unified;
      }, [mealItems, customFoods, usageIndex]);

      const cappedFoods = useMemo(() => rankedFoods.slice(0, FOOD_CAP), [rankedFoods]);
      const leastUsedFood = rankedFoods.length >= FOOD_CAP ? rankedFoods[rankedFoods.length - 1] : null;

      // ── Edit mode (jiggle) ─────────────────────────────────────────────────
      const [editMode, setEditMode] = useState(false);
      const [editorItem, setEditorItem] = useState(null);

      // ── Filtered items (search active = show all matches, no cap) ──────────
      const lowerQuery = query.toLowerCase().trim();
      const filteredMealItems = useMemo(() =>
        lowerQuery ? mealItems.filter(t => t.name.toLowerCase().includes(lowerQuery)) : mealItems,
        [mealItems, lowerQuery]
      );
      const filteredSuppItems = useMemo(() =>
        lowerQuery ? suppItems.filter(t => t.name.toLowerCase().includes(lowerQuery)) : suppItems,
        [suppItems, lowerQuery]
      );
      const filteredCustomFoods = useMemo(() =>
        lowerQuery ? customFoods.filter((cf) => cf.name.toLowerCase().includes(lowerQuery)) : customFoods,
        [customFoods, lowerQuery]
      );

      const filteredIngredients = useMemo(() =>
        lowerQuery ? Modules.Catalog.searchIngredients(lowerQuery) : [],
        [lowerQuery]
      );

      const filteredRankedFoods = useMemo(() => {
        if (!lowerQuery) return null;
        return rankedFoods.filter((f) => f.name.toLowerCase().includes(lowerQuery));
      }, [rankedFoods, lowerQuery]);

      const CATEGORY_EMOJI = {
        protein: "\u{1F356}",
        grain: "\u{1F33E}",
        seed: "\u{1F330}",
        nut: "\u{1F330}",
        fruit: "\u{1F34E}",
        vegetable: "\u{1F96C}",
        dairy: "\u{1F95B}",
        fat: "\u{1FAD2}",
        condiment: "\u{1F9C2}",
        spice: "\u{1F9C2}",
        snack: "\u{1F36A}",
        supplement_food: "\u{1F372}",
      };

      const [checkedSupps, setCheckedSupps] = useState({});
      const [selectedCustomFoods, setSelectedCustomFoods] = useState({});
      const [selectedIngredients, setSelectedIngredients] = useState({});

      const handleSelectRecipe = (id) => {
        const recipe = allRecipes[id];
        if (!recipe) return;
        setSelectedRecipes((prev) => {
          const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
          if (next.length === 1) {
            const r = allRecipes[next[0]];
            setIngredientStates(r.ingredients.map((ing) => ({
              id: ing.id,
              qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
              swapGroup: ing.swapGroup,
            })));
          } else {
            setIngredientStates([]);
          }
          return next;
        });
      };

      const toggleCustomFood = (id) => {
        setSelectedCustomFoods((prev) => ({ ...prev, [id]: !prev[id] }));
      };

      const toggleIngredient = (id) => {
        setSelectedIngredients((prev) => ({ ...prev, [id]: !prev[id] }));
      };

      const updateIngQty = (idx, qty) => {
        setIngredientStates((prev) => prev.map((s, i) => i === idx ? { ...s, qty: Math.max(0, qty) } : s));
      };

      const swapIngredient = (idx, newId) => {
        setIngredientStates((prev) => prev.map((s, i) =>
          i === idx ? { ...s, id: newId, qty: Modules.Catalog.getIngredient(newId)?.defaultQty || 1 } : s
        ));
      };

      const projectedNutrients = useMemo(() => {
        if (!selectedRecipe) return emptyNutrients();
        return Modules.Recipes.calculateNutrition(allRecipes[selectedRecipe], ingredientStates);
      }, [selectedRecipe, ingredientStates, allRecipes]);

      const handleClose = () => {
        setClosing(true);
        setTimeout(onClose, 300);
      };

      // ── Scan decode handler ─────────────────────────────────────────────────
      const handleScanDecode = (code) => {
        setShowScanner(false);
        setQuery(code);
        const lc = code.toLowerCase().trim();
        const anyMatch = mealItems.some((t) => t.name.toLowerCase().includes(lc))
          || customFoods.some((cf) => cf.name.toLowerCase().includes(lc));
        if (!anyMatch) {
          openWizard({ barcode: code });
        }
      };

      const handleConfirmMeal = () => {
        const mealEntries = selectedRecipes.map((rid) => {
          const recipe = allRecipes[rid];
          if (!recipe) return null;
          const isSingle = selectedRecipes.length === 1;
          const ingStates = isSingle
            ? [...ingredientStates]
            : recipe.ingredients.map((ing) => ({
                id: ing.id,
                qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
                swapGroup: ing.swapGroup,
              }));
          const nutrients = isSingle
            ? projectedNutrients
            : Modules.Recipes.calculateNutrition(recipe, ingStates);
          return {
            id: genId(),
            recipeId: rid,
            name: recipe.name,
            emoji: recipe.emoji,
            nutrients,
            ingredientStates: ingStates,
            timestamp: Date.now(),
          };
        }).filter(Boolean);

        if (mealEntries.length > 0) {
          setState((s) => Modules.Log.addEntries(s, mealEntries));
          if (isSyncEnabled(auth, state)) {
            mealEntries.forEach((e) => {
              window.WriteBehind.enqueue({
                table: "day_entries", op: "upsert",
                payload: buildEntryRow(e, auth.user.id, state.currentDate),
                rollback: () => setState((s) => Modules.Log.removeEntry(s, e.id)),
              });
            });
          }
          if (mealEntries.length === 1) {
            const e = mealEntries[0];
            showToast({ text: `${e.emoji} ${e.name}`, macros: e.nutrients, entryId: e.id });
          } else {
            showToast({ text: `Added ${mealEntries.length} meals` });
          }
        }

        // Add selected custom foods as recipe-less entries
        customFoods.forEach((cf) => {
          if (!selectedCustomFoods[cf.id]) return;
          const entry = {
            id: genId(),
            recipeId: null,
            name: cf.name,
            emoji: cf.emoji,
            nutrients: cf.nutrients,
            ingredientStates: [],
            custom: true,
            timestamp: Date.now(),
          };
          setState((s) => Modules.Log.addEntry(s, entry));
          if (isSyncEnabled(auth, state)) {
            window.WriteBehind.enqueue({
              table: "day_entries", op: "upsert",
              payload: buildEntryRow(entry, auth.user.id, state.currentDate),
              rollback: () => setState((s) => Modules.Log.removeEntry(s, entry.id)),
            });
          }
        });

        // Add selected catalog ingredients as recipe-less entries
        Object.entries(selectedIngredients).forEach(([ingId, selected]) => {
          if (!selected) return;
          const ing = Modules.Catalog.getIngredient(ingId);
          if (!ing) return;
          const ingStates = [{ id: ingId, qty: ing.defaultQty }];
          const nutrients = Modules.Recipes.calculateNutrition({}, ingStates);
          const entry = {
            id: genId(),
            recipeId: null,
            name: ing.name,
            emoji: CATEGORY_EMOJI[ing.category] || "\u{1F37D}",
            nutrients,
            ingredientStates: ingStates,
            custom: false,
            source: "catalog",
            timestamp: Date.now(),
          };
          setState((s) => Modules.Log.addEntry(s, entry));
          if (isSyncEnabled(auth, state)) {
            window.WriteBehind.enqueue({
              table: "day_entries", op: "upsert",
              payload: buildEntryRow(entry, auth.user.id, state.currentDate),
              rollback: () => setState((s) => Modules.Log.removeEntry(s, entry.id)),
            });
          }
        });

        // Add checked supplements
        Object.entries(checkedSupps).forEach(([suppId, checked]) => {
          if (!checked) return;
          const recipe = allRecipes[suppId];
          if (!recipe) return;
          const entryId = genId();
          const ingredientStates = recipe.ingredients.map((ing) => ({
            id: ing.id,
            qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
            swapGroup: null,
          }));
          const entry = {
            id: entryId,
            recipeId: suppId,
            name: recipe.name,
            emoji: recipe.emoji,
            nutrients: Modules.Recipes.calculateNutrition(recipe, ingredientStates),
            ingredientStates,
            timestamp: Date.now(),
          };
          setState((s) => Modules.Log.addEntry(s, entry));
          if (isSyncEnabled(auth, state)) {
            window.WriteBehind.enqueue({
              table: "day_entries", op: "upsert",
              payload: buildEntryRow(entry, auth.user.id, state.currentDate),
              rollback: () => setState((s) => Modules.Log.removeEntry(s, entry.id)),
            });
          }
        });
        if (Object.values(checkedSupps).some(Boolean)) {
          const count = Object.values(checkedSupps).filter(Boolean).length;
          showToast({ text: `Added ${count} supplement${count > 1 ? "s" : ""}` });
        }
        handleClose();
      };

      const toggleSupp = (id) => {
        setCheckedSupps((prev) => ({ ...prev, [id]: !prev[id] }));
      };

      const toggleSuppById = (templateId) => {
        setCheckedSupps((prev) => ({ ...prev, [templateId]: !prev[templateId] }));
      };

      const handleLogItem = (item) => {
        if (item.type === "supplement") {
          toggleSuppById(item.id);
          return;
        }
        const recipeId = item.sourceRecipeId || item.id;
        handleSelectRecipe(recipeId);
      };

      const handleDeleteItem = (id, name) => {
        setState((s) => Modules.Templates.removeTemplate(s, id));
        showToast({ text: `Deleted ${name}` });
      };

      // ── Templates: create-from-current-selection ──────────────────────────
      const [creatingName, setCreatingName] = useState(null);
      const canCreate = selectedRecipes.length > 0 || Object.values(checkedSupps).some(Boolean);

      const logTemplate = (tpl) => {
        const res = Modules.Templates.resolveTemplate(tpl, allRecipes);
        if (!res.ok || res.entries.length === 0) return;
        setState((s) => Modules.Log.addEntries(s, res.entries));
        if (isSyncEnabled(auth, state)) {
          res.entries.forEach((e) => {
            window.WriteBehind.enqueue({
              table: "day_entries", op: "upsert",
              payload: buildEntryRow(e, auth.user.id, state.currentDate),
              rollback: () => setState((s) => Modules.Log.removeEntry(s, e.id)),
            });
          });
        }
        const n = res.entries.length;
        showToast({ text: `${tpl.emoji} ${tpl.name} · ${n} item${n > 1 ? "s" : ""}` });
        handleClose();
      };

      const buildCurrentRefs = () => {
        const refs = [];
        const isSingle = selectedRecipes.length === 1;
        selectedRecipes.forEach((rid) => {
          const recipe = allRecipes[rid];
          if (!recipe) return;
          const states = isSingle
            ? ingredientStates.map((s) => ({ ...s }))
            : recipe.ingredients.map((ing) => ({
                id: ing.id,
                qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
                swapGroup: ing.swapGroup,
              }));
          refs.push({ recipeId: rid, ingredientStates: states });
        });
        Object.entries(checkedSupps).forEach(([sid, on]) => {
          if (!on) return;
          const recipe = allRecipes[sid];
          if (!recipe) return;
          refs.push({
            recipeId: sid,
            ingredientStates: recipe.ingredients.map((ing) => ({
              id: ing.id,
              qty: Modules.Catalog.getIngredient(ing.id)?.defaultQty || 1,
              swapGroup: ing.swapGroup || null,
            })),
          });
        });
        return refs;
      };

      const saveTemplate = () => {
        const refs = buildCurrentRefs();
        if (refs.length === 0) return;
        const firstRecipe = allRecipes[refs[0].recipeId];
        const emoji = (firstRecipe && firstRecipe.emoji) || "\u{1F37D}";
        const tpl = Modules.Templates.buildTemplate(creatingName || "My Template", emoji, refs);
        setState((s) => Modules.Templates.addTemplate(s, tpl));
        showToast({ text: `Saved template: ${tpl.name}` });
        setCreatingName(null);
      };

      const hasAnySelection = selectedRecipes.length > 0
        || Object.values(checkedSupps).some(Boolean)
        || Object.values(selectedCustomFoods).some(Boolean)
        || Object.values(selectedIngredients).some(Boolean);

      // ── Item Editor state (always declared — hooks can't be conditional) ──
      const [edName, setEdName] = useState("");
      const [edEmoji, setEdEmoji] = useState("");
      const [edText, setEdText] = useState("");
      const [edSaving, setEdSaving] = useState(false);
      const editorRef = useRef(null);

      useEffect(() => {
        if (editorItem && editorItem !== editorRef.current) {
          editorRef.current = editorItem;
          setEdName(editorItem.name || "");
          setEdEmoji(editorItem.emoji || "\u{1F37D}");
          setEdText(editorItem.ingredientText || "");
          setEdSaving(false);
        }
        if (!editorItem) editorRef.current = null;
      }, [editorItem]);

      const cycleEditorEmoji = () => {
        const idx = FOOD_EMOJIS.indexOf(edEmoji);
        setEdEmoji(FOOD_EMOJIS[(idx + 1) % FOOD_EMOJIS.length]);
      };

      const saveEditor = async () => {
        if (!editorItem) return;
        const changes = { name: edName.slice(0, 40).trim() || "Untitled", emoji: edEmoji, ingredientText: edText, updatedAt: Date.now() };
        if (edText.trim() && edText !== (editorItem.ingredientText || "") && state.apiKey) {
          setEdSaving(true);
          try {
            const nutrients = await estimateNutrients(edText, state.apiKey, state.aiModel);
            if (nutrients) {
              NUTRIENT_KEYS.forEach((k) => { if (nutrients[k] == null || isNaN(nutrients[k])) nutrients[k] = 0; });
              changes.nutrients = nutrients;
            }
          } catch (e) {
            showToast({ text: "AI estimation failed — saved without nutrient update" });
          }
          setEdSaving(false);
        }
        setState((s) => Modules.Templates.updateTemplate(s, editorItem.id, changes));
        showToast({ text: `Updated ${changes.name}` });
        setEditorItem(null);
      };

      const deleteFromEditor = () => {
        if (!editorItem) return;
        setState((s) => Modules.Templates.removeTemplate(s, editorItem.id));
        showToast({ text: `Deleted ${editorItem.name}` });
        setEditorItem(null);
      };

      // ── Item Editor overlay (edit mode) ────────────────────────────────────
      if (editorItem) {
        return (
          <div className="fixed inset-0 z-[70] animate-fade-in">
            <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm" onClick={() => setEditorItem(null)} />
            <div className="absolute bottom-0 left-0 right-0 bg-surface-container dark:bg-[#0a0a0a] modal-sheet max-h-[85vh] flex flex-col animate-slide-up"
                 style={kbOffset > 0 ? { paddingBottom: kbOffset } : undefined}>
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-on-surface/20" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3">
                <h2 className="font-headline text-lg font-bold">Edit Item</h2>
                <div className="flex items-center gap-1">
                  <button onClick={deleteFromEditor} className="p-2 hover:bg-on-surface/10 rounded-full transition text-red-400" aria-label="Delete" data-testid="editor-delete">
                    <Icon name="delete" size={20} />
                  </button>
                  <button onClick={() => setEditorItem(null)} className="p-2 hover:bg-on-surface/10 rounded-full transition" aria-label="Cancel" data-testid="editor-cancel">
                    <Icon name="close" size={20} />
                  </button>
                  <button onClick={saveEditor} disabled={edSaving || !edName.trim()} className="p-2 hover:bg-on-surface/10 rounded-full transition text-primary-fixed-dim disabled:opacity-40" aria-label="Save" data-testid="editor-save">
                    <Icon name={edSaving ? "hourglass_top" : "check"} size={20} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-4" data-testid="item-editor">
                <div className="flex gap-3 items-center">
                  <button onClick={cycleEditorEmoji} className="w-12 h-12 bg-on-surface/5 rounded-xl flex items-center justify-center text-2xl" aria-label="Change emoji">
                    {edEmoji}
                  </button>
                  <input
                    type="text"
                    autoFocus
                    maxLength={40}
                    value={edName}
                    onChange={(e) => setEdName(e.target.value)}
                    placeholder="Item name"
                    data-testid="editor-name"
                    className="flex-1 bg-on-surface/5 rounded-xl px-4 py-2.5 text-sm placeholder:text-on-surface-variant/40"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-on-surface-variant font-label">Ingredients</label>
                  <textarea
                    value={edText}
                    onChange={(e) => setEdText(e.target.value)}
                    placeholder={"e.g.\n48g pea protein\n40g rolled oats\n1 banana"}
                    rows={6}
                    data-testid="editor-ingredients"
                    className="w-full bg-on-surface/5 rounded-xl px-4 py-3 text-sm placeholder:text-on-surface-variant/40 resize-none"
                  />
                  <div className="flex items-center gap-1.5 text-xs text-on-surface-variant/60">
                    <Icon name="auto_awesome" size={14} />
                    <span>Nutrients calculated automatically from ingredients</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      }

      // ── Custom Food Wizard (inline overlay) ─────────────────────────────────
      if (wizardOpen) {
        return (
          <div className="fixed inset-0 z-[60] animate-fade-in">
            <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm" onClick={() => setWizardOpen(false)} />
            <div className="absolute bottom-0 left-0 right-0 bg-surface-container dark:bg-[#0a0a0a] modal-sheet max-h-[85vh] flex flex-col animate-slide-up"
                 style={kbOffset > 0 ? { paddingBottom: kbOffset } : undefined}>
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-on-surface/20" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3">
                <h2 className="font-headline text-lg font-bold">{wizardEdit ? "Edit Custom Food" : "New Custom Food"}</h2>
                <button onClick={() => setWizardOpen(false)} className="p-1 hover:bg-on-surface/10 rounded-full transition">
                  <Icon name="close" size={22} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-4" data-testid="custom-food-wizard">
                <div className="flex gap-3">
                  <input
                    type="text"
                    autoFocus
                    maxLength={Modules.CustomFoods.NAME_MAX}
                    value={wizardName}
                    onChange={(e) => setWizardName(e.target.value)}
                    placeholder="Food name"
                    data-testid="cf-name"
                    className="flex-1 bg-on-surface/5 rounded-xl px-4 py-2.5 text-sm placeholder:text-on-surface-variant/40"
                  />
                  <input
                    type="text"
                    maxLength={2}
                    value={wizardEmoji}
                    onChange={(e) => setWizardEmoji(e.target.value)}
                    className="w-14 bg-on-surface/5 rounded-xl px-2 py-2.5 text-center text-lg"
                    aria-label="Emoji"
                  />
                </div>
                {wizardBarcode && (
                  <div className="flex items-center gap-2 bg-on-surface/5 rounded-xl px-4 py-2 text-xs text-on-surface-variant">
                    <Icon name="qr_code_scanner" size={16} />
                    <span>Barcode Reference: {wizardBarcode}</span>
                  </div>
                )}
                <h3 className="font-headline text-sm font-semibold text-on-surface-variant">Nutrients per serving</h3>
                <div className="grid grid-cols-2 gap-2">
                  {NUTRIENT_KEYS.map((k) => (
                    <div key={k} className="flex items-center gap-2 bg-on-surface/5 rounded-xl px-3 py-2">
                      <label className="text-xs text-on-surface-variant flex-1 truncate">{NUTRIENT_LABELS[k]}</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={wizardNutrients[k] || ""}
                        onChange={(e) => setWizardNutrients((prev) => ({ ...prev, [k]: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 }))}
                        data-testid={`cf-${k}`}
                        className="w-16 bg-transparent text-right text-sm font-semibold"
                      />
                      <span className="text-xs text-on-surface-variant/60 w-8">{NUTRIENT_UNITS[k]}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Replace listbox (shown when at cap and creating new) */}
              {wizardShowReplace && !wizardEdit && (
                <div className="absolute inset-0 z-10 bg-surface-container dark:bg-[#0a0a0a] flex flex-col animate-fade-in">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-on-surface/20" />
                  </div>
                  <div className="flex items-center justify-between px-5 pb-3">
                    <h2 className="font-headline text-lg font-bold">Replace a food</h2>
                    <button onClick={() => setWizardShowReplace(false)} className="p-1 hover:bg-on-surface/10 rounded-full transition">
                      <Icon name="arrow_back" size={22} />
                    </button>
                  </div>
                  <p className="px-5 pb-3 text-xs text-on-surface-variant">You have {FOOD_CAP} foods. Choose one to replace:</p>
                  <div className="flex-1 overflow-y-auto px-5 pb-24" data-testid="replace-listbox">
                    {[...rankedFoods].reverse().map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setWizardReplaceId(f.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all ${
                          wizardReplaceId === f.id ? "bg-primary/10 border border-primary/40" : "hover:bg-on-surface/5"
                        }`}
                      >
                        <span className="text-xl">{f.emoji || "\u{1F372}"}</span>
                        <span className="flex-1 text-left text-sm font-label truncate">{f.name}</span>
                        <span className="text-xs text-on-surface-variant/60">{f._count || 0} uses</span>
                      </button>
                    ))}
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-5 sheet-bottom-fade">
                    <button
                      onClick={saveWizard}
                      disabled={!wizardName.trim() || !wizardReplaceId}
                      data-testid="cf-save"
                      className="w-full pill-active rounded-full py-3.5 text-white font-semibold font-headline text-sm disabled:opacity-40 transition"
                    >
                      {(() => { const r = rankedFoods.find((f) => f.id === wizardReplaceId); return r ? `Create food · replaces ${r.emoji} ${r.name}` : "Select a food to replace"; })()}
                    </button>
                  </div>
                </div>
              )}
              {!wizardShowReplace && (
                <div className="absolute bottom-0 left-0 right-0 p-5 sheet-bottom-fade">
                  <button
                    onClick={saveWizard}
                    disabled={!wizardName.trim()}
                    data-testid="cf-save"
                    className="w-full pill-active rounded-full py-3.5 text-white font-semibold font-headline text-sm disabled:opacity-40 transition"
                  >
                    {wizardEdit ? "Update Food" : "Create Food"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      }

      // ── Scanner modal ───────────────────────────────────────────────────────
      if (showScanner) {
        return <CameraScanModal onDecode={handleScanDecode} onClose={() => setShowScanner(false)} />;
      }

      return (
        <div className="fixed inset-0 z-[60] animate-fade-in">
          <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm" onClick={handleClose} />
          <div className={`absolute bottom-0 left-0 right-0 bg-surface-container dark:bg-[#0a0a0a] modal-sheet max-h-[85vh] flex flex-col ${closing ? "animate-slide-down" : "animate-slide-up"}`}
               style={kbOffset > 0 ? { paddingBottom: kbOffset } : undefined}>
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-on-surface/20" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-3">
              <div className="flex items-center gap-2">
                <h2 className="font-headline text-lg font-bold">Log Entry</h2>
                {tab === "meals" && !lowerQuery && (
                  <span className="text-xs text-on-surface-variant/60 font-label">{Math.min(rankedFoods.length, FOOD_CAP)} / {FOOD_CAP} foods</span>
                )}
              </div>
              <button onClick={handleClose} className="p-1 hover:bg-on-surface/10 rounded-full transition">
                <Icon name="close" size={22} />
              </button>
            </div>

            {/* Search + Enter-to-log + Scan bar */}
            <div className="px-5 pb-3 flex gap-2">
              <div className="flex-1 relative">
                <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && lowerQuery) {
                      const match = filteredRankedFoods && filteredRankedFoods[0];
                      if (match) {
                        if (match._kind === "custom") toggleCustomFood(match.id);
                        else handleLogItem(match);
                      }
                    }
                  }}
                  placeholder="Search meals, templates, foods…"
                  data-testid="log-search"
                  className="w-full liquid-glass rounded-xl pl-9 pr-10 py-2.5 text-sm placeholder:text-on-surface-variant/40"
                />
                {lowerQuery && (
                  <button
                    onClick={() => {
                      const match = filteredRankedFoods && filteredRankedFoods[0];
                      if (match) {
                        if (match._kind === "custom") toggleCustomFood(match.id);
                        else handleLogItem(match);
                      }
                    }}
                    data-testid="log-submit"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full pill-active text-white"
                    aria-label="Log first match"
                  >
                    <Icon name="keyboard_return" size={16} />
                  </button>
                )}
              </div>
              {scannerSupported && (
                <button
                  onClick={() => setShowScanner(true)}
                  data-testid="scan-trigger"
                  className="liquid-glass rounded-xl px-3 flex items-center justify-center"
                  aria-label="Scan barcode"
                >
                  <Icon name="qr_code_scanner" size={20} />
                </button>
              )}
            </div>

            {/* Segmented Tabs */}
            <div className="px-5 pb-4">
              <div className="bg-on-surface/5 p-1 rounded-full flex">
                {["meals", "supplements"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2 rounded-full text-sm font-semibold font-label transition-all ${
                      tab === t ? "pill-active text-white" : "text-on-surface-variant"
                    }`}
                  >{t === "meals" ? "Meals" : "Supplements"}</button>
                ))}
              </div>
            </div>

            {/* Content — bounded 3×3 entry grid */}
            <div className="flex-1 flex flex-col overflow-hidden px-5 pb-24" data-testid="entry-grid" style={{ height: `calc(80vh - ${kbOffset}px)` }}>
              <div className="flex-1 overflow-y-auto">
                {tab === "meals" && !lowerQuery && (
                  <div className="grid grid-cols-3 gap-2 auto-rows-fr" role="group" aria-label="Food grid" data-testid="meal-pills">
                    {/* Cell 1: New / edit food */}
                    <button
                      onClick={() => openWizard({})}
                      data-testid="new-custom-food"
                      aria-label="New or edit food"
                      className="entry-grid-cell liquid-glass-light rounded-2xl flex flex-col items-center justify-center gap-1 border-2 border-dashed border-on-surface/20 hover:border-on-surface/40 transition-all"
                    >
                      <Icon name="add" size={28} className="text-on-surface-variant/60" />
                      <span className="text-xs text-on-surface-variant/60 font-label">New food</span>
                    </button>
                    {/* Cells 2–18: ranked foods (thumb zone = bottom rows) */}
                    {cappedFoods.map((item, idx) => {
                      const rid = item.sourceRecipeId || item.id;
                      const isSelected = item._kind === "custom" ? !!selectedCustomFoods[item.id] : selectedRecipes.includes(rid);
                      const isDegraded = item._kind === "template" && !item.nutrients && Array.isArray(item.refs) && item.refs.length > 0
                        && item.refs.some(r => !allRecipes[r.recipeId]);
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (isDegraded) return;
                            if (editMode) { item._kind === "custom" ? openWizardEdit(item) : setEditorItem(item); return; }
                            if (item._kind === "custom") { if (!longPressFired.current) toggleCustomFood(item.id); }
                            else handleLogItem(item);
                          }}
                          onPointerDown={() => item._kind === "custom" && !editMode && startLongPress(item)}
                          onPointerUp={cancelLongPress}
                          onPointerLeave={cancelLongPress}
                          disabled={isDegraded}
                          aria-label={`${item.emoji || CATEGORY_EMOJI[item.category] || "\u{1F372}"} ${item.name}`}
                          aria-pressed={isSelected}
                          aria-selected={isSelected}
                          aria-setsize={Math.min(rankedFoods.length, FOOD_CAP)}
                          aria-posinset={idx + 1}
                          data-testid={item._kind === "custom" ? "custom-food-chip" : "item-chip"}
                          data-item-id={item.id}
                          data-cf-id={item._kind === "custom" ? item.id : undefined}
                          data-degraded={isDegraded || undefined}
                          className={`entry-grid-cell liquid-glass-light rounded-2xl flex flex-col items-center justify-center gap-0.5 relative transition-all ${
                            isDegraded ? "opacity-50 cursor-not-allowed" :
                            editMode ? "animate-jiggle" :
                            isSelected ? "border-2 border-primary/40 bg-primary/10" : ""
                          }`}
                        >
                          {editMode && !isDegraded && (
                            <span
                              className="delete-badge"
                              onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id, item.name); }}
                            >-</span>
                          )}
                          <span className="text-2xl leading-none">{item.emoji || CATEGORY_EMOJI[item.category] || "\u{1F372}"}</span>
                          <span className="entry-grid-label text-on-surface-variant">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Search results (no cap, scrollable) */}
                {tab === "meals" && lowerQuery && (
                  <>
                    <div className="grid grid-cols-3 gap-2 auto-rows-fr" data-testid="meal-pills">
                      {(filteredRankedFoods || []).map((item) => {
                        const rid = item.sourceRecipeId || item.id;
                        const isSelected = item._kind === "custom" ? !!selectedCustomFoods[item.id] : selectedRecipes.includes(rid);
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              if (editMode) { item._kind === "custom" ? openWizardEdit(item) : setEditorItem(item); return; }
                              if (item._kind === "custom") { if (!longPressFired.current) toggleCustomFood(item.id); }
                              else handleLogItem(item);
                            }}
                            aria-label={`${item.emoji || CATEGORY_EMOJI[item.category] || "\u{1F372}"} ${item.name}`}
                            aria-pressed={isSelected}
                            aria-selected={isSelected}
                            data-testid={item._kind === "custom" ? "custom-food-chip" : "item-chip"}
                            data-item-id={item.id}
                            data-cf-id={item._kind === "custom" ? item.id : undefined}
                            className={`entry-grid-cell liquid-glass-light rounded-2xl flex flex-col items-center justify-center gap-0.5 relative transition-all ${
                              editMode ? "animate-jiggle" :
                              isSelected ? "border-2 border-primary/40 bg-primary/10" : ""
                            }`}
                          >
                            <span className="text-2xl leading-none">{item.emoji || CATEGORY_EMOJI[item.category] || "\u{1F372}"}</span>
                            <span className="entry-grid-label text-on-surface-variant">{item.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    {filteredIngredients.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <h3 className="font-headline text-sm font-semibold text-on-surface-variant">Foods</h3>
                        <div className="grid grid-cols-3 gap-2 auto-rows-fr" data-testid="ingredient-pills">
                          {filteredIngredients.map((ing) => (
                            <button
                              key={ing.id}
                              onClick={() => toggleIngredient(ing.id)}
                              data-testid={`ingredient-pill-${ing.id}`}
                              data-ing-id={ing.id}
                              aria-pressed={!!selectedIngredients[ing.id]}
                              className={`entry-grid-cell liquid-glass-light rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all ${
                                selectedIngredients[ing.id] ? "border-2 border-primary/40 bg-primary/10" : ""
                              }`}
                            >
                              <span className="text-2xl leading-none">{CATEGORY_EMOJI[ing.category] || "\u{1F37D}"}</span>
                              <span className="entry-grid-label text-on-surface-variant">{ing.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {tab === "supplements" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2 auto-rows-fr" data-testid="supp-pills">
                      {(lowerQuery ? filteredSuppItems : filteredSuppItems.slice(0, 17)).map((item) => (
                        <button
                          key={item.id}
                          onClick={() => editMode ? setEditorItem(item) : handleLogItem(item)}
                          aria-label={`${item.emoji} ${item.name}`}
                          data-testid="item-chip"
                          data-item-id={item.id}
                          className={`entry-grid-cell liquid-glass-light rounded-2xl flex flex-col items-center justify-center gap-0.5 relative transition-all ${
                            editMode ? "animate-jiggle" :
                            checkedSupps[item.id] ? "border-2 border-primary/40 bg-primary/10" : ""
                          }`}
                        >
                          {editMode && (
                            <span
                              className="delete-badge"
                              onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id, item.name); }}
                            >-</span>
                          )}
                          <span className="text-2xl leading-none">{item.emoji}</span>
                          <span className="entry-grid-label text-on-surface-variant">{item.name}</span>
                        </button>
                      ))}
                    </div>
                    {!editMode && <ClosingGaps suppItems={suppItems} checkedSupps={checkedSupps} onToggle={toggleSuppById} />}
                  </div>
                )}

                {/* Create Template */}
                {canCreate && (
                  creatingName === null ? (
                    <button
                      onClick={() => setCreatingName("")}
                      data-testid="create-template"
                      className="w-full mt-3 rounded-full py-2.5 text-sm font-label border border-on-surface/10 bg-on-surface/5 text-on-surface-variant hover:border-on-surface/20 transition flex items-center justify-center gap-1.5"
                    >
                      <Icon name="bookmark_add" size={18} /> Create Template
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 mt-3">
                      <input
                        type="text"
                        autoFocus
                        maxLength={Modules.Templates.NAME_MAX}
                        value={creatingName}
                        onChange={(e) => setCreatingName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveTemplate()}
                        placeholder="Template name"
                        data-testid="template-name-input"
                        className="flex-1 bg-on-surface/5 rounded-full px-4 py-2.5 text-sm placeholder:text-on-surface-variant/40"
                      />
                      <button onClick={saveTemplate} data-testid="template-save" className="px-4 py-2.5 rounded-full pill-active text-white text-sm font-semibold">Save</button>
                      <button onClick={() => setCreatingName(null)} className="p-2 text-on-surface-variant" aria-label="Cancel"><Icon name="close" size={18} /></button>
                    </div>
                  )
                )}
              </div>

              {/* Edit/Done footer button */}
              <div className="flex items-center justify-between py-2 mt-1">
                <button
                  onClick={() => { setEditMode(!editMode); if (editMode) setEditorItem(null); }}
                  data-testid="edit-toggle"
                  className={`text-sm font-semibold font-label px-3 py-1 rounded-lg transition-all ${
                    editMode ? "bg-primary/15 text-primary-fixed-dim" : "text-primary-fixed-dim"
                  }`}
                >
                  {editMode ? "Done" : <><Icon name="edit" size={14} className="inline -mt-0.5 mr-1" />Edit</>}
                </button>
                <span className="text-xs text-on-surface-variant">
                  {editMode ? "Tap cell to edit" : "Tap to log"}
                </span>
              </div>
            </div>

            {/* Confirm CTA */}
            <div className="absolute bottom-0 left-0 right-0 p-5 sheet-bottom-fade">
              <button
                onClick={handleConfirmMeal}
                disabled={!hasAnySelection}
                className="w-full pill-active rounded-full py-3.5 text-white font-semibold font-headline text-sm disabled:opacity-40 transition"
              >
                {selectedRecipes.length > 1 ? `Confirm Entry (${selectedRecipes.length})` : "Confirm Entry"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // SwapDropdown
    // ============================================================
    function SwapDropdown({ group, currentId, onSwap }) {
      const [open, setOpen] = useState(false);
      const options = Modules.Catalog.getSwapGroup(group) || [];
      if (options.length <= 1) return null;

      return (
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="text-xs text-primary-fixed-dim hover:text-white transition font-label"
          >
            Change
          </button>
          {open && (
            <div className="absolute right-0 top-6 z-20 bg-surface-container-highest rounded-xl border border-on-surface/10 shadow-xl overflow-hidden min-w-[160px]">
              {options.map((optId) => {
                const ing = Modules.Catalog.getIngredient(optId);
                if (!ing) return null;
                return (
                  <button
                    key={optId}
                    onClick={() => { onSwap(optId); setOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-on-surface/10 transition ${
                      optId === currentId ? "text-primary-fixed-dim font-semibold" : "text-on-surface-variant"
                    }`}
                  >{ing.name}</button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // ============================================================
    // ClosingGaps (supplements that help close remaining gaps)
    // ============================================================
    function ClosingGaps({ suppItems, checkedSupps, onToggle }) {
      const { runningTotals } = useNutrition();
      const gaps = useMemo(() => getOpenGaps(runningTotals), [runningTotals]);

      const helpfulSupps = useMemo(() => {
        const result = [];
        for (const item of suppItems) {
          if (checkedSupps[item.id]) continue;
          const nutrients = item.nutrients || {};
          const helps = gaps.filter((g) => g.type === "under" && (nutrients[g.key] || 0) > 0);
          if (helps.length > 0) result.push({ id: item.id, name: item.name, helps: helps.map((h) => h.label) });
        }
        return result;
      }, [suppItems, checkedSupps, gaps]);

      if (helpfulSupps.length === 0) return null;

      return (
        <div className="space-y-2">
          <h3 className="font-headline text-sm font-semibold text-on-surface-variant">Close remaining gaps</h3>
          {helpfulSupps.map((s) => (
            <button
              key={s.id}
              onClick={() => onToggle(s.id)}
              className="w-full liquid-glass-light rounded-2xl px-4 py-3 flex items-center gap-3 text-left"
            >
              <Icon name="add_circle" size={18} className="text-blue-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{s.name}</p>
                <p className="text-xs text-on-surface-variant truncate">Helps: {s.helps.join(", ")}</p>
              </div>
            </button>
          ))}
        </div>
      );
    }

    // ============================================================
    // DashboardScreen
    // ============================================================
    function DashboardScreen() {
      const { runningTotals, state } = useNutrition();
      const cals = computeCalories(runningTotals);
      const calTarget = resolveCalorieTarget(state.onboardingProfile);
      const calPct = Math.min(100, Math.round((cals / calTarget) * 100));

      return (
        <div className="pt-20 pb-28 px-4 space-y-6">
          <div>
            <h1 className="font-headline text-[34px] font-extrabold leading-tight">Dashboard</h1>
            <p className="text-on-surface-variant text-sm mt-1">Overview of your daily intake</p>
          </div>

          {/* Calories Hero */}
          <div className="liquid-glass p-5 rounded-[24px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-on-surface-variant font-label">Calories</span>
                <span className="text-sm text-on-surface-variant">{cals} / {calTarget} kcal</span>
              </div>
              <div className="w-full h-3 rounded-full bg-on-surface/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 progress-glow transition-all duration-500"
                  style={{ width: `${calPct}%` }}
                />
              </div>
              <p className="font-headline text-3xl font-extrabold mt-3">{cals}</p>
              <p className="text-xs text-on-surface-variant">kcal</p>
            </div>

          {/* Macros — Protein | Fats | Carbs (always-on) */}
          <div className="flex gap-3" role="group" aria-label="Daily Macros">
            <MacroCard label="Protein" nutrientKey="protein" color="blue" testId="macro-protein" />
            <MacroCard label="Fats" nutrientKey="fat" color="amber" testId="macro-fats" />
            <MacroCard label="Carbs" nutrientKey="carbs" color="green" testId="macro-carbs" />
          </div>

          {/* Vitamins */}
          <NutrientGroup title="Vitamins" keys={VITAMIN_KEYS} accent="blue" />

          {/* Minerals */}
          <NutrientGroup title="Minerals" keys={MINERAL_KEYS} accent="green" />

          {/* Additional Macros */}
          <NutrientGroup title="Additional" keys={["fiber", "sat_fat", "epa_dha"]} accent="purple" />
        </div>
      );
    }

    function MacroCard({ label, nutrientKey, color, testId }) {
      const { runningTotals } = useNutrition();
      const val = runningTotals[nutrientKey] || 0;
      const status = getStatus(nutrientKey, val);
      const pct = Math.min(100, status.pct);
      const colorMap = { blue: "from-blue-600 to-blue-400", green: "from-green-600 to-green-400", purple: "from-purple-600 to-purple-400", amber: "from-amber-600 to-amber-400" };

      return (
        <div data-testid={testId} className="liquid-glass p-3 rounded-[24px] h-40 flex-1 min-w-0 flex flex-col justify-between">
          <div className="min-w-0">
            <span className="block text-xs text-on-surface-variant font-label truncate">{label}</span>
            <p className="font-headline font-bold mt-1 truncate" style={{ fontSize: "clamp(1.05rem, 5vw, 1.5rem)" }}>{fmtVal(nutrientKey, val)}</p>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-on-surface-variant mb-1 truncate">{getTargetStr(nutrientKey)}</div>
            <div className="w-full h-2 rounded-full bg-on-surface/5 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${colorMap[color]} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      );
    }

    function NutrientGroup({ title, keys, accent }) {
      const { runningTotals } = useNutrition();
      const accentColor = accent === "green" ? "bg-green-400" : accent === "purple" ? "bg-purple-400" : "bg-blue-400";
      const barColor = accent === "green" ? "from-green-600 to-green-400" : accent === "purple" ? "from-purple-600 to-purple-400" : "from-blue-600 to-blue-400";

      return (
        <div className="liquid-glass rounded-[24px] overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h2 className="font-headline text-lg font-bold">{title}</h2>
          </div>
          {keys.map((k, i) => {
            const val = runningTotals[k] || 0;
            const status = getStatus(k, val);
            const pct = Math.min(100, status.pct);
            const icon = NUTRIENT_ICONS[k] || "science";

            return (
              <div key={k}>
                {i > 0 && <div className="mx-4 h-[0.5px] bg-on-surface/5" />}
                <div className="px-5 py-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full ${accentColor}/20 flex items-center justify-center`}>
                    <Icon name={icon} size={16} className={accentColor.replace("bg-", "text-")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-label">{NUTRIENT_LABELS[k]}</span>
                      <span className="text-sm font-semibold">{fmtVal(k, val)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 rounded-full bg-on-surface/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-on-surface-variant whitespace-nowrap">{getTargetStr(k)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // ============================================================
    // InsightsScreen — Weekly Report Card + Nutrient Heatmap
    // ============================================================

    var heatmapColor = Modules.Insights.heatmapColor;

    function InsightsScreen() {
      const { state, runningTotals, gapsClosed } = useNutrition();
      const [range, setRange] = useState(7);
      const [selectedCell, setSelectedCell] = useState(null);

      const isDark = state.themeMode === "dark" ||
        (state.themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

      // Build days array from history + today
      const days = useMemo(
        () => Modules.Insights.buildDays(state, runningTotals, gapsClosed),
        [state.dayHistory, state.dayLog, state.currentDate, runningTotals, gapsClosed]
      );

      const sliced = useMemo(() => days.slice(-range), [days, range]);

      const heatmapGridStyle = useMemo(
        () => ({ gridTemplateColumns: "72px repeat(" + sliced.length + ", minmax(20px, 36px))" }),
        [sliced.length]
      );

      // Report card stats
      const stats = useMemo(() => Modules.Insights.aggregate(sliced), [sliced]);

      // Heatmap data: nutrientKey -> array of { pct, value, date }
      const heatmapData = useMemo(
        () => Modules.Insights.buildHeatmap(sliced, isDark),
        [sliced, isDark]
      );

      const formatShortDate = (dateStr) => {
        const d = new Date(dateStr + "T12:00:00");
        const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        return days[d.getDay()] + " " + (d.getMonth()+1) + "/" + d.getDate();
      };

      // Empty state
      if (days.length === 0) {
        return (
          <div className="pt-20 pb-28 px-4 flex flex-col items-center justify-center min-h-[60vh]">
            <div className="liquid-glass rounded-[24px] p-8 text-center max-w-sm">
              <Icon name="monitoring" size={48} className="text-on-surface-variant mx-auto mb-4" />
              <h2 className="font-headline text-xl font-bold mb-2">No Insights Yet</h2>
              <p className="text-on-surface-variant text-sm">
                Log your first full day to start seeing nutrition trends and patterns here.
              </p>
            </div>
          </div>
        );
      }

      const groups = [
        { label: "Macros", keys: MACRO_KEYS },
        { label: "Vitamins", keys: VITAMIN_KEYS },
        { label: "Minerals", keys: MINERAL_KEYS },
      ];

      return (
        <div className="pt-20 pb-28 px-4 space-y-6">
          {/* Header */}
          <div>
            <h1 className="font-headline text-[34px] font-extrabold leading-tight">Insights</h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Your nutrition trends
              {sliced.length < range && sliced.length > 0 &&
                <span className="ml-1 opacity-60">({sliced.length} of {range} days)</span>
              }
            </p>
          </div>

          {/* Weekly Report Card */}
          {stats && (
            <div className="liquid-glass rounded-[24px] p-5 space-y-4">
              <h2 className="font-headline text-lg font-bold">Report Card</h2>

              {/* Stat Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="liquid-glass-light rounded-2xl p-3 text-center">
                  <div className="text-2xl font-bold">{sliced.length}</div>
                  <div className="text-xs text-on-surface-variant">Days Logged</div>
                </div>
                <div className="liquid-glass-light rounded-2xl p-3 text-center">
                  <div className="text-2xl font-bold">{Math.round(stats.avgGaps * 10) / 10}</div>
                  <div className="text-xs text-on-surface-variant">Avg Gaps Closed / 16</div>
                </div>
                <div className="liquid-glass-light rounded-2xl p-3 text-center">
                  <div className="text-2xl font-bold">
                    {stats.avgEnergy !== null ? (Math.round(stats.avgEnergy * 10) / 10) : "—"}
                  </div>
                  <div className="text-xs text-on-surface-variant">Avg Energy</div>
                </div>
                <div className="liquid-glass-light rounded-2xl p-3 text-center">
                  <div className="text-2xl font-bold">
                    {stats.avgDigestion !== null ? (Math.round(stats.avgDigestion * 10) / 10) : "—"}
                  </div>
                  <div className="text-xs text-on-surface-variant">Avg Digestion</div>
                </div>
              </div>

              {/* Top Hits */}
              {stats.topHits.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-on-surface-variant mb-2">
                    <Icon name="check_circle" size={14} className="text-green-500 mr-1 inline-block align-middle" />
                    Consistently Hit
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.topHits.map(k => (
                      <span key={k} className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400">
                        {NUTRIENT_LABELS[k]} ({Math.round(stats.hitRate[k] * sliced.length)}/{sliced.length})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Chronic Gaps */}
              {stats.chronicGaps.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-on-surface-variant mb-2">
                    <Icon name="warning" size={14} className="text-amber-500 mr-1 inline-block align-middle" />
                    Chronic Gaps
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.chronicGaps.map(k => (
                      <span key={k} className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        {NUTRIENT_LABELS[k]} ({Math.round(stats.hitRate[k] * sliced.length)}/{sliced.length})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Nutrient Heatmap */}
          <div className="liquid-glass rounded-[24px] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-lg font-bold">Nutrient Heatmap</h2>
              <div className="flex bg-on-surface/5 rounded-full p-0.5 gap-0.5">
                {[7, 14, 30].map(r => (
                  <button
                    key={r}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      range === r
                        ? "bg-gradient-to-r from-blue-600 to-blue-400 text-white shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                    onClick={() => { setRange(r); setSelectedCell(null); }}
                  >{r}d</button>
                ))}
              </div>
            </div>

            {/* Selected cell tooltip */}
            {selectedCell && (
              <div className="liquid-glass-light rounded-xl p-3 text-sm flex items-center justify-between animate-fade-in">
                <div>
                  <span className="font-semibold">{NUTRIENT_LABELS[selectedCell.key]}</span>
                  <span className="text-on-surface-variant ml-2">
                    {fmtVal(selectedCell.key, selectedCell.value)} / {getTargetStr(selectedCell.key)}
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant">{formatShortDate(selectedCell.date)}</div>
              </div>
            )}

            {/* Heatmap Grid */}
            <div data-testid="nutrient-heatmap" className="overflow-x-auto -mx-1 px-1 min-h-[18rem]" style={{ WebkitOverflowScrolling: "touch" }}>
              {/* Date headers */}
              <div
                className="heatmap-grid mb-1"
                style={heatmapGridStyle}
              >
                <div></div>
                {sliced.map((d, i) => (
                  <div key={i} className="heatmap-date">
                    {sliced.length <= 14
                      ? formatShortDate(d.date).split(" ")[0]
                      : (new Date(d.date + "T12:00:00").getDate())}
                  </div>
                ))}
              </div>

              {/* Nutrient rows grouped by category */}
              {groups.map((group, gi) => (
                <React.Fragment key={group.label}>
                  {gi > 0 && <div className="h-2" />}
                  <div className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1 pl-1">
                    {group.label}
                  </div>
                  {group.keys.map(k => {
                    return (
                      <div
                        key={k}
                        className="heatmap-grid mb-0.5"
                        style={heatmapGridStyle}
                      >
                        <div className="heatmap-label text-on-surface-variant">
                          {NUTRIENT_LABELS[k]}
                        </div>
                        {heatmapData[k].map((cell, ci) => (
                          <div
                            key={ci}
                            className="heatmap-cell cursor-pointer"
                            style={{ backgroundColor: cell.color }}
                            onClick={() => setSelectedCell(
                              selectedCell && selectedCell.key === k && selectedCell.date === cell.date
                                ? null
                                : { key: k, value: cell.value, date: cell.date, pct: cell.pct }
                            )}
                            title={NUTRIENT_LABELS[k] + ": " + fmtVal(k, cell.value)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-2 text-[10px] text-on-surface-variant pt-1">
              <span>Less</span>
              {[0, 25, 50, 75, 100].map(p => (
                <div
                  key={p}
                  className="w-3.5 h-3.5 rounded-sm"
                  style={{ backgroundColor: heatmapColor(p, isDark, false) }}
                />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // SettingsScreen
    // ============================================================
    function SettingsScreen() {
      const { apiKey, setApiKey, state, setState } = useNutrition();
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
          setState((s) => ({ ...s, cloudSync: false }));
        } else {
          if (!auth || !auth.configured) {
            setSignInError("Cloud sync is not configured yet.");
            setShowSignIn(true);
            return;
          }
          if (signedIn) {
            setState((s) => ({ ...s, cloudSync: true }));
          } else {
            setSignInError("");
            setShowSignIn(true);
          }
        }
      };

      const handleSignInSubmit = async (e) => {
        e.preventDefault();
        setSignInError("");
        setSignInBusy(true);
        try {
          await auth.signIn(signInEmail.trim(), signInPassword);
          setState((s) => ({ ...s, cloudSync: true }));
          setShowSignIn(false);
          setSignInEmail("");
          setSignInPassword("");
        } catch (err) {
          setSignInError((err && err.message) || "Sign-in failed.");
        } finally {
          setSignInBusy(false);
        }
      };

      const handleSignOut = async () => {
        try { await auth.signOut(); } catch (_) { /* ignore */ }
        setState((s) => ({ ...s, cloudSync: false }));
      };

      const maskedKey = apiKey ? "\u2022\u2022\u2022\u2022" + apiKey.slice(-4) : "Not set";

      const handleSaveKey = () => {
        setApiKey(keyInput);
        setEditingKey(false);
      };

      const handleExport = () => {
        const data = JSON.stringify({ state, exportedAt: new Date().toISOString() }, null, 2);
        const blob = new Blob([data], { type: "application/json" });
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
        setState({ ...DEFAULT_STATE });
        setApiKey("");
        setShowClearConfirm(false);
      };

      return (
        <div className="pt-20 pb-28 px-4 space-y-6">
          <h1 className="font-headline text-4xl font-extrabold">Settings</h1>

          {/* Intelligence */}
          <div className="space-y-1">
            <h2 className="text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label">Intelligence</h2>
            <div className="glass-card rounded-xl overflow-hidden">
              {/* API Key */}
              <div className="px-4 py-3.5 flex items-center gap-3 min-h-[3.5rem]">
                <div className="w-9 h-9 rounded-xl bg-blue-600/20 flex items-center justify-center">
                  <Icon name="lock" size={18} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Claude API Key</p>
                  {editingKey ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="password"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder="sk-ant-..."
                        className="flex-1 bg-on-surface/5 rounded-lg px-3 py-1.5 text-xs font-mono"
                        autoFocus
                      />
                      <button onClick={handleSaveKey} className="text-xs text-primary-fixed-dim font-semibold">Save</button>
                      <button onClick={() => { setEditingKey(false); setKeyInput(apiKey); }} className="text-xs text-on-surface-variant">Cancel</button>
                    </div>
                  ) : (
                    <p className="text-xs text-on-surface-variant font-mono">{maskedKey}</p>
                  )}
                </div>
                {!editingKey && (
                  <button onClick={() => setEditingKey(true)} className="p-1 hover:bg-on-surface/10 rounded-lg transition">
                    <Icon name="edit" size={18} className="text-on-surface-variant" />
                  </button>
                )}
              </div>

              <div className="mx-4 h-[0.5px] bg-on-surface/5" />

              {/* AI Model */}
              <div className="px-4 py-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-600/20 flex items-center justify-center">
                  <Icon name="neurology" size={18} className="text-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">AI Model</p>
                  <p className="text-xs text-on-surface-variant">{state.aiModel || "claude-sonnet-4-6"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Personalization */}
          <div className="space-y-1">
            <h2 className="text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label">Personalization</h2>
            <div className="glass-card rounded-xl overflow-hidden">
              {/* Theme */}
              <div className="px-4 py-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-600/20 flex items-center justify-center">
                  <Icon name="dark_mode" size={18} className="text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Theme</p>
                </div>
                <div className="flex bg-on-surface/5 rounded-full p-0.5 gap-0.5">
                  {["Auto", "Light", "Dark"].map((label) => (
                    <button
                      key={label}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                        (state.themeMode || "dark") === label.toLowerCase()
                          ? "pill-active text-white"
                          : "text-on-surface-variant hover:text-white"
                      }`}
                      onClick={() => setState((s) => ({ ...s, themeMode: label.toLowerCase() }))}
                    >{label}</button>
                  ))}
                </div>
              </div>

              <div className="mx-4 h-[0.5px] bg-on-surface/5" />

              {/* Nutrient Targets */}
              <div className="px-4 py-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600/20 flex items-center justify-center">
                  <Icon name="track_changes" size={18} className="text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Nutrient Targets</p>
                  <p className="text-xs text-on-surface-variant">Customize goals</p>
                </div>
                <Icon name="chevron_right" size={20} className="text-on-surface-variant" />
              </div>
            </div>
          </div>

          {/* Cloud Sync */}
          <div className="space-y-1">
            <h2 className="text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label">Cloud Sync</h2>
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="px-4 py-3.5 flex items-center gap-3 min-h-[3.5rem]">
                <div className="w-9 h-9 rounded-xl bg-cyan-600/20 flex items-center justify-center">
                  <Icon name={cloudSyncOn ? "cloud_done" : "cloud_off"} size={18} className="text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Cloud Sync</p>
                  <p className="text-xs text-on-surface-variant">
                    {cloudSyncOn
                      ? (signedIn ? `Signed in as ${auth.user && auth.user.email}` : "Signed out")
                      : "Off — data stays on this device"}
                  </p>
                </div>
                <button
                  onClick={handleCloudSyncToggle}
                  data-testid="cloud-sync-toggle"
                  aria-pressed={cloudSyncOn ? "true" : "false"}
                  className={`w-11 h-6 rounded-full transition-colors flex items-center px-0.5 ${cloudSyncOn ? "bg-blue-600" : "bg-on-surface/15"}`}
                >
                  <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${cloudSyncOn ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              {cloudSyncOn && signedIn && (
                <>
                  <div className="mx-4 h-[0.5px] bg-on-surface/5" />
                  <button
                    onClick={handleSignOut}
                    data-testid="cloud-sync-signout"
                    className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-on-surface/5 transition"
                  >
                    <div className="w-9 h-9 rounded-xl bg-on-surface/5 flex items-center justify-center">
                      <Icon name="logout" size={18} className="text-on-surface-variant" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Sign Out</p>
                      <p className="text-xs text-on-surface-variant">Disable cloud sync on this device</p>
                    </div>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Data & Privacy */}
          <div className="space-y-1">
            <h2 className="text-xs font-semibold text-on-surface-variant tracking-wide px-1 mb-2 font-label">Data & Privacy</h2>
            <div className="glass-card rounded-xl overflow-hidden">
              {/* Export */}
              <button onClick={handleExport} className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-on-surface/5 transition">
                <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Icon name="ios_share" size={18} className="text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Export All Data</p>
                  <p className="text-xs text-on-surface-variant">Download as JSON</p>
                </div>
              </button>

              <div className="mx-4 h-[0.5px] bg-on-surface/5" />

              {/* Clear */}
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-on-surface/5 transition"
              >
                <div className="w-9 h-9 rounded-xl bg-error/20 flex items-center justify-center">
                  <Icon name="delete" size={18} className="text-error" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-error">Clear All Data</p>
                  <p className="text-xs text-on-surface-variant">Remove all stored data</p>
                </div>
              </button>
            </div>
          </div>

          {/* Cloud Sync Sign-In Modal */}
          {showSignIn && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 animate-fade-in" data-testid="cloud-signin-modal">
              <div className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm" onClick={() => setShowSignIn(false)} />
              <form onSubmit={handleSignInSubmit} className="glass-sheet squircle p-6 w-full max-w-xs relative z-10 space-y-4" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-headline text-lg font-bold">Sign in to Cloud Sync</h3>
                {(!auth || !auth.configured) && (
                  <p className="text-xs text-on-surface-variant" data-testid="cloud-signin-unconfigured">
                    Cloud sync is not configured yet. Ask the project owner to provision Supabase credentials.
                  </p>
                )}
                <div className="space-y-2">
                  <input
                    type="email"
                    placeholder="Email"
                    value={signInEmail}
                    onChange={(e) => setSignInEmail(e.target.value)}
                    autoComplete="email"
                    required
                    disabled={!auth || !auth.configured || signInBusy}
                    className="w-full bg-on-surface/5 rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    disabled={!auth || !auth.configured || signInBusy}
                    className="w-full bg-on-surface/5 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                {signInError && (
                  <p className="text-xs text-error" data-testid="cloud-signin-error">{signInError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowSignIn(false); setSignInError(""); }}
                    className="flex-1 py-2.5 rounded-full border border-on-surface/10 text-sm font-semibold hover:bg-on-surface/5 transition"
                  >Cancel</button>
                  <button
                    type="submit"
                    disabled={!auth || !auth.configured || signInBusy}
                    className="flex-1 py-2.5 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition disabled:opacity-50"
                  >{signInBusy ? "Signing in…" : "Sign In"}</button>
                </div>
              </form>
            </div>
          )}

          {/* Clear Confirm Modal */}
          {showClearConfirm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 animate-fade-in">
              <div className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm" onClick={() => setShowClearConfirm(false)} />
              <div className="glass-sheet squircle p-6 w-full max-w-xs relative z-10 space-y-4" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-headline text-lg font-bold">Clear All Data?</h3>
                <p className="text-sm text-on-surface-variant">This will permanently delete all your logged meals, history, and settings. This cannot be undone.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="flex-1 py-2.5 rounded-full border border-on-surface/10 text-sm font-semibold hover:bg-on-surface/5 transition"
                  >Cancel</button>
                  <button
                    onClick={handleClear}
                    className="flex-1 py-2.5 rounded-full bg-error text-white text-sm font-semibold hover:bg-error/80 transition"
                  >Clear</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ============================================================
    // Fallback telemetry (silent, DI wiring for Modules.Fallbacks)
    // ============================================================
    const _fallbackDedupeSet = new Set();
    function onFallbackTriggered(ctx) {
      var dedupeKey = ctx.key + ":" + ctx.reason;
      if (_fallbackDedupeSet.has(dedupeKey)) return;
      _fallbackDedupeSet.add(dedupeKey);
      if (typeof window !== "undefined" && window.__tracer) {
        window.__tracer
          .startSpan("nutrient.fallback", ctx)
          .end(ctx.reason === "FALLBACK_CONFIG_ERROR" ? "error" : "ok");
      }
    }

    function resolveCalorieTarget(profile) {
      return Modules.Fallbacks.resolveTarget("calories", profile, {
        defaults: FALLBACK_DEFAULTS,
        onFallbackTriggered: onFallbackTriggered,
      });
    }

    // ============================================================
    // OnboardingSheet (first-login only)
    // ============================================================
    function OnboardingSheet({ onClose }) {
      const { setState } = useNutrition();
      const [step, setStep] = useState(0);
      const [answers, setAnswers] = useState({ calories: 2400, goal: "maintain", diet: "omnivore", protein: "standard" });
      const [closing, setClosing] = useState(false);

      const handleClose = () => {
        setClosing(true);
        setTimeout(onClose, 250);
      };

      const handleSkip = () => {
        setState((s) => ({ ...s, onboardingProfile: { skipped: true, completed: false } }));
        handleClose();
      };

      const handleFinish = () => {
        var profile = Modules.Fallbacks.buildProfile(answers);
        setState((s) => ({ ...s, onboardingProfile: profile }));
        handleClose();
      };

      const steps = [
        {
          title: "Daily calorie target",
          desc: "How many calories do you aim for per day?",
          render: () => (
            <div className="space-y-3">
              <input
                type="number"
                min="1000"
                max="6000"
                step="100"
                value={answers.calories}
                onChange={(e) => {
                  var v = parseInt(e.target.value, 10);
                  if (v >= 1000 && v <= 6000) setAnswers((a) => ({ ...a, calories: v }));
                }}
                className="w-full px-4 py-3 rounded-2xl bg-on-surface/5 text-on-surface font-body text-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-on-surface-variant">Between 1,000 and 6,000 kcal</p>
            </div>
          ),
        },
        {
          title: "Primary goal",
          desc: "What best describes your current goal?",
          render: () => (
            <div className="space-y-2">
              {[["maintain", "Maintain weight"], ["lose", "Lose weight"], ["gain", "Gain weight"]].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setAnswers((a) => ({ ...a, goal: val }))}
                  className={`w-full px-4 py-3 rounded-2xl text-left font-body transition ${
                    answers.goal === val ? "bg-blue-600 text-white" : "bg-on-surface/5 text-on-surface"
                  }`}
                >{label}</button>
              ))}
            </div>
          ),
        },
        {
          title: "Dietary pattern",
          desc: "This helps set supplement defaults.",
          render: () => (
            <div className="space-y-2">
              {[["omnivore", "Omnivore"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"]].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setAnswers((a) => ({ ...a, diet: val }))}
                  className={`w-full px-4 py-3 rounded-2xl text-left font-body transition ${
                    answers.diet === val ? "bg-blue-600 text-white" : "bg-on-surface/5 text-on-surface"
                  }`}
                >{label}</button>
              ))}
            </div>
          ),
        },
        {
          title: "Protein emphasis",
          desc: "Higher protein adjusts your protein target upward.",
          render: () => (
            <div className="space-y-2">
              {[["standard", "Standard"], ["high", "High protein"]].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setAnswers((a) => ({ ...a, protein: val }))}
                  className={`w-full px-4 py-3 rounded-2xl text-left font-body transition ${
                    answers.protein === val ? "bg-blue-600 text-white" : "bg-on-surface/5 text-on-surface"
                  }`}
                >{label}</button>
              ))}
            </div>
          ),
        },
      ];

      var current = steps[step];
      var isLast = step === steps.length - 1;

      return (
        <div className="fixed inset-0 z-[60] animate-fade-in">
          <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm" />
          <div className={`absolute bottom-0 left-0 right-0 bg-surface-container dark:bg-[#0a0a0a] modal-sheet max-h-[85vh] flex flex-col ${closing ? "animate-slide-down" : "animate-slide-up"}`}>
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-on-surface/20" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3">
              <h2 className="font-headline text-lg font-bold">{current.title}</h2>
              <button onClick={handleSkip} className="text-sm text-on-surface-variant hover:text-on-surface transition">Skip</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-6">
              <p className="text-sm text-on-surface-variant mb-4">{current.desc}</p>
              {current.render()}
            </div>
            <div className="px-5 pb-6 pt-2 flex gap-3">
              {step > 0 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="flex-1 py-3 rounded-2xl bg-on-surface/5 text-on-surface font-semibold font-label transition hover:bg-on-surface/10"
                >Back</button>
              )}
              <button
                onClick={isLast ? handleFinish : () => setStep(step + 1)}
                className="flex-1 py-3 rounded-2xl bg-blue-600 text-white font-semibold font-label transition hover:bg-blue-700"
              >{isLast ? "Finish" : "Next"}</button>
            </div>
            <div className="flex justify-center pb-4 gap-1.5">
              {steps.map((_, i) => (
                <div key={i} className={`w-2 h-2 rounded-full transition ${i === step ? "bg-blue-500" : "bg-on-surface/20"}`} />
              ))}
            </div>
          </div>
        </div>
      );
    }

    // OnboardingGate: renders OnboardingSheet for first-login signed-in users
    function OnboardingGate() {
      const { state } = useNutrition();
      const auth = useAuth();
      const [dismissed, setDismissed] = useState(false);

      if (dismissed) return null;
      if (!auth || auth.status !== "signed_in") return null;
      if (state.onboardingProfile) return null;

      return <OnboardingSheet onClose={() => setDismissed(true)} />;
    }

    // ============================================================
    // App
    // ============================================================
    function App() {
      const [activeTab, setActiveTab] = useState("home");
      const [showLogSheet, setShowLogSheet] = useState(false);

      const handleTabChange = useCallback((tab) => {
        if (tab === "home" && activeTab === "home" && !showLogSheet) {
          setShowLogSheet(true);
        } else {
          setActiveTab(tab);
        }
      }, [activeTab, showLogSheet]);

      return (
        <NutritionProvider>
          <AuthProvider>
          <ToastProvider>
            <CloudSync />
            <AppHeader />

            {activeTab === "home" && (
              <HomeScreen
                onOpenLog={() => setShowLogSheet(true)}
                onTabChange={handleTabChange}
              />
            )}
            {activeTab === "dashboard" && <DashboardScreen />}
            {activeTab === "insights" && <InsightsScreen />}
            {activeTab === "settings" && <SettingsScreen />}

            {showLogSheet && <LogDaySheet onClose={() => setShowLogSheet(false)} />}

            <OnboardingGate />

            <Toast />
            <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
          </ToastProvider>
          </AuthProvider>
        </NutritionProvider>
      );
    }

    // ============================================================
    // Service Worker registration (Phase 7).
    // Registers /sw.js after first paint. The controllerchange listener
    // is the stuck-shell guard: when a new SW activates via skipWaiting +
    // clients.claim, the page's controller flips and we reload once to
    // pick up the fresh shell.
    // ============================================================
    if ("serviceWorker" in navigator) {
      // Only reload on controllerchange when there was already a controller
      // at registration time. On first install, controller flips null →
      // active and the page is already running fresh — reloading then would
      // disrupt every initial page load (and break Playwright tests).
      const __hadController = navigator.serviceWorker.controller !== null;
      let __swReloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!__hadController) return;
        if (__swReloading) return;
        __swReloading = true;
        window.location.reload();
      });
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }

    // ============================================================
    // Mount
    // ============================================================
    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(<App />);
