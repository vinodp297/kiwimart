"use client";
// src/app/(protected)/messages/new/NewMessageForm.tsx
// ─── New Message Compose Form ─────────────────────────────────────────────────
// Client component — calls sendMessage server action, then redirects.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/server/actions/messages";

interface Props {
  listingId: string | null;
  sellerId: string;
  listingTitle: string | null;
}

export function NewMessageForm({ listingId, sellerId, listingTitle }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState(
    listingTitle
      ? `Hi, is "${listingTitle}" still available?`
      : "Hi, I have a question for you.",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = message.trim();
    if (!body) return;

    setIsLoading(true);
    setError(null);

    try {
      // sendMessage creates the thread if one doesn't exist yet.
      // recipientId = sellerId (the other participant).
      const result = await sendMessage({
        recipientId: sellerId,
        ...(listingId ? { listingId } : {}),
        body,
      });

      if (!result.success) {
        setError(
          result.error ?? "Your message couldn't be sent. Please try again.",
        );
        setIsLoading(false);
        return;
      }

      // Redirect to buyer dashboard messages tab
      router.push("/dashboard/buyer");
    } catch {
      setError(
        "Your message couldn't be sent. Please check your connection and try again.",
      );
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label
          htmlFor="message-body"
          className="block text-[13px] font-medium text-[#141414] mb-2"
        >
          Your message
        </label>
        <textarea
          id="message-body"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={1000}
          className="w-full border border-[#E3E0D9]
            rounded-xl px-4 py-3 text-[14px]
            text-[#141414] bg-white resize-none
            focus:outline-none focus:border-[#141414]
            transition-colors"
          placeholder="Write your message..."
          disabled={isLoading}
        />
        <p className="text-[12px] text-[#C9C5BC] text-right mt-1">
          {message.length} / 1000
        </p>
      </div>

      {error && (
        <p className="text-red-600 text-[13px] mb-4" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading || !message.trim()}
        className="w-full bg-[#D4A843] hover:bg-[#B8912E]
          disabled:opacity-50 disabled:cursor-not-allowed
          text-[#141414] font-semibold
          text-[15px] py-3.5 rounded-full transition-colors"
      >
        {isLoading ? "Sending..." : "Send message"}
      </button>

      <button
        type="button"
        onClick={() => router.back()}
        disabled={isLoading}
        className="w-full mt-3 text-[#73706A]
          text-[14px] py-2 hover:text-[#141414]
          transition-colors disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}
