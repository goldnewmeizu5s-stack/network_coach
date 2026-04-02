export default function ErrorState({
  message = "Не удалось загрузить данные",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-12 text-center">
      <span className="text-3xl">{"\u26A0\uFE0F"}</span>
      <p className="text-sm text-neutral-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-xl bg-card px-4 py-2.5 text-sm text-neutral-300 ring-1 ring-neutral-700 active:bg-card-hover"
        >
          Попробовать снова
        </button>
      )}
    </div>
  );
}
