import { ArrowDown, ArrowUp, AtSign, Copy, ExternalLink, MessageSquarePlus, Settings, X } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import logo from './assets/gllm-logo.png'
import {
  getMessageSelectionSnapshot,
  writePlainTextToClipboard,
  writeRichTextToClipboard,
  type MessageSelectionSnapshot
} from './clipboard'
import {
  persistComposerDraft,
  QUICK_COMPOSER_DRAFT_KEY,
  readComposerDraft,
  resizeComposerTextarea
} from './composerInput'
import { getMessageSendShortcutLabel, shouldSendMessageFromKeyboard } from './keyboard'
import { MarkdownMessage } from './MarkdownMessage'
import { DEFAULT_ASSISTANTS, getAssistantById } from '@shared/assistants'
import { DEFAULT_PROVIDER, getProviderById } from '@shared/providers'
import type { ApiProvider, AppSettings, Assistant, AssistantMemory, ChatChunk, ChatMessage, Conversation, KnowledgeReference } from '@shared/types'

const quickBottomFollowThreshold = 72
const quoteReferencePrefix = 'quote_'

interface SelectionContextMenu {
  x: number
  y: number
  text: string
  html: string
  source: 'selection' | 'message'
}

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

function getKnowledgeReferenceText(knowledgeRefs: KnowledgeReference[] = []): string {
  return knowledgeRefs.map((reference) => `${reference.title}\n${reference.content}`).join('\n\n')
}

function getQuoteReferenceTitle(content: string): string {
  const firstLine =
    content
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '引用内容'
  const collapsed = firstLine.replace(/\s+/g, ' ')
  return `引用内容：${collapsed.length > 22 ? `${collapsed.slice(0, 22)}...` : collapsed}`
}

function createMessage(role: ChatMessage['role'], content: string, knowledgeRefs: KnowledgeReference[] = []): ChatMessage {
  const contentTokens = estimateTokenCount(content)
  const knowledgeTokens = role === 'assistant' ? 0 : estimateTokenCount(getKnowledgeReferenceText(knowledgeRefs))
  const inputTokens = role === 'assistant' ? 0 : contentTokens + knowledgeTokens
  const outputTokens = role === 'assistant' ? contentTokens : 0

  return {
    id: createId('message'),
    role,
    content,
    knowledgeRefs: knowledgeRefs.length > 0 ? knowledgeRefs : undefined,
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
  const [draft, setDraft] = useState(() => readComposerDraft(QUICK_COMPOSER_DRAFT_KEY))
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState('')
  const [selectionMenu, setSelectionMenu] = useState<SelectionContextMenu | null>(null)
  const [pendingQuoteRefs, setPendingQuoteRefs] = useState<KnowledgeReference[]>([])
  const [autoFollowMessages, setAutoFollowMessages] = useState(true)
  const [isNearMessageBottom, setIsNearMessageBottom] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  const autoFollowMessagesRef = useRef(true)
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
  const messageSendShortcut = settings?.messageSendShortcut ?? 'enter'
  const messageSendShortcutLabel = getMessageSendShortcutLabel(messageSendShortcut)
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
      setPendingQuoteRefs([])
      setStatus('')
    })
  }, [])

  useEffect(() => {
    persistComposerDraft(QUICK_COMPOSER_DRAFT_KEY, draft)
  }, [draft])

  useEffect(() => {
    resizeComposerTextarea(draftTextareaRef.current)
  }, [draft])

  useEffect(() => {
    if (!selectionMenu) return

    const closeMenu = () => setSelectionMenu(null)
    const closeMenuOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [selectionMenu])

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
    setMessageAutoFollow(true)
    setIsNearMessageBottom(true)
    window.requestAnimationFrame(() => scrollToLatest('auto', { resumeAutoFollow: true }))
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
    window.requestAnimationFrame(() => scrollToLatest(isStreaming ? 'auto' : 'smooth', { requireAutoFollow: true, resumeAutoFollow: false }))
  }, [autoFollowMessages, isStreaming, messages.length, messages.at(-1)?.content])

  function getDistanceToMessageBottom() {
    const container = messagesRef.current
    if (!container) return 0
    return container.scrollHeight - container.scrollTop - container.clientHeight
  }

  function setMessageAutoFollow(enabled: boolean) {
    autoFollowMessagesRef.current = enabled
    setAutoFollowMessages(enabled)
  }

  function pauseMessageAutoFollow() {
    setSelectionMenu(null)
    setIsNearMessageBottom(false)
    setMessageAutoFollow(false)
  }

  function handleMessageWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const container = messagesRef.current
    if (event.deltaY < 0 && container && container.scrollTop > 0) pauseMessageAutoFollow()
  }

  function updateMessageScrollState() {
    setSelectionMenu(null)
    const distanceToBottom = getDistanceToMessageBottom()
    const isAtBottom = distanceToBottom <= 4
    const isNearBottom = distanceToBottom <= quickBottomFollowThreshold

    if (!autoFollowMessagesRef.current) {
      setIsNearMessageBottom(isAtBottom)
      if (isAtBottom) setMessageAutoFollow(true)
      return
    }

    setIsNearMessageBottom(isNearBottom)
    setMessageAutoFollow(isNearBottom)
  }

  function scrollToLatest(
    behavior: ScrollBehavior = 'smooth',
    options: { requireAutoFollow?: boolean; resumeAutoFollow?: boolean } = {}
  ) {
    if (options.requireAutoFollow && !autoFollowMessagesRef.current) return

    const container = messagesRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
    if (options.resumeAutoFollow ?? true) {
      setIsNearMessageBottom(true)
      setMessageAutoFollow(true)
    }
  }

  async function openMainWindow() {
    await window.gllm.showMainWindow()
    await window.gllm.hideQuickPanel()
  }

  function startNewQuickChat() {
    setConversation(null)
    setDraft('')
    setPendingQuoteRefs([])
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
    if (!text && pendingQuoteRefs.length === 0) return
    const messageText = text || '请结合我引用的对话内容回答。'

    const baseConversation = conversation ?? createQuickConversation(assistant, `快速对话：${messageText.slice(0, 18)}`)
    const userMessage = createMessage('user', messageText, pendingQuoteRefs)
    const nextConversation: Conversation = {
      ...baseConversation,
      title: baseConversation.messages.length === 0 ? `快速对话：${messageText.slice(0, 18)}` : baseConversation.title,
      messages: [...baseConversation.messages, userMessage],
      updatedAt: Date.now()
    }

    setDraft('')
    setPendingQuoteRefs([])
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
    if (!shouldSendMessageFromKeyboard(event, messageSendShortcut)) return
    event.preventDefault()
    sendMessage()
  }

  function getMessageSelectionForMessage(messageId: string): MessageSelectionSnapshot | null {
    return getMessageSelectionSnapshot(document.querySelector(`[data-message-id="${messageId}"]`))
  }

  function openSelectionContextMenu(event: ReactMouseEvent, message: ChatMessage) {
    if (message.role !== 'assistant') {
      setSelectionMenu(null)
      return
    }

    const selection = getMessageSelectionForMessage(message.id)
    const text = selection?.text || message.content.trim()
    if (!text) {
      setSelectionMenu(null)
      return
    }

    event.preventDefault()
    setSelectionMenu({
      x: Math.min(event.clientX, window.innerWidth - 164),
      y: Math.min(event.clientY, window.innerHeight - 96),
      text,
      html: selection?.html ?? '',
      source: selection ? 'selection' : 'message'
    })
  }

  async function copySelectionMenuText() {
    if (!selectionMenu) return

    try {
      if (selectionMenu.source === 'selection') {
        await writeRichTextToClipboard(selectionMenu)
      } else {
        await writePlainTextToClipboard(selectionMenu.text)
      }
      setStatus(selectionMenu.source === 'selection' ? '已复制选中富文本' : '已复制回复 Markdown')
    } catch {
      setStatus('复制失败，请手动选择文本复制')
    } finally {
      setSelectionMenu(null)
    }
  }

  function addQuoteReference(content: string) {
    const trimmed = content.trim()
    if (!trimmed) return

    setPendingQuoteRefs((current) => [
      ...current,
      {
        id: `${quoteReferencePrefix}${createId('quick_quote')}`,
        title: getQuoteReferenceTitle(trimmed),
        content: trimmed
      }
    ].slice(-4))
    window.requestAnimationFrame(() => draftTextareaRef.current?.focus())
  }

  function removePendingQuoteRef(id: string) {
    setPendingQuoteRefs((current) => current.filter((reference) => reference.id !== id))
  }

  function quoteSelectionMenuText() {
    if (!selectionMenu) return

    addQuoteReference(selectionMenu.text)
    setStatus(selectionMenu.source === 'selection' ? '已添加选中引用，发送时会作为上下文' : '已添加回复引用，发送时会作为上下文')
    setSelectionMenu(null)
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

      <main className="quick-content" ref={messagesRef} onScroll={updateMessageScrollState} onWheel={handleMessageWheel}>
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
            <article
              key={message.id}
              className={`quick-message ${message.role}`}
              data-message-id={message.id}
              onContextMenu={(event) => openSelectionContextMenu(event, message)}
            >
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

      {selectionMenu && (
        <div
          className="selection-context-menu"
          style={{ left: selectionMenu.x, top: selectionMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => void copySelectionMenuText()}>
            <Copy size={15} />
            复制
          </button>
          <button type="button" onClick={quoteSelectionMenuText}>
            <AtSign size={15} />
            引用
          </button>
        </div>
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
        {pendingQuoteRefs.length > 0 && (
          <div className="quick-composer-quote-cards composer-quote-cards">
            {pendingQuoteRefs.map((reference) => (
              <div key={reference.id} className="composer-quote-card">
                <div className="composer-quote-card-header">
                  <span className="composer-quote-card-title">
                    <AtSign size={14} />
                    <span>{reference.title}</span>
                  </span>
                  <button onClick={() => removePendingQuoteRef(reference.id)} title="移除引用" type="button">
                    <X size={13} />
                  </button>
                </div>
                <p>{reference.content}</p>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={draftTextareaRef}
          value={draft}
          disabled={!settings}
          rows={1}
          placeholder={needsApiKey ? '请先配置 API Key' : '输入消息'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
        />
        <button disabled={(!draft.trim() && pendingQuoteRefs.length === 0) || isStreaming || !settings} title={`发送（${messageSendShortcutLabel}）`} type="submit">
          <ArrowUp size={18} />
        </button>
      </form>
    </div>
  )
}
