import { http } from '@/shared/api/http'

export interface ChatMessageDto {
  id: string
  senderType: 'user' | 'support'
  senderId: string | null
  body: string
  createdAt: string
}

export async function getMyChat(): Promise<ChatMessageDto[]> {
  const list = await http<ChatMessageDto[]>('/v1/users/me/chat')
  return Array.isArray(list) ? list : []
}

export async function sendChatMessage(message: string): Promise<ChatMessageDto> {
  return http<ChatMessageDto>('/v1/users/me/chat', {
    method: 'POST',
    body: JSON.stringify({ message: message.trim() }),
  })
}
