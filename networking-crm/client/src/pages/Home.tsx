import { useState } from "react";
import VoiceRecorder from "../components/VoiceRecorder";

export default function Home() {
  const [showRecorder, setShowRecorder] = useState(false);

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pt-6">
      <h1 className="text-2xl font-bold text-white">Networking CRM</h1>

      {/* Quick actions */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Быстрые действия
        </h2>
        <button
          onClick={() => setShowRecorder(true)}
          className="flex w-full items-center gap-4 rounded-2xl bg-card p-4 transition-colors active:bg-neutral-800"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rec/20">
            <svg className="h-6 w-6 text-rec" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
            </svg>
          </div>
          <div className="text-left">
            <p className="font-medium text-white">Записать голосовое</p>
            <p className="text-sm text-neutral-400">Расскажите о новом контакте</p>
          </div>
        </button>
      </section>

      {/* Today's challenge placeholder */}
      <section className="rounded-2xl bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Сегодняшний челлендж
        </h2>
        <p className="text-neutral-400">Скоро здесь появится ежедневный вызов</p>
      </section>

      {/* Urgent follow-ups placeholder */}
      <section className="rounded-2xl bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Срочные follow-ups
        </h2>
        <p className="text-neutral-400">Нет срочных напоминаний</p>
      </section>

      {/* Stats placeholder */}
      <section className="rounded-2xl bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Статистика
        </h2>
        <p className="text-neutral-400">Данные пока не собраны</p>
      </section>

      {showRecorder && <VoiceRecorder onClose={() => setShowRecorder(false)} />}
    </div>
  );
}
