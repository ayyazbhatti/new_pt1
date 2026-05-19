import { useEffect, useState } from 'react'
import { X, MessageCircle, ArrowLeft, Trash2, Sparkles, Loader2 } from 'lucide-react'
import { useMediaQuery } from '@/shared/hooks'
import { useTerminalStore } from '../store'
import { cn } from '@/shared/utils'
import { wsClient } from '@/shared/ws/wsClient'
import { SupportChatTab } from './SupportChatTab'
import { AiChatTab, useAiChatClear } from './AiChatTab'

const PANEL_WIDTH_DESKTOP = 288

const useWsState = () => {
  const [state, setState] = useState(wsClient.getState())
  useEffect(() => {
    return wsClient.onStateChange(setState)
  }, [])
  return state
}

export function ChatPanel() {
  const { chatPanelOpen, setChatPanelOpen, chatPanelTab: tab, setChatPanelTab: setTab } =
    useTerminalStore()
  const isMobile = !useMediaQuery('(min-width: 1024px)')
  const wsState = useWsState()
  const { clear: clearAiChat, clearing: clearingAi } = useAiChatClear()

  if (!chatPanelOpen) return null

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col',
        isMobile ? 'w-full bg-background' : 'shrink-0 bg-background/95 backdrop-blur-sm border-l border-white/10 shadow-[-4px_0_24px_rgba(0,0,0,0.25)]',
        'animate-fade-in'
      )}
      style={isMobile ? undefined : { width: PANEL_WIDTH_DESKTOP }}
      role="dialog"
      aria-label={isMobile ? 'Chat page' : 'Chat panel'}
    >
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/10 bg-gradient-to-r from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2.5 min-w-0">
          {isMobile ? (
            <button
              type="button"
              onClick={() => setChatPanelOpen(false)}
              className="shrink-0 p-2 -ml-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : null}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            {tab === 'ai' ? <Sparkles className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
          </div>
          <h2 className="text-sm font-semibold text-text truncate">Chat</h2>
          <span
            className={cn(
              'shrink-0 text-[10px] px-1.5 py-0.5 rounded',
              wsState === 'authenticated'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/20 text-amber-400'
            )}
            title={wsState === 'authenticated' ? 'Realtime connected' : `Realtime: ${wsState}`}
          >
            {wsState === 'authenticated' ? 'Live' : wsState === 'connecting' || wsState === 'connected' ? '…' : 'Off'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {tab === 'ai' && (
            <button
              type="button"
              onClick={() => void clearAiChat()}
              disabled={clearingAi}
              className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 disabled:opacity-40 transition-colors"
              title="Clear conversation"
              aria-label="Clear AI conversation"
            >
              {clearingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
          {!isMobile && (
            <button
              type="button"
              onClick={() => setChatPanelOpen(false)}
              className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              title="Close panel"
              aria-label="Close chat panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 py-2 border-b border-white/10 flex gap-1">
        <button
          type="button"
          onClick={() => setTab('support')}
          className={cn(
            'flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors',
            tab === 'support'
              ? 'bg-accent/20 text-accent'
              : 'text-text-muted hover:text-text'
          )}
        >
          Support
        </button>
        <button
          type="button"
          onClick={() => setTab('ai')}
          className={cn(
            'flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors',
            tab === 'ai'
              ? 'bg-accent/20 text-accent'
              : 'text-text-muted hover:text-text'
          )}
        >
          AI Assistant
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'support' ? (
          <SupportChatTab active={tab === 'support'} />
        ) : (
          <AiChatTab active={tab === 'ai'} />
        )}
      </div>
    </div>
  )
}
