import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { FollowUpItem, getDueDateInfo } from "../lib/followups";
import FollowUpCard from "../components/FollowUpCard";

export default function FollowUps() {
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<FollowUpItem[]>("/followups?limit=50");
      setItems(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const handleRemoved = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  // Group items by urgency
  const groups = groupByUrgency(items);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <span className="text-4xl">{"\u{1F389}"}</span>
        <p className="text-lg font-medium text-white">
          Всё чисто! Нет активных задач
        </p>
        <p className="text-sm text-neutral-400">
          Запишите голосовое о новом знакомстве
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-4 pt-6">
      <h1 className="mb-5 text-xl font-bold text-white">Follow-ups</h1>

      {groups.overdue.length > 0 && (
        <GroupSection
          title="Просроченные"
          color="#ef4444"
          items={groups.overdue}
          onRemoved={handleRemoved}
        />
      )}
      {groups.today.length > 0 && (
        <GroupSection
          title="Сегодня"
          color="#eab308"
          items={groups.today}
          onRemoved={handleRemoved}
        />
      )}
      {groups.upcoming.length > 0 && (
        <GroupSection
          title="Эта неделя"
          color="#6b7280"
          items={groups.upcoming}
          onRemoved={handleRemoved}
        />
      )}
      {groups.later.length > 0 && (
        <GroupSection
          title="Позже"
          color="#4b5563"
          items={groups.later}
          onRemoved={handleRemoved}
        />
      )}

      {groups.overdue.length > 0 &&
        groups.today.length === 0 &&
        groups.upcoming.length === 0 &&
        groups.later.length === 0 && (
          <p className="mt-4 text-center text-sm text-neutral-500">
            Есть просроченные задачи. Не страшно — начни с одной!
          </p>
        )}
    </div>
  );
}

function GroupSection({
  title,
  color,
  items,
  onRemoved,
}: {
  title: string;
  color: string;
  items: FollowUpItem[];
  onRemoved: (id: string) => void;
}) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {title} ({items.length})
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <FollowUpCard key={item.id} item={item} onRemoved={onRemoved} />
        ))}
      </div>
    </section>
  );
}

function groupByUrgency(items: FollowUpItem[]) {
  const groups: Record<string, FollowUpItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    later: [],
  };

  for (const item of items) {
    const info = getDueDateInfo(item.due_date);
    groups[info.urgency].push(item);
  }

  return groups;
}
