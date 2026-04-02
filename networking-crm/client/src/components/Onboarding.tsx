import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Props {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [goals, setGoals] = useState("");
  const [fears, setFears] = useState("");
  const [saving, setSaving] = useState(false);

  const finish = async () => {
    setSaving(true);
    try {
      await api.put("/user/profile", {
        name: name.trim() || "User",
        goals: goals.trim() || null,
        fears: fears.trim() || null,
      });
    } catch {
      // continue even if save fails
    }
    localStorage.setItem("onboarding_completed", "true");
    setSaving(false);
    onComplete();
  };

  const next = () => {
    if (step < 2) setStep(step + 1);
    else finish();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg">
      <div className="w-full max-w-[400px] px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.2 }}
          >
            {step === 0 && (
              <div className="flex flex-col items-center gap-6">
                <div className="text-5xl">{"\u{1F91D}"}</div>
                <div className="text-center">
                  <h1 className="text-2xl font-bold text-white">
                    Networking CRM
                  </h1>
                  <p className="mt-2 text-sm text-neutral-400">
                    Твой AI-помощник в нетворкинге
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Как тебя зовут?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className="w-full rounded-xl bg-card px-4 py-3 text-center text-lg text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
                />
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-5">
                <h2 className="text-center text-xl font-bold text-white">
                  Расскажи о себе
                </h2>
                <div>
                  <label className="mb-1.5 block text-xs text-neutral-500">
                    Какие у тебя цели в нетворкинге?
                  </label>
                  <textarea
                    value={goals}
                    onChange={(e) => setGoals(e.target.value)}
                    placeholder="Найти партнёров, менторов, друзей..."
                    rows={3}
                    autoFocus
                    className="w-full resize-none rounded-xl bg-card px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-neutral-500">
                    Что тебе сложно в общении?
                  </label>
                  <textarea
                    value={fears}
                    onChange={(e) => setFears(e.target.value)}
                    placeholder="Начинать разговор, поддерживать связь..."
                    rows={3}
                    className="w-full resize-none rounded-xl bg-card px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col items-center gap-6">
                <div className="text-5xl">{"\u{1F3A4}"}</div>
                <div className="text-center">
                  <h2 className="text-xl font-bold text-white">Готово!</h2>
                  <p className="mt-2 text-sm text-neutral-400">
                    Запиши голосовое о первом знакомстве — и AI начнёт помогать
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Button + dots */}
        <div className="mt-8 flex flex-col items-center gap-5">
          <button
            onClick={next}
            disabled={saving}
            className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:bg-accent-hover disabled:opacity-50"
          >
            {saving
              ? "Сохранение..."
              : step < 2
                ? "Далее \u2192"
                : "Начать"}
          </button>

          {/* Dots */}
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-colors ${
                  i === step ? "bg-accent" : "bg-neutral-700"
                }`}
              />
            ))}
          </div>

          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              className="text-xs text-neutral-500 active:text-neutral-300"
            >
              Пропустить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
