import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useNotificationContext } from "../hooks/useNotificationContext";
import type { Notification } from "../context/NotificationContext.types";
import NotificationItem from "./NotificationItem";

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const { notifications, markAsRead, markAllAsRead, clearAll, clearRead, unreadCount } = useNotificationContext();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const groupedNotifications = notifications.reduce((acc: Record<string, Notification[]>, notif) => {
    const date = new Date(notif.timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    let group = "Older";
    if (date.toDateString() === today.toDateString()) {
      group = "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      group = "Yesterday";
    }

    if (!acc[group]) acc[group] = [];
    acc[group].push(notif);
    return acc;
  }, {});

  const groups = ["Today", "Yesterday", "Older"].filter(g => groupedNotifications[g] && groupedNotifications[g].length > 0);

  return (
    <>
      {/* Backdrop for mobile/closing */}
      <div className="fixed inset-0 z-40 md:hidden" onClick={onClose}></div>
      
      <div ref={panelRef} role="dialog" aria-modal="false" aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`} className="absolute right-0 top-full mt-2 w-80 md:w-96 max-h-[calc(100vh-5rem)] bg-stellar-card border border-stellar-border rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {unreadCount > 0 ? `${unreadCount} unread notifications` : "No unread notifications"}
        </div>
        <div className="p-4 border-b border-stellar-border flex justify-between items-center bg-stellar-dark/50">
          <div>
            <h3 className="text-lg font-bold text-white">Notifications</h3>
            {unreadCount > 0 && (
              <p className="text-xs text-stellar-text-secondary">{unreadCount} unread</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={markAllAsRead}
              className="text-xs text-stellar-blue hover:underline focus:outline-none"
            >
              Mark all as read
            </button>
            <button
              onClick={clearRead}
              className="text-xs text-stellar-blue hover:underline focus:outline-none"
            >
              Clear read
            </button>
            <button
              onClick={onClose}
              aria-label="Close notifications panel"
              className="text-stellar-text-secondary hover:text-white md:hidden"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-grow overflow-y-auto custom-scrollbar">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-stellar-text-secondary">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <p>All caught up!</p>
            </div>
          ) : (
            groups.map(group => (
              <div key={group}>
                <div className="px-4 py-2 bg-stellar-dark/30 text-[10px] uppercase tracking-wider font-bold text-stellar-text-muted border-b border-stellar-border">
                  {group}
                </div>
                {groupedNotifications[group].map(notif => (
                  <NotificationItem key={notif.id} notification={notif} onRead={markAsRead} />
                ))}
              </div>
            ))
          )}
        </div>

        {notifications.length > 0 && (
          <div className="p-3 border-t border-stellar-border bg-stellar-dark/50 flex justify-between">
            <button 
              onClick={clearAll}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Clear all notifications
            </button>
            <Link 
              to="/settings#notifications" 
              className="text-xs text-stellar-text-secondary hover:text-white transition-colors flex items-center gap-1"
              onClick={onClose}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              </svg>
              Settings
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
