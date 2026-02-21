import { http } from '@/shared/api/http'

export interface ChatMessageDto {
  id: string
  senderType: 'user' | 'support'
  senderId: string | null
  body: string
  createdAt: string
}

export interface ConversationSummaryDto {
  userId: string
  userName: string
  userEmail: string
  lastMessage: string
  lastTime: string
}

export async function getAdminConversations(): Promise<ConversationSummaryDto[]> {
  const list = await http<ConversationSummaryDto[]>('/api/admin/chat/conversations')
  return Array.isArray(list) ? list : []
}

export async function getAdminConversationMessages(userId: string): Promise<ChatMessageDto[]> {
  const list = await http<ChatMessageDto[]>(`/api/admin/chat/conversations/${userId}/messages`)
  return Array.isArray(list) ? list : []
}

export async function sendAdminChatMessage(userId: string, message: string): Promise<ChatMessageDto> {
  return http<ChatMessageDto>(`/api/admin/chat/conversations/${userId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message: message.trim() }),
  })
}
