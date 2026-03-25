// src/modules/messaging/message.types.ts
// ─── Messaging Domain Types ──────────────────────────────────────────────────

export interface SendMessageInput {
  threadId?: string
  recipientId: string
  listingId?: string
  body: string
}

export interface SendMessageResult {
  messageId: string
  threadId: string
}
