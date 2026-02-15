import { useEffect, useState } from "react";

export type NotificationType = "error" | "info" | "success" | "warning";

export type NotificationItem = {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number;
  onClose?: () => void;
};

type NotificationProps = {
  notification: NotificationItem;
  onDismiss: (id: string) => void;
};

const typeStyles: Record<NotificationType, { bg: string; border: string; icon: string }> = {
  error: {
    bg: "bg-red-50",
    border: "border-red-200",
    icon: "text-red-600",
  },
  info: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: "text-blue-600",
  },
  success: {
    bg: "bg-[#CDF056]",
    border: "border-[#CDF056]",
    icon: "text-[#011b2d]",
  },
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    icon: "text-amber-600",
  },
};

function Notification({ notification, onDismiss }: NotificationProps) {
  const [isVisible, setIsVisible] = useState(false);
  const { id, message, type, duration = 5000 } = notification;
  const styles = typeStyles[type];

  useEffect(() => {
    // Trigger enter animation on mount
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onDismiss(id), 300); // Wait for exit animation
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      notification.onClose?.();
      onDismiss(id);
    }, 300);
  };

  const typeIcons: Record<NotificationType, React.ReactNode> = {
    error: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  };

  return (
    <div
      role="alert"
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg min-w-[320px] max-w-[480px]
        transition-all duration-300 ease-out
        ${styles.bg} ${styles.border}
        ${isVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"}
      `}
    >
      <div className={styles.icon}>{typeIcons[type]}</div>
      <p className="flex-1 text-sm text-gray-800 whitespace-pre-wrap">{message}</p>
      <button
        type="button"
        onClick={handleClose}
        className="p-1 rounded hover:bg-black/5 text-gray-500 hover:text-gray-700 transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default Notification;
