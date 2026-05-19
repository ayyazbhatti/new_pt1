import { http } from '@/shared/api/http'

export interface AiMessageDto {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokensIn?: number | null
  tokensOut?: number | null
  blockedReason?: string | null
  createdAt: string
}

export interface AiConversationDto {
  conversationId: string
  messages: AiMessageDto[]
}

export interface AiUsageDto {
  date: string
  tokensIn: number
  tokensOut: number
  messages: number
  dailyCap: number
  tokensUsed: number
}

export interface SendAiMessageResult {
  conversationId: string
  userMessageId: string
  assistantMessageId: string
}

interface ConversationResponse {
  conversationId: string
  messages: AiMessageDto[]
}

interface UsageResponse {
  date: string
  tokensIn: number
  tokensOut: number
  messages: number
  dailyTokenCap: number
  tokensUsed: number
}

export async function getAiConversation(): Promise<AiConversationDto> {
  const data = await http<ConversationResponse>('/api/ai/chat/conversation')
  return {
    conversationId: data.conversationId,
    messages: Array.isArray(data.messages) ? data.messages : [],
  }
}

export async function sendAiMessage(payload: {
  message: string
  idempotencyKey: string
}): Promise<SendAiMessageResult> {
  return http<SendAiMessageResult>('/api/ai/chat/message', {
    method: 'POST',
    body: JSON.stringify({
      message: payload.message.trim(),
      idempotencyKey: payload.idempotencyKey,
    }),
  })
}

export async function clearAiConversation(): Promise<void> {
  await http<void>('/api/ai/chat/conversation', { method: 'DELETE' })
}

export async function getAiUsage(): Promise<AiUsageDto> {
  const data = await http<UsageResponse>('/api/ai/chat/usage')
  return {
    date: data.date,
    tokensIn: data.tokensIn,
    tokensOut: data.tokensOut,
    messages: data.messages,
    dailyCap: data.dailyTokenCap,
    tokensUsed: data.tokensUsed,
  }
}
