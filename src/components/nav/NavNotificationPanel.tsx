"use client";
// src/components/nav/NavNotificationPanel.tsx
// ─── Notification bell + dropdown panel ──────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  getNotifIcon,
  getNotifIconBg,
  formatRelativeTime,
} from "./nav-helpers";

export interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

interface Props {
  notifications: NotifItem[];
  hasUnread: boolean;
  onMarkAllRead: () => void;
}

export default function NavNotificationPanel({
  notifications,
  hasUnread,
  onMarkAllRead,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleToggle = useCallback(() => {
    const opening = !open;
    setOpen(opening);
    if (opening) onMarkAllRead();
  }, [open, onMarkAllRead]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative w-9 h-9 rounded-xl flex items-center justify-center text-[#73706A] hover:text-[#141414] hover:bg-[#F8F7F4] transition-colors"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {hasUnread && (
          <span
            className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#D4A843] ring-2 ring-white"
            aria-label="Unread notifications"
          />
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-[#E3E0D9] rounded-2xl shadow-xl overflow-hidden z-[300]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#F0EDE8]">
            <p className="text-[13px] font-semibold text-[#141414]">
              Notifications
            </p>
            <button
              className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-[#141414] text-white hover:opacity-80 active:scale-95 transition-all"
              onClick={onMarkAllRead}
            >
              Mark all read
            </button>
          </div>
          <div>
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] text-[#9E9A91]">
                  No notifications yet
                </p>
              </div>
            ) : (
              notifications.slice(0, 5).map((n) => (
                <Link
                  key={n.id}
                  href={n.link ?? "/notifications"}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-[#F8F7F4] last:border-b-0 relative"
                >
                  {!n.isRead && (
                    <span
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500 shrink-0"
                      aria-label="Unread"
                    />
                  )}
                  <span
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 ${getNotifIconBg(n.type)}`}
                  >
                    {getNotifIcon(n.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-[12.5px] text-[#141414] leading-snug ${!n.isRead ? "font-semibold" : ""}`}
                    >
                      {n.title}
                    </p>
                    <p className="text-[11px] text-[#73706A] mt-0.5 line-clamp-2">
                      {n.body}
                    </p>
                    <p className="text-[10px] text-[#C9C5BC] mt-1">
                      {formatRelativeTime(n.createdAt)}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
          <Link
            href="/notifications"
            className="block w-full text-center px-4 py-3.5 text-[12.5px] font-semibold text-[#141414] hover:bg-gray-50 transition-colors border-t border-[#F0EDE8]"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
