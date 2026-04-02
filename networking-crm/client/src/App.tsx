import { useState, useEffect, Suspense, lazy } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Home as HomeIcon, Users, Target, MessageCircle, Settings as SettingsIcon } from "lucide-react";
import { ToastProvider } from "./components/Toast";
import { SkeletonList } from "./components/Skeleton";

// Lazy-loaded pages
const Home = lazy(() => import("./pages/Home"));
const People = lazy(() => import("./pages/People"));
const ContactProfile = lazy(() => import("./pages/ContactProfile"));
const FollowUps = lazy(() => import("./pages/FollowUps"));
const Challenge = lazy(() => import("./pages/Challenge"));
const Chat = lazy(() => import("./pages/Chat"));
const Settings = lazy(() => import("./pages/Settings"));

type Tab = "home" | "people" | "challenge" | "chat" | "settings";

const TAB_ICONS = {
  home: HomeIcon,
  people: Users,
  challenge: Target,
  chat: MessageCircle,
  settings: SettingsIcon,
};

const tabs: { id: Tab; path: string; label: string }[] = [
  { id: "home", path: "/", label: "Home" },
  { id: "people", path: "/people", label: "People" },
  { id: "challenge", path: "/challenges", label: "Challenge" },
  { id: "chat", path: "/chat", label: "Chat" },
  { id: "settings", path: "/settings", label: "Settings" },
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-pin": pin,
        },
      });
      const data = await res.json();
      if (data.valid) {
        sessionStorage.setItem("pin", pin);
        onLogin();
      } else {
        setError("Неверный PIN-код");
      }
    } catch {
      setError("Ошибка соединения");
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
    )?.id || "home";

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
    document.querySelector("main")?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex flex-1 flex-col"
      >
        <Suspense fallback={<PageFallback />}>
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/people" element={<People />} />
            <Route path="/people/:id" element={<ContactProfile />} />
            <Route path="/followups" element={<FollowUps />} />
            <Route path="/challenges" element={<Challenge />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function AuthedLayout() {
  return (
    <div className="mx-auto flex h-full max-w-[430px] flex-col">
      <main className="flex flex-1 flex-col overflow-y-auto content-pb">
        <ScrollToTop />
        <InstallBanner />
        <AnimatedRoutes />
      </main>
      <BottomNav />
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem("pin"));

  useEffect(() => {
    const onStorage = () => {
      if (!sessionStorage.getItem("pin")) setAuthed(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthedLayout />
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
