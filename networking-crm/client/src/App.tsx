import { useState, useEffect, useCallback, Suspense, lazy } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Home as HomeIcon, Users, Target, MessageCircle, ClipboardList, NotebookText } from "lucide-react";
import { ToastProvider, useToast } from "./components/Toast";
import { SkeletonList } from "./components/Skeleton";
import Onboarding from "./components/Onboarding";
import ErrorBoundary from "./components/ErrorBoundary";
import { api } from "./lib/api";

// Lazy-loaded pages
const Home = lazy(() => import("./pages/Home"));
const People = lazy(() => import("./pages/People"));
const ContactProfile = lazy(() => import("./pages/ContactProfile"));
const FollowUps = lazy(() => import("./pages/FollowUps"));
const Challenge = lazy(() => import("./pages/Challenge"));
const Chat = lazy(() => import("./pages/Chat"));
const Notes = lazy(() => import("./pages/Notes"));
const Settings = lazy(() => import("./pages/Settings"));
const Rank = lazy(() => import("./pages/Rank"));

const isTelegramWebApp = !!window.Telegram?.WebApp?.initData;

type Tab = "home" | "people" | "challenge" | "chat" | "followups" | "notes";

const TAB_ICONS = {
  home: HomeIcon,
  people: Users,
  challenge: Target,
  chat: MessageCircle,
  followups: ClipboardList,
  notes: NotebookText,
};

const tabs: { id: Tab; path: string; label: string }[] = [
  { id: "home", path: "/", label: "Home" },
  { id: "people", path: "/people", label: "People" },
  { id: "notes", path: "/notes", label: "Memory" },
  { id: "followups", path: "/followups", label: "Tasks" },
  { id: "challenge", path: "/challenges", label: "Challenge" },
  { id: "chat", path: "/chat", label: "Chat" },
];

function PageFallback() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pt-6">
      <SkeletonList count={4} />
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { show } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (data.valid) {
        onLogin();
      } else {
        setError("Неверный PIN-код");
      }
    } catch {
      show("Нет соединения с сервером");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="flex min-h-screen items-center justify-center px-6 safe-top"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <h1 className="mb-8 text-center text-3xl font-bold text-white">
          Networking CRM
        </h1>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="PIN-код"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="mb-4 w-full rounded-xl bg-card px-4 py-3 text-center text-lg text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
        />
        {error && (
          <p className="mb-4 text-center text-sm text-rec">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !pin.trim()}
          className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white transition-colors active:bg-accent-hover disabled:opacity-50"
        >
          {loading ? "Проверка..." : "Войти"}
        </button>
      </form>
    </motion.div>
  );
}

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab =
    tabs.find((t) =>
      t.path === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(t.path)
    )?.id || null;

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-[430px] -translate-x-1/2 items-center justify-around border-t border-white/5 bg-bg/95 backdrop-blur-sm tab-bar-safe"
      role="tablist"
      aria-label="Main navigation"
    >
      {tabs.map((t) => {
        const Icon = TAB_ICONS[t.id];
        const isActive = activeTab === t.id;
        return (
          <motion.button
            key={t.id}
            onClick={() => navigate(t.path)}
            whileTap={{ scale: 0.9 }}
            role="tab"
            aria-selected={isActive}
            aria-label={t.label}
            className={`relative flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? "text-accent" : "text-neutral-500"
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="tab-dot"
                className="absolute -top-px h-0.5 w-6 rounded-full bg-accent"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
            <span>{t.label}</span>
          </motion.button>
        );
      })}
    </nav>
  );
}

function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem("install_dismissed");
    if (dismissed) {
      const ts = parseInt(dismissed, 10);
      if (Date.now() - ts < 7 * 86400000) return; // 7 days
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!show) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    (deferredPrompt as unknown as { prompt: () => void }).prompt();
    setShow(false);
  };

  const handleDismiss = () => {
    localStorage.setItem("install_dismissed", String(Date.now()));
    setShow(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="mx-4 mb-3 flex items-center gap-3 rounded-2xl bg-accent/10 p-3 ring-1 ring-accent/20"
    >
      <div className="flex-1">
        <p className="text-sm font-medium text-white">Установить приложение</p>
        <p className="text-xs text-neutral-400">Быстрый доступ с домашнего экрана</p>
      </div>
      <button
        onClick={handleInstall}
        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
      >
        Установить
      </button>
      <button
        onClick={handleDismiss}
        className="text-xs text-neutral-500"
      >
        &times;
      </button>
    </motion.div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={false}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="flex flex-1 flex-col"
      >
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes location={location}>
              <Route path="/" element={<Home />} />
              <Route path="/people" element={<People />} />
              <Route path="/people/:id" element={<ContactProfile />} />
              <Route path="/followups" element={<FollowUps />} />
              <Route path="/challenges" element={<Challenge />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/rank" element={<Rank />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

function TelegramBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    // Show back button on sub-pages, hide on main tabs
    const isSubPage =
      !!location.pathname.match(/^\/people\/[^/]+$/) ||
      location.pathname === "/rank" ||
      location.pathname === "/settings";
    if (isSubPage) {
      tg.BackButton.show();
      const handler = () => navigate(-1);
      tg.BackButton.onClick(handler);
      return () => tg.BackButton.hide();
    } else {
      tg.BackButton.hide();
    }
  }, [navigate, location.pathname]);

  return null;
}

function AuthedLayout() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  const checkOnboarding = useCallback(async () => {
    if (localStorage.getItem("onboarding_completed")) {
      setOnboardingChecked(true);
      return;
    }
    try {
      const [stats, profile] = await Promise.all([
        api.get<{ total_contacts: number }>("/stats"),
        api.get<{ goals: string | null }>("/user/profile"),
      ]);
      if (stats.total_contacts === 0 && !profile.goals) {
        setShowOnboarding(true);
      }
    } catch {
      // If check fails, skip onboarding
    }
    setOnboardingChecked(true);
  }, []);

  useEffect(() => {
    checkOnboarding();
  }, [checkOnboarding]);

  return (
    <div className={`mx-auto flex h-full max-w-[430px] flex-col ${isTelegramWebApp ? "pt-1" : ""}`}>
      <main className="flex flex-1 flex-col overflow-y-auto content-pb">
        <ScrollToTop />
        {isTelegramWebApp && <TelegramBackButton />}
        {!isTelegramWebApp && <InstallBanner />}
        <AnimatedRoutes />
      </main>
      <BottomNav />
      {onboardingChecked && showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem("authed"));
  const [checking, setChecking] = useState(!sessionStorage.getItem("authed"));

  // Initialize Telegram WebApp
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor("#0f0f0f");
      tg.setBackgroundColor("#0f0f0f");
    }
  }, []);

  // On mount, verify session cookie is still valid
  useEffect(() => {
    if (sessionStorage.getItem("authed")) return;

    const tg = window.Telegram?.WebApp;

    // If opened from Telegram — try Telegram auth
    if (tg?.initData) {
      fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ initData: tg.initData }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            sessionStorage.setItem("authed", "1");
            setAuthed(true);
          }
        })
        .catch(() => {})
        .finally(() => setChecking(false));
      return; // Don't do regular session check
    }

    // Regular cookie session check
    fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          sessionStorage.setItem("authed", "1");
          setAuthed(true);
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = () => {
    sessionStorage.setItem("authed", "1");
    setAuthed(true);
  };

  if (checking) return null;

  return (
    <ToastProvider>
      <BrowserRouter>
        {!authed ? (
          <LoginScreen onLogin={handleLogin} />
        ) : (
          <AuthedLayout />
        )}
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
