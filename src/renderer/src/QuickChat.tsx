import { ArrowDown, ArrowUp, ExternalLink, MessageSquarePlus, Settings, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import logo from './assets/gllm-logo.png'
import { MarkdownMessage } from './MarkdownMessage'
import { DEFAULT_ASSISTANTS, getAssistantById } from '@shared/assistants'
import { DEFAULT_PROVIDER, getProviderById } from '@shared/providers'
import type { ApiProvider, AppSettings, Assistant, AssistantMemory, ChatChunk, ChatMessage, Conversation } from '@shared/types'

const quickBottomFollowThreshold = 72

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function estimateTokenCount(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0

  const cjkCount = normalized.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const nonCjkTokens =
    normalized
      .replace(/[\u4e00-\u9fff]/g, ' ')
      .match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0

  return Math.max(1, Math.ceil(cjkCount + nonCjkTokens * 0.75))
}

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  const contentTokens = estimateTokenCount(content)
  const inputTokens = role === 'assistant' ? 0 : contentTokens
  const outputTokens = role === 'assistant' ? contentTokens : 0

  return {
    id: createId('message'),
    role,
    content,
    createdAt: Date.now(),
    tokenCount: inputTokens + outputTokens,
    inputTokens,
    outputTokens
  }
}

function createQuickConversation(assistant: Assistant, title = '快速对话'): Conversation {
  const now = Date.now()

  return {
    id: createId('conversation'),
    assistantId: assistant.id,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now
  }
}

function applyChatChunk(conversation: Conversation, chunk: ChatChunk): Conversation {
  const messages = [...conversation.messages]
  const last = messages.at(-1)
  const nextContent = chunk.error ? `发送失败：${chunk.error}` : chunk.content

  if (!nextContent && chunk.done) {
    return { ...conversation, updatedAt: Date.now() }
  }

  if (last?.role === 'assistant') {
    const content = chunk.error ? nextContent : `${last.content}${nextContent}`
    messages[messages.length - 1] = {
      ...last,
      content,
      webSearch: chunk.webSearch ?? last.webSearch,
      tokenCount: chunk.usage?.totalTokens ?? estimateTokenCount(content),
      inputTokens: chunk.usage?.inputTokens ?? last.inputTokens,
      outputTokens: chunk.usage?.outputTokens ?? estimateTokenCount(content)
    }
  } else {
    messages.push({
      ...createMessage('assistant', nextContent),
      webSearch: chunk.webSearch,
      tokenCount: chunk.usage?.totalTokens ?? estimateTokenCount(nextContent),
      inputTokens: chunk.usage?.inputTokens ?? 0,
      outputTokens: chunk.usage?.outputTokens ?? estimateTokenCount(nextContent)
    })
  }

  return {
    ...conversation,
    messages,
    updatedAt: Date.now(),
    totalTokens: messages.reduce((sum, message) => sum + (message.tokenCount ?? 0), 0)
  }
}

function getLatestAssistantConversation(conversations: Conversation[], assistantId: string): Conversation | null {
  return (
    conversations
      .filter((conversation) => conversation.assistantId === assistantId)
      .sort((first, second) => second.updatedAt - first.updatedAt)[0] ?? null
  )
}

export default function QuickChat() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ApiProvider[]>([DEFAULT_PROVIDER])
  const [assistants, setAssistants] = useState<Assistant[]>(DEFAULT_ASSISTANTS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [activeAssistantId, setActiveAssistantId] = useState(DEFAULT_ASSISTANTS[0].id)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [draft, setDraft] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState('')
  const [autoFollowMessages, setAutoFollowMessages] = useState(true)
  const [isNearMessageBottom, setIsNearMessageBottom] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const conversationRef = useRef<Conversation | null>(null)

  const assistant = useMemo(() => getAssistantById(activeAssistantId, assistants), [activeAssistantId, assistants])
  const assistantMemories = useMemo(
    () => memories.filter((memory) => memory.assistantId === assistant.id && memory.enabled),
    [assistant.id, memories]
  )
  const provider = useMemo(
    () => (settings ? getProviderById(settings.activeProviderId, providers) : providers[0] ?? DEFAULT_PROVIDER),
    [providers, settings]
  )
  const needsApiKey = Boolean(settings && provider.requiresApiKey && !provider.apiKey.trim())
  const messages = conversation?.messages ?? []

  useEffect(() => {
    void Promise.all([window.gllm.getState(), window.gllm.getActiveAssistantId()]).then(([state, activeId]) => {
      const loadedProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
      const loadedAssistants = state.assistants.length > 0 ? state.assistants : DEFAULT_ASSISTANTS
      const quickAssistant = getAssistantById(activeId, loadedAssistants)

      setSettings(state.settings)
      setProviders(loadedProviders)
      setAssistants(loadedAssistants)
      setConversations(state.conversations)
      setMemories(state.memories ?? [])
      setActiveAssistantId(quickAssistant.id)
      setConversation(getLatestAssistantConversation(state.conversations, quickAssistant.id))
    })
  }, [])

  useEffect(() => {
    return window.gllm.onActiveAssistantChanged((id) => {
      setActiveAssistantId(id)
      setDraft('')
      setStatus('')
    })
  }, [])

  useEffect(() => {
    if (isStreaming) return
    setConversation(getLatestAssistantConversation(conversations, assistant.id))
  }, [assistant.id, conversations, isStreaming])

  useEffect(() => {
    return window.gllm.onConversationChanged((change) => {
      setConversations(change.conversations)
      setConversation((current) => {
        if (change.action === 'deleted' && current?.id === change.conversationId) {
          return getLatestAssistantConversation(change.conversations, assistant.id)
        }

        const updated = change.conversations.find((item) => item.id === (current?.id ?? change.conversationId))
        if (updated) return updated

        if (!current || current.id === change.conversationId) {
          return getLatestAssistantConversation(change.conversations, assistant.id)
        }

        return current
      })
    })
  }, [assistant.id])

  useEffect(() => {
    conversationRef.current = conversation
  }, [conversation])

  useEffect(() => {
    setAutoFollowMessages(true)
    setIsNearMessageBottom(true)
    window.requestAnimationFrame(() => scrollToLatest('auto'))
  }, [conversation?.id])

  useEffect(() => {
    const unsubscribe = window.gllm.onChatChunk((chunk) => {
      const current = conversationRef.current
      if (!current || current.id !== chunk.conversationId) return

      setConversation((active) => {
        if (!active || active.id !== chunk.conversationId) return active
        const next = applyChatChunk(active, chunk)
        conversationRef.current = next
        setConversations((current) => [next, ...current.filter((item) => item.id !== next.id)])
        void window.gllm.saveConversation(next)
        return next
      })

      if (chunk.done) {
        setIsStreaming(false)
        if (chunk.error) setStatus(chunk.error)
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!autoFollowMessages) return
    const container = messagesRef.current
    if (!container) return
    window.requestAnimationFrame(() => scrollToLatest(isStreaming ? 'auto' : 'smooth'))
  }, [autoFollowMessages, isStreaming, messages.length, messages.at(-1)?.content])

  function getDistanceToMessageBottom() {
    const container = messagesRef.current
    if (!container) return 0
    return container.scrollHeight - container.scrollTop - container.clientHeight
  }

  function updateMessageScrollState() {
    const isNearBottom = getDistanceToMessageBottom() <= quickBottomFollowThreshold
    setIsNearMessageBottom(isNearBottom)
    setAutoFollowMessages(isNearBottom)
  }

  function scrollToLatest(behavior: ScrollBehavior = 'smooth') {
    const container = messagesRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
    setIsNearMessageBottom(true)
    setAutoFollowMessages(true)
  }

  async function openMainWindow() {
    await window.gllm.showMainWindow()
    await window.gllm.hideQuickPanel()
  }

  function startNewQuickChat() {
    setConversation(null)
    setDraft('')
    setStatus('')
  }

  function sendMessage(content = draft) {
    if (!settings || isStreaming) return

    if (needsApiKey) {
      setStatus(`请先在主窗口配置 ${provider.name} API Key`)
      void openMainWindow()
      return
    }

    const text = content.trim()
    if (!text) return

    const baseConversation = conversation ?? createQuickConversation(assistant, `快速对话：${text.slice(0, 18)}`)
    const userMessage = createMessage('user', text)
    const nextConversation: Conversation = {
      ...baseConversation,
      title: baseConversation.messages.length === 0 ? `快速对话：${text.slice(0, 18)}` : baseConversation.title,
      messages: [...baseConversation.messages, userMessage],
      updatedAt: Date.now()
    }

    setDraft('')
    setStatus('')
    setIsStreaming(true)
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant,
      assistantMemories,
      provider,
      messages: nextConversation.messages,
      settings
    })
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    sendMessage()
  }

  return (
    <div className="quick-shell">
      <header className="quick-titlebar">
        <div className="quick-brand">
          <img src={logo} alt="G-LLM" />
          <div>
            <strong>{assistant.name}</strong>
            <span>{assistant.title} · {provider.name} · {provider.defaultModel}</span>
          </div>
        </div>
        <div className="quick-actions">
          <button title="新建快速对话" type="button" onClick={startNewQuickChat}>
            <MessageSquarePlus size={17} />
          </button>
          <button title="打开完整窗口" type="button" onClick={() => void openMainWindow()}>
            <ExternalLink size={17} />
          </button>
          <button title="设置" type="button" onClick={() => void openMainWindow()}>
            <Settings size={17} />
          </button>
          <button title="关闭" type="button" onClick={() => void window.gllm.hideQuickPanel()}>
            <X size={18} />
          </button>
        </div>
      </header>

      <main className="quick-content" ref={messagesRef} onScroll={updateMessageScrollState}>
        {messages.length === 0 ? (
          <section className="quick-empty">
            <p><span>你好</span></p>
            <h1>{assistant.name}可以帮你做什么？</h1>
            <div className="quick-starters">
              {assistant.starterPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => sendMessage(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`quick-message ${message.role}`}>
              <div className="quick-message-bubble">
                <MarkdownMessage content={message.content || (message.role === 'assistant' ? '正在思考...' : '')} />
              </div>
            </article>
          ))
        )}
        {isStreaming && messages.at(-1)?.role === 'user' && (
          <article className="quick-message assistant">
            <div className="quick-message-bubble quick-thinking">
              <span />
              <span />
              <span />
            </div>
          </article>
        )}
      </main>

      {messages.length > 0 && !isNearMessageBottom && (
        <button className="quick-scroll-latest-button" type="button" onClick={() => scrollToLatest('smooth')}>
          <ArrowDown size={15} />
          <span>{isStreaming ? 'AI 正在回复' : '回到底部'}</span>
        </button>
      )}

      {status && (
        <div className="quick-status">
          <span>{status}</span>
          <button type="button" onClick={() => setStatus('')}>
            <X size={14} />
          </button>
        </div>
      )}

      <form
        className="quick-composer"
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage()
        }}
      >
        <textarea
          value={draft}
          disabled={!settings}
          rows={1}
          placeholder={needsApiKey ? '请先配置 API Key' : '输入消息'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
        />
        <button disabled={!draft.trim() || isStreaming || !settings} title="发送" type="submit">
          <ArrowUp size={18} />
        </button>
      </form>
    </div>
  )
}
