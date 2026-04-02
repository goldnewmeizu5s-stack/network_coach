import { useState, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Home from "./pages/Home";
import People from "./pages/People";
import ContactProfile from "./pages/ContactProfile";
import Challenge from "./pages/Challenge";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";

type Tab = "home" | "people" | "challenge" | "chat" | "settings";

const tabs: { id: Tab; path: string; label: string; icon: string }[] = [
  { id: "home", path: "/", label: "Home", icon: "\u{1F3E0}" },
  { id: "people", path: "/people", label: "People", icon: "\u{1F465}" },
  { id: "challenge", path: "/challenges", label: "Challenge", icon: "\u{1F3AF}" },
  { id: "chat", path: "/chat", label: "Chat", icon: "\u{1F4AC}" },
  { id: "settings", path: "/settings", label: "Settings", icon: "\u2699\uFE0F" },
];

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
    <div className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-xs animate-fade-in">
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
    </div>
  );
}

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = tabs.find((t) =>
    t.path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(t.path)
  )?.id || "home";

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 flex h-[60px] w-full max-w-[430px] -translate-x-1/2 items-center justify-around border-t border-neutral-800 bg-bg/95 backdrop-blur-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => navigate(t.path)}
          className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
            activeTab === t.id ? "text-accent" : "text-neutral-500"
          }`}
        >
          <span className="text-lg">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function AuthedLayout() {
  return (
    <div className="mx-auto flex h-full max-w-[430px] flex-col">
      <main className="flex flex-1 flex-col overflow-y-auto pb-[76px]">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/people" element={<People />} />
          <Route path="/people/:id" element={<ContactProfile />} />
          <Route path="/challenges" element={<Challenge />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
      <AuthedLayout />
    </BrowserRouter>
  );
}

export default App;
