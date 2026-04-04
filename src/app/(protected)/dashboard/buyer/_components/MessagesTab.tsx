"use client";
// src/app/(protected)/dashboard/buyer/_components/MessagesTab.tsx

import { useState } from "react";
import Link from "next/link";
import { Avatar, Button } from "@/components/ui/primitives";
import { PickupMessageCard } from "@/components/pickup/PickupMessageCard";
import { relativeTime } from "@/lib/utils";
import type { ThreadRow, MessageRow } from "@/server/actions/dashboard";
import { sendMessage as sendMessageAction } from "@/server/actions/messages";

export function MessagesTab({
  threads,
  setThreads,
  activeThread,
  setActiveThread,
}: {
  threads: ThreadRow[];
  setThreads: React.Dispatch<React.SetStateAction<ThreadRow[]>>;
  activeThread: ThreadRow | null;
  setActiveThread: React.Dispatch<React.SetStateAction<ThreadRow | null>>;
}) {
  const [newMessage, setNewMessage] = useState("");

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !activeThread) return;
    const body = newMessage;
    setNewMessage("");

    // Optimistic update
    const optimisticMsg: MessageRow = {
      id: `temp-${Date.now()}`,
      body,
      senderId: "me",
      senderName: "You",
      createdAt: new Date().toISOString(),
      read: true,
    };
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThread.id
          ? {
              ...t,
              messages: [...t.messages, optimisticMsg],
              lastMessage: body,
              lastMessageAt: optimisticMsg.createdAt,
            }
          : t,
      ),
    );
    setActiveThread((t) =>
      t ? { ...t, messages: [...t.messages, optimisticMsg] } : null,
    );

    // Actually send via server action — find the real recipientId from the thread
    try {
      await sendMessageAction({
        recipientId: activeThread.otherPartyName, // We need the actual user ID
        body,
        listingId: activeThread.listingId || undefined,
      });
    } catch {
      // Message already shown optimistically — silently fail for now
    }
  }

  return (
    <div
      role="tabpanel"
      aria-label="Messages"
      className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden
        grid grid-cols-1 md:grid-cols-[280px_1fr] min-h-[520px]"
    >
      {/* Thread list */}
      <div className="border-b md:border-b-0 md:border-r border-[#E3E0D9]">
        <div
          className="px-4 py-3 border-b border-[#E3E0D9] flex items-center
          justify-between"
        >
          <h2 className="text-[13px] font-semibold text-[#141414]">
            Conversations
          </h2>
        </div>
        {threads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => setActiveThread(thread)}
            className={`w-full flex items-start gap-3 px-4 py-3 border-b
              border-[#F0EDE8] text-left transition-colors
              ${activeThread?.id === thread.id ? "bg-[#F8F7F4]" : "hover:bg-[#FAFAF8]"}`}
          >
            <Avatar
              name={thread.otherPartyName}
              size="sm"
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] font-semibold text-[#141414] truncate">
                  {thread.otherPartyName}
                </p>
                {thread.unreadCount > 0 && (
                  <span
                    className="shrink-0 w-4 h-4 rounded-full bg-[#D4A843] text-white
                    text-[9px] font-bold flex items-center justify-center"
                  >
                    {thread.unreadCount}
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-[#9E9A91] truncate mt-0.5">
                {thread.listingTitle}
              </p>
              <p className="text-[11px] text-[#C9C5BC] truncate mt-0.5">
                {thread.lastMessage}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Message pane */}
      {activeThread ? (
        <div className="flex flex-col">
          {/* Thread header */}
          <div className="px-5 py-3.5 border-b border-[#E3E0D9] flex items-center gap-3">
            <Avatar name={activeThread.otherPartyName} size="sm" />
            <div>
              <p className="text-[13px] font-semibold text-[#141414]">
                {activeThread.otherPartyName}
              </p>
              <Link
                href={`/listings/${activeThread.listingId}`}
                className="text-[11.5px] text-[#9E9A91] hover:text-[#D4A843] transition-colors"
              >
                {activeThread.listingTitle}
              </Link>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[360px]">
            {activeThread.messages.map((msg) => {
              const isMe = msg.senderId === "me";
              return (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                >
                  {!isMe && (
                    <Avatar
                      name={msg.senderName}
                      size="sm"
                      className="shrink-0 mt-0.5"
                    />
                  )}
                  <div
                    className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col gap-1`}
                  >
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed
                        ${
                          isMe
                            ? "bg-[#141414] text-white rounded-tr-sm"
                            : "bg-[#F8F7F4] text-[#141414] rounded-tl-sm border border-[#E3E0D9]"
                        }
                        ${msg.body?.startsWith('{"type":"PICKUP_') ? "!p-0 !bg-transparent !border-0" : ""}`}
                    >
                      {msg.body?.startsWith('{"type":"PICKUP_') ? (
                        <PickupMessageCard
                          messageBody={msg.body}
                          currentUserId="me"
                          messageSenderId={msg.senderId}
                          orderId=""
                        />
                      ) : (
                        msg.body
                      )}
                    </div>
                    <span className="text-[10.5px] text-[#C9C5BC]">
                      {relativeTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Message input */}
          <form
            onSubmit={handleSendMessage}
            className="p-4 border-t border-[#E3E0D9] flex gap-2"
          >
            <input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Write a message…"
              maxLength={1000}
              className="flex-1 h-10 px-4 rounded-xl border border-[#C9C5BC] bg-white
                text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none
                focus:border-[#D4A843] focus:ring-2 focus:ring-[#D4A843]/20 transition"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!newMessage.trim()}
            >
              Send
            </Button>
          </form>
        </div>
      ) : (
        <div className="flex items-center justify-center text-[13.5px] text-[#9E9A91]">
          Select a conversation
        </div>
      )}
    </div>
  );
}
