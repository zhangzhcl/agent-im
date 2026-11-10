/**
 * Standard protocol types and envelope creators for Omni IM Gateway.
 */

export function createInboundMessageEvent({
  channel,
  conversationId,
  chatType = 'direct',
  senderId,
  senderName,
  text = '',
  messageId = '',
  attachments = [],
  raw = null,
}) {
  return {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    channel,
    conversationId,
    chatType,
    sender: {
      userId: senderId,
      userName: senderName ?? senderId,
    },
    message: {
      messageId: messageId || `msg_${Date.now()}`,
      type: attachments.length > 0 ? (text ? 'mixed' : 'file') : 'text',
      text,
      attachments,
    },
    timestamp: Date.now(),
    raw,
  };
}

export function createOutboundDeliveryPayload({
  conversationId,
  text,
  format = 'plain',
  files = [],
  replyToMessageId = null,
}) {
  return {
    conversationId,
    text: String(text ?? ''),
    format: format === 'markdown' ? 'markdown' : 'plain',
    files: Array.isArray(files) ? files : [],
    replyToMessageId,
  };
}
