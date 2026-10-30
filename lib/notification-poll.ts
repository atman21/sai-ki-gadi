export const NOTIFICATION_POLL_INTERVAL_MS = 12000;

export type NotificationPollStatus = "connecting" | "live" | "offline";

export type NotificationPollState = {
  status: NotificationPollStatus;
  lastSuccessAt: string | null;
};

type Listener = (state: NotificationPollState) => void;

let current: NotificationPollState = {
  status: "connecting",
  lastSuccessAt: null,
};

const listeners = new Set<Listener>();

export function getNotificationPollState(): NotificationPollState {
  return current;
}

export function setNotificationPollState(state: NotificationPollState): void {
  current = state;
  for (const listener of listeners) listener(current);
}

export function subscribeNotificationPoll(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
