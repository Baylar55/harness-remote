import { memo, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react"
import type { MessageEnvelope } from "../types"
import { ChatIcon, LoadingIcon, StopCircleIcon } from "../Icons"
import "../taskdesk-conversation.css"
import { TaskDeskMessageContent } from "./taskdesk-message-content"

const NEAR_BOTTOM_PX = 96
const COMPOSER_MAX_HEIGHT_PX = 180

type Props = {
  messages: MessageEnvelope[]
  agentLabel: string
  agentBackend?: string
  loading?: boolean
  waiting?: boolean
  ready?: boolean
  hasMore?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => Promise<void> | void
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => Promise<void> | void
  sending?: boolean
  sendDisabled?: boolean
  onStop?: () => Promise<void> | void
  stopping?: boolean
  workingLabel?: string
  placeholder?: string
  emptyText?: string
  directory?: string
  footerHint?: string
  renderMessage?: (message: MessageEnvelope) => ReactNode
}

function formatClock(timestamp: number): string {
  if (!timestamp) return ""
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp)
}

function hasTouchFirstPointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true
}

/**
 * Composer keystrokes must not re-render a long transcript. Message-page reconciliation preserves
 * unchanged message object identities, so memoized rows make typing cost independent of history size.
 */
const MessageBubble = memo(function MessageBubble({ message, agentLabel }: { message: MessageEnvelope; agentLabel: string }) {
  const isUser = message.info.role === "user"
  return (
    <article className={`uw-message ${isUser ? "uw-message-user" : "uw-message-agent"}`}>
      <div className={`uw-avatar ${isUser ? "uw-avatar-user" : "uw-avatar-agent"}`} aria-hidden="true">
        {isUser ? "You" : agentLabel.slice(0, 2).toUpperCase()}
      </div>
      <div className="uw-message-body">
        <header>
          <strong>{isUser ? "You" : agentLabel}</strong>
          <time>{formatClock(message.info.time.created)}</time>
        </header>
        <TaskDeskMessageContent message={message} />
      </div>
    </article>
  )
})

/**
 * The conversation surface is deliberately product-agnostic. A Native Session and a Work Thread
 * provide the same ordered native transcript and callbacks; this component owns how that transcript
 * is displayed, paged, scrolled and continued so those two products cannot slowly diverge.
 */
export function TaskDeskConversation({
  messages,
  agentLabel,
  loading = false,
  waiting = false,
  ready = true,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  draft,
  onDraftChange,
  onSend,
  sending = false,
  sendDisabled = false,
  onStop,
  stopping = false,
  workingLabel,
  placeholder,
  emptyText = "This conversation has no messages yet.",
  directory,
  footerHint,
  renderMessage
}: Props) {
  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const nearBottomRef = useRef(true)
  const preservingOlderRef = useRef(false)
  const touchFirst = hasTouchFirstPointer()
  const canSend = Boolean(draft.trim() && !sending && !waiting && !sendDisabled && ready)
  const hint = footerHint ?? (touchFirst ? "Ctrl/Cmd+Enter to send" : "Shift+Enter for newline")

  useEffect(() => {
    const transcript = transcriptRef.current
    if (!transcript || loading || !ready || preservingOlderRef.current) return
    if (!nearBottomRef.current && !waiting && !sending) return
    transcript.scrollTop = transcript.scrollHeight
  }, [messages, loading, ready, waiting, sending])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    composer.style.height = "auto"
    composer.style.height = `${Math.min(COMPOSER_MAX_HEIGHT_PX, Math.max(66, composer.scrollHeight))}px`
  }, [draft])

  async function loadOlder() {
    if (!onLoadOlder || !hasMore || loadingOlder) return
    const transcript = transcriptRef.current
    const previousHeight = transcript?.scrollHeight ?? 0
    const previousTop = transcript?.scrollTop ?? 0
    preservingOlderRef.current = true
    try {
      await onLoadOlder()
      window.requestAnimationFrame(() => {
        const current = transcriptRef.current
        if (current) current.scrollTop = previousTop + (current.scrollHeight - previousHeight)
        preservingOlderRef.current = false
      })
    } catch (error) {
      preservingOlderRef.current = false
      throw error
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return
    if (touchFirst) {
      if (!event.ctrlKey && !event.metaKey) return
    } else if (event.shiftKey) {
      return
    }
    event.preventDefault()
    if (canSend) void onSend()
  }

  return (
    <div className="uw-conversation-core">
      <div
        className="uw-transcript"
        ref={transcriptRef}
        onScroll={(event) => {
          const element = event.currentTarget
          nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_PX
        }}
      >
        {loading || !ready ? (
          <div className="uw-empty-panel"><LoadingIcon size={22} /><strong>Loading conversation…</strong></div>
        ) : (
          <>
            {hasMore ? (
              <div className="uw-history-loader">
                <button type="button" className="uw-button uw-button-ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
                  {loadingOlder ? <LoadingIcon size={15} /> : null}
                  {loadingOlder ? "Loading older messages…" : "Load older messages"}
                </button>
              </div>
            ) : null}
            {messages.length === 0 && !waiting ? (
              <div className="uw-empty-panel"><ChatIcon size={24} /><strong>{emptyText}</strong></div>
            ) : renderMessage
              ? messages.map((message) => renderMessage(message))
              : messages.map((message) => (
                  <MessageBubble key={message.info.id} message={message} agentLabel={agentLabel} />
                ))}
          </>
        )}
        {waiting ? (
          <div className="uw-session-typing" role="status" aria-label={`Waiting for ${agentLabel} response`}>
            <span />
            <span />
            <span />
            {workingLabel ? <b className="uw-session-typing-label">{workingLabel}</b> : null}
          </div>
        ) : null}
      </div>

      <div className="uw-composer-shell">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={waiting ? `${agentLabel} is working…` : placeholder || `Continue with ${agentLabel}…`}
          rows={3}
          disabled={!ready}
        />
        <div className="uw-composer-footer">
          <span className="uw-composer-directory">{directory || ""}</span>
          <div>
            <small>{hint}</small>
            {waiting && onStop ? (
              <button
                type="button"
                className="uw-button uw-button-danger"
                disabled={stopping}
                onClick={() => void onStop()}
              >
                {stopping ? <LoadingIcon size={15} /> : <StopCircleIcon size={15} />}
                {stopping ? "Stopping" : "Stop"}
              </button>
            ) : (
              <button
                type="button"
                className="uw-button uw-button-primary"
                disabled={!canSend}
                onClick={() => void onSend()}
              >
                {sending ? <LoadingIcon size={15} /> : "↑"}
                {sending ? "Sending" : "Send"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
