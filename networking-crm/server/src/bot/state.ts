const EXPIRE_MS = 5 * 60 * 1000; // 5 minutes

export interface UserState {
  action: string;
  data: Record<string, unknown>;
  expiresAt: number;
}

const store = new Map<number, UserState>();

export function setState(
  chatId: number,
  action: string,
  data: Record<string, unknown> = {},
): void {
  store.set(chatId, {
    action,
    data,
    expiresAt: Date.now() + EXPIRE_MS,
  });
}

export function getState(chatId: number): UserState | null {
  const s = store.get(chatId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    store.delete(chatId);
    return null;
  }
  return s;
}

export function clearState(chatId: number): void {
  store.delete(chatId);
}
