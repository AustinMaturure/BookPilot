import { createContext, useCallback, useContext, useState } from "react";
import Notification, { type NotificationItem, type NotificationType } from "../components/Notification";

type NotificationContextValue = {
  notify: (message: string, type?: NotificationType, options?: { duration?: number }) => void;
  error: (message: string, options?: { duration?: number }) => void;
  info: (message: string, options?: { duration?: number }) => void;
  success: (message: string, options?: { duration?: number }) => void;
  warning: (message: string, options?: { duration?: number }) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

let idCounter = 0;
const generateId = () => `notification-${++idCounter}-${Date.now()}`;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback(
    (message: string, type: NotificationType = "info", options?: { duration?: number }) => {
      const id = generateId();
      setNotifications((prev) => [...prev, { id, message, type, duration: options?.duration ?? 5000 }]);
      return id;
    },
    []
  );

  const value: NotificationContextValue = {
    notify: addNotification,
    error: (msg, opts) => addNotification(msg, "error", opts),
    info: (msg, opts) => addNotification(msg, "info", opts),
    success: (msg, opts) => addNotification(msg, "success", opts),
    warning: (msg, opts) => addNotification(msg, "warning", opts),
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {/* Toast container - fixed top center */}
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none"
        style={{ width: "min(480px, calc(100vw - 2rem))" }}
      >
        <div className="flex flex-col items-center gap-2 w-full pointer-events-auto">
          {notifications.map((n) => (
            <Notification key={n.id} notification={n} onDismiss={removeNotification} />
          ))}
        </div>
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotification must be used within NotificationProvider");
  }
  return ctx;
}
