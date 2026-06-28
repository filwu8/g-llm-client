import {
  BarChart3,
  Brain,
  BookOpen,
  Briefcase,
  CircleCheck,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Globe2,
  GraduationCap,
  ImagePlus,
  KeyRound,
  Languages,
  MessageSquarePlus,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Plug,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  AtSign,
  Trash2,
  Upload,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import logo from './assets/gllm-logo.png'
import { MarkdownMessage } from './MarkdownMessage'
import {
  ASSISTANT_PRESET_CATEGORIES,
  findAssistantPreset,
  searchAssistantPresets,
  type AssistantPreset
} from '@shared/assistantPresets'
import { DEFAULT_ASSISTANTS, getAssistantById } from '@shared/assistants'
import {
  DEFAULT_PROVIDER,
  DEFAULT_PROVIDER_ID,
  PROVIDER_TEMPLATES,
  createProviderFromTemplate,
  getProviderById
} from '@shared/providers'
import {
  getAttachmentSupportLabel,
  getModelCapabilities,
  inferModelCapabilities,
  inferModelType,
  MODEL_CAPABILITY_LABELS,
  normalizeModelCapabilities
} from '@shared/modelCapabilities'
import type {
  ApiProvider,
  AppSettings,
  Assistant,
  AssistantIcon,
  AssistantMemory,
  AttachmentKind,
  AssistantSuggestion,
  ChatChunk,
  ChatMessage,
  ClipboardAttachmentInput,
  Conversation,
  DataLocationInfo,
  KnowledgeReference,
  KnowledgeNote,
  PreparedAttachment,
  ProviderCheckResult,
  ProviderModel,
  ProviderTemplateCategory,
  ProviderTemplateId,
  ToolConfig,
  ToolConfigType,
  WebSearchActivity
} from '@shared/types'

const iconMap: Record<AssistantIcon, LucideIcon> = {
  sparkles: Sparkles,
  file: FileText,
  scale: Scale,
  code: Code2,
  chart: BarChart3,
  graduation: GraduationCap,
  brain: Brain,
  briefcase: Briefcase,
  pen: Pencil
}

const bottomFollowThreshold = 96
const maxPastedAttachmentBytes = 12 * 1024 * 1024
const quoteReferencePrefix = 'quote_'
const providerTemplateCategoryOrder: ProviderTemplateCategory[] = ['default', 'global', 'china', 'aggregator', 'local']
const providerTemplateCategoryLabels: Record<ProviderTemplateCategory, string> = {
  default: '默认与自定义',
  global: '国际厂商',
  china: '国内厂商',
  aggregator: '聚合平台',
  local: '本地模型'
}

interface TokenUsage {
  total: number
  input: number
  output: number
}

interface ApiTokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface SelectionContextMenu {
  x: number
  y: number
  text: string
}

type SettingsTab = 'providers' | 'storage' | 'about'

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'providers', label: '模型供应商设置' },
  { id: 'storage', label: '数据存储设置' },
  { id: 'about', label: '关于本系统' }
]

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

function sanitizeLocalToken(value: unknown): number | null {
  const token = Number(value)
  return Number.isFinite(token) && token >= 0 ? Math.round(token) : null
}

function formatTokenUnit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 10_000 ? 0 : 1))}K`
  return `${value}`
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${Number((size / 1024 / 1024).toFixed(1))} MB`
  if (size >= 1024) return `${Number((size / 1024).toFixed(1))} KB`
  return `${size} B`
}

function getFileExtensionFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mimeType.startsWith('text/')) return 'txt'
  return 'bin'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取剪贴板文件失败'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

function cropImageToSquareDataUrl(source: string, zoom = 1): Promise<string> {
  const size = 256
  const normalizedZoom = Math.min(2.5, Math.max(1, zoom))

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('头像图片读取失败'))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('当前环境无法裁剪头像'))
        return
      }

      const coverScale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * normalizedZoom
      const width = image.naturalWidth * coverScale
      const height = image.naturalHeight * coverScale
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.clearRect(0, 0, size, size)
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
      resolve(canvas.toDataURL('image/png'))
    }
    image.src = source
  })
}

function getClipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? [])
  if (files.length > 0) return files

  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

function estimateMessageTokenUsage(message: ChatMessage): TokenUsage {
  const contentTokens = estimateTokenCount(message.content)
  const translationTokens = estimateTokenCount(message.translation ?? '')
  const knowledgeTokens = message.role === 'assistant' ? 0 : estimateTokenCount(getKnowledgeReferenceText(message.knowledgeRefs ?? []))
  const fallbackInput = message.role === 'assistant' ? 0 : contentTokens + knowledgeTokens
  const fallbackOutput = message.role === 'assistant' ? contentTokens + translationTokens : translationTokens
  const input = sanitizeLocalToken(message.inputTokens) ?? fallbackInput
  const output = sanitizeLocalToken(message.outputTokens) ?? fallbackOutput
  const total = sanitizeLocalToken(message.tokenCount) ?? input + output

  return { total, input, output }
}

function getConversationTokenUsage(conversation: Conversation | null): TokenUsage {
  if (!conversation) return { total: 0, input: 0, output: 0 }

  return conversation.messages.reduce<TokenUsage>(
    (sum, message) => {
      const usage = estimateMessageTokenUsage(message)
      return {
        total: sum.total + usage.total,
        input: sum.input + usage.input,
        output: sum.output + usage.output
      }
    },
    { total: 0, input: 0, output: 0 }
  )
}

function withTokenCount(message: ChatMessage): ChatMessage {
  const contentTokens = estimateTokenCount(message.content)
  const translationTokens = estimateTokenCount(message.translation ?? '')
  const inputTokens = message.role === 'assistant' ? 0 : contentTokens
  const outputTokens = message.role === 'assistant' ? contentTokens + translationTokens : translationTokens

  return {
    ...message,
    tokenCount: inputTokens + outputTokens,
    inputTokens,
    outputTokens
  }
}

function withApiTokenUsage(message: ChatMessage, usage: ApiTokenUsage): ChatMessage {
  return {
    ...message,
    tokenCount: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens
  }
}

function withWebSearchActivity(message: ChatMessage, webSearch: WebSearchActivity): ChatMessage {
  return {
    ...message,
    webSearch
  }
}

function withConversationTokens(conversation: Conversation): Conversation {
  const messages = conversation.messages.map((message) => {
    const usage = estimateMessageTokenUsage(message)
    return {
      ...message,
      tokenCount: usage.total,
      inputTokens: usage.input,
      outputTokens: usage.output
    }
  })
  const usage = getConversationTokenUsage({ ...conversation, messages })

  return {
    ...conversation,
    messages,
    totalTokens: usage.total,
    totalInputTokens: usage.input,
    totalOutputTokens: usage.output
  }
}

function createConversation(assistant: Assistant, provider: ApiProvider): Conversation {
  const now = Date.now()
  return {
    id: createId('conv'),
    assistantId: assistant.id,
    title: assistant.name,
    messages: [],
    modelProviderId: provider.id,
    modelId: provider.defaultModel,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: now,
    updatedAt: now
  }
}

function getKnowledgeReferenceText(knowledgeRefs: KnowledgeReference[] = []): string {
  return knowledgeRefs.map((reference) => `${reference.title}\n${reference.content}`).join('\n\n')
}

function isQuoteReference(reference: KnowledgeReference): boolean {
  return reference.id.startsWith(quoteReferencePrefix)
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

function createMessage(
  role: ChatMessage['role'],
  content: string,
  attachments: PreparedAttachment[] = [],
  knowledgeRefs: KnowledgeReference[] = []
): ChatMessage {
  const knowledgeTokens = role === 'assistant' ? 0 : estimateTokenCount(getKnowledgeReferenceText(knowledgeRefs))
  const inputTokens = role === 'assistant' ? 0 : estimateTokenCount(content) + knowledgeTokens
  const outputTokens = role === 'assistant' ? estimateTokenCount(content) : 0

  return {
    id: createId('msg'),
    role,
    content,
    attachments: attachments.length > 0 ? attachments : undefined,
    knowledgeRefs: knowledgeRefs.length > 0 ? knowledgeRefs : undefined,
    tokenCount: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    createdAt: Date.now()
  }
}

function applyChatChunkToConversation(conversation: Conversation, chunk: ChatChunk): Conversation {
  let messages = [...conversation.messages]
  const last = messages[messages.length - 1]

  if (chunk.targetMessageId && chunk.purpose === 'translation') {
    messages = messages.map((message) => {
      if (message.id !== chunk.targetMessageId) return message
      if (chunk.error) return withTokenCount({ ...message, translation: `翻译失败：${chunk.error}` })
      if (chunk.usage) return withApiTokenUsage(message, chunk.usage)
      if (!chunk.content) return message
      return withTokenCount({ ...message, translation: `${message.translation ?? ''}${chunk.content}` })
    })
  } else if (chunk.error) {
    messages.push(createMessage('assistant', `请求失败：${chunk.error}`))
  } else if (chunk.webSearch) {
    if (last?.role === 'assistant') {
      messages[messages.length - 1] = withWebSearchActivity(last, chunk.webSearch)
    } else {
      messages.push(withWebSearchActivity(createMessage('assistant', ''), chunk.webSearch))
    }
  } else if (chunk.usage && last?.role === 'assistant') {
    messages[messages.length - 1] = withApiTokenUsage(last, chunk.usage)
  } else if (last?.role === 'assistant') {
    messages[messages.length - 1] = withTokenCount({ ...last, content: last.content + chunk.content })
  } else if (chunk.content) {
    messages.push(createMessage('assistant', chunk.content))
  }

  return withConversationTokens({ ...conversation, messages, updatedAt: Date.now() })
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function WebSearchActivityCard({ activity }: { activity: WebSearchActivity }) {
  const isPlanning = activity.status === 'planning'
  const isSearching = activity.status === 'searching'
  const isFailed = activity.status === 'failed'
  const title = isPlanning
    ? '正在理解搜索意图'
    : isSearching
      ? '正在搜索网页'
      : isFailed
        ? '联网搜索失败'
        : `已搜索网页 · 查看 ${activity.results.length} 个来源`

  return (
    <div className={`web-search-card ${activity.status}`}>
      <div className="web-search-head">
        <span className="web-search-icon">
          {isPlanning || isSearching ? (
            <span className="mini-spinner" aria-hidden="true" />
          ) : (
            <Globe2 size={15} />
          )}
        </span>
        <div>
          <strong>{title}</strong>
          <small>{activity.intent || activity.query}</small>
        </div>
      </div>
      {activity.queries && activity.queries.length > 0 && (
        <div className="web-search-query-list">
          {activity.queries.map((query) => (
            <span key={query}>{query}</span>
          ))}
        </div>
      )}
      {isFailed && activity.error && <p className="web-search-error">{activity.error}</p>}
      {activity.results.length > 0 && (
        <div className="web-search-results">
          {activity.results.map((result, index) => (
            <a key={`${result.url}-${index}`} href={result.url} target="_blank" rel="noreferrer" title={result.url}>
              <span>{index + 1}</span>
              <strong>{result.title}</strong>
              <small>{getUrlHost(result.url)}</small>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function AssistantAvatar({ assistant, className = '' }: { assistant: Assistant; className?: string }) {
  const Icon = iconMap[assistant.icon] ?? Sparkles
  const classes = ['assistant-icon', assistant.color, assistant.avatarDataUrl ? 'custom-avatar' : '', className].filter(Boolean).join(' ')

  return (
    <span className={classes}>
      {assistant.avatarDataUrl ? <img src={assistant.avatarDataUrl} alt="" /> : <Icon size={18} />}
    </span>
  )
}

function getModelOptions(provider: ApiProvider, selectedModel = provider.defaultModel): ProviderModel[] {
  const models = provider.models.some((model) => model.id === selectedModel)
    ? provider.models
    : [
        {
          id: selectedModel,
          name: selectedModel,
          capabilities: inferModelCapabilities(selectedModel),
          type: inferModelType(selectedModel)
        },
        ...provider.models
      ]

  return models
    .filter((model) => model.id)
    .map((model) => ({
      ...model,
      capabilities: normalizeModelCapabilities(model),
      type: model.type ?? inferModelType(model.id)
    }))
}

function getModelDisplayLabel(model: ProviderModel): string {
  const name = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id
  const capabilities = normalizeModelCapabilities(model)
    .map((capability) => MODEL_CAPABILITY_LABELS[capability])
    .join(' / ')
  return `${name} · ${capabilities}`
}

function getComparableSettings(settings: AppSettings) {
  return {
    activeProviderId: settings.activeProviderId,
    temperature: Number(settings.temperature),
    enableTemperature: settings.enableTemperature,
    maxTokens: Number(settings.maxTokens),
    enableMaxTokens: settings.enableMaxTokens,
    telemetryEnabled: settings.telemetryEnabled,
    setupCompleted: settings.setupCompleted
  }
}

function getComparableProvider(provider: ApiProvider) {
  return {
    id: provider.id,
    templateId: provider.templateId,
    name: provider.name,
    apiBaseUrl: provider.apiBaseUrl,
    chatCompletionsPath: provider.chatCompletionsPath ?? '',
    modelsPath: provider.modelsPath ?? '',
    apiKey: provider.apiKey,
    defaultModel: provider.defaultModel,
    requiresApiKey: provider.requiresApiKey,
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name ?? '',
      ownedBy: model.ownedBy ?? '',
      type: model.type ?? inferModelType(model.id),
      capabilities: normalizeModelCapabilities(model)
    }))
  }
}

function getEffectiveProvider(
  selection: Pick<Assistant | Conversation, 'modelProviderId' | 'modelId'>,
  fallbackProvider: ApiProvider,
  providers: ApiProvider[]
): ApiProvider {
  const provider = selection.modelProviderId ? getProviderById(selection.modelProviderId, providers) : fallbackProvider
  const modelId = selection.modelId?.trim()

  if (!modelId) return provider

  return {
    ...provider,
    defaultModel: modelId,
    models: getModelOptions(provider, modelId)
  }
}

export default function App() {
  const isMac = window.gllm.platform === 'darwin'
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ApiProvider[]>([DEFAULT_PROVIDER])
  const [assistants, setAssistants] = useState<Assistant[]>(DEFAULT_ASSISTANTS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [notes, setNotes] = useState<KnowledgeNote[]>([])
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [tools, setTools] = useState<ToolConfig[]>([])
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [dataLocation, setDataLocation] = useState<DataLocationInfo | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeAssistantId, setActiveAssistantId] = useState(DEFAULT_ASSISTANTS[0].id)
  const [draft, setDraft] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isPickingAttachment, setIsPickingAttachment] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantCenterOpen, setAssistantCenterOpen] = useState(false)
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false)
  const [conversationModelOpen, setConversationModelOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [toolCenterOpen, setToolCenterOpen] = useState(false)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [assistantSearchQuery, setAssistantSearchQuery] = useState('')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [toolNotice, setToolNotice] = useState('')
  const [selectionMenu, setSelectionMenu] = useState<SelectionContextMenu | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PreparedAttachment[]>([])
  const [pendingQuoteRefs, setPendingQuoteRefs] = useState<KnowledgeReference[]>([])
  const [pendingKnowledgeRefs, setPendingKnowledgeRefs] = useState<KnowledgeReference[]>([])
  const [translatingMessageIds, setTranslatingMessageIds] = useState<string[]>([])
  const [autoFollowMessages, setAutoFollowMessages] = useState(true)
  const [isNearMessageBottom, setIsNearMessageBottom] = useState(true)
  const [composerHeight, setComposerHeight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const toolNoticeTimerRef = useRef<number | null>(null)
  const streamingConversationDraftsRef = useRef<Record<string, Conversation>>({})

  const activeAssistant = useMemo(() => getAssistantById(activeAssistantId, assistants), [activeAssistantId, assistants])
  const activeProvider = useMemo(
    () => getProviderById(settings?.activeProviderId ?? DEFAULT_PROVIDER_ID, providers),
    [providers, settings?.activeProviderId]
  )
  const assistantDefaultProvider = useMemo(
    () => getEffectiveProvider(activeAssistant, activeProvider, providers),
    [activeAssistant, activeProvider, providers]
  )
  const activeAssistantConversations = useMemo(
    () => conversations.filter((conversation) => conversation.assistantId === activeAssistantId),
    [activeAssistantId, conversations]
  )
  const activeConversation =
    activeAssistantConversations.find((conversation) => conversation.id === activeConversationId) ?? null
  const conversationProvider = useMemo(
    () => (activeConversation ? getEffectiveProvider(activeConversation, assistantDefaultProvider, providers) : assistantDefaultProvider),
    [activeConversation, assistantDefaultProvider, providers]
  )
  const needsApiKey = Boolean(settings && conversationProvider.requiresApiKey && !conversationProvider.apiKey.trim())
  const activeConversationTranslationSignature = activeConversation?.messages
    .map((message) => message.translation?.length ?? 0)
    .join('|')
  const activeConversationTokenUsage = getConversationTokenUsage(activeConversation)
  const activeConversationTitle = activeConversation?.title || activeAssistant.name
  const showScrollToLatest = Boolean(activeConversation?.messages.length && !isNearMessageBottom)
  const waitingForAssistantResponse = Boolean(isStreaming && activeConversation?.messages.at(-1)?.role === 'user')
  const modelCapabilities = useMemo(() => getModelCapabilities(conversationProvider), [conversationProvider])
  const activeAssistantNotes = useMemo(
    () => notes.filter((note) => note.assistantId === activeAssistant.id),
    [activeAssistant.id, notes]
  )
  const activeAssistantMemories = useMemo(
    () => memories.filter((memory) => memory.assistantId === activeAssistant.id),
    [activeAssistant.id, memories]
  )
  const enabledAssistantMemories = useMemo(
    () => activeAssistantMemories.filter((memory) => memory.enabled),
    [activeAssistantMemories]
  )
  const filteredAssistants = useMemo(() => {
    const keyword = assistantSearchQuery.trim().toLocaleLowerCase()
    if (!keyword) return assistants

    return assistants.filter((assistant) => {
      const searchable = [
        assistant.name,
        assistant.title,
        assistant.tone,
        assistant.systemPrompt,
        ...assistant.starterPrompts
      ]
        .join(' ')
        .toLocaleLowerCase()

      return searchable.includes(keyword)
    })
  }, [assistantSearchQuery, assistants])

  useEffect(() => {
    void window.gllm.getState().then((state) => {
      const nextProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
      const provider = getProviderById(state.settings.activeProviderId, nextProviders)
      setAppVersion(state.appVersion || '1.0.0')
      setDataLocation(state.dataLocation)
      setSettings(state.settings)
      setProviders(nextProviders)
      setAssistants(state.assistants.length > 0 ? state.assistants : DEFAULT_ASSISTANTS)
      setConversations(state.conversations)
      setNotes(state.notes)
      setMemories(state.memories ?? [])
      setTools(state.tools ?? [])
      if (state.conversations[0]) {
        setActiveConversationId(state.conversations[0].id)
        setActiveAssistantId(state.conversations[0].assistantId)
      }
      if (!state.settings.setupCompleted) {
        setAgreementOpen(true)
      } else if (provider.requiresApiKey && !provider.apiKey.trim()) {
        setSettingsOpen(true)
      }
    })
  }, [])

  useEffect(() => {
    void window.gllm.setActiveAssistantId(activeAssistantId)
  }, [activeAssistantId])

  useEffect(() => {
    const unsubscribe = window.gllm.onChatChunk((chunk) => {
      setConversations((current) => {
        let updatedConversation: Conversation | null = null
        let matchedConversation = false
        const next = current.map((conversation) => {
          if (conversation.id !== chunk.conversationId) return conversation
          matchedConversation = true
          updatedConversation = applyChatChunkToConversation(conversation, chunk)
          return updatedConversation
        })

        if (!matchedConversation) {
          const draftConversation = streamingConversationDraftsRef.current[chunk.conversationId]
          if (draftConversation) {
            updatedConversation = applyChatChunkToConversation(draftConversation, chunk)
            const nextWithDraft = [updatedConversation, ...current.filter((conversation) => conversation.id !== chunk.conversationId)]
            streamingConversationDraftsRef.current[chunk.conversationId] = updatedConversation
            void window.gllm.saveConversation(updatedConversation)
            return nextWithDraft
          }
        }

        if (updatedConversation) {
          streamingConversationDraftsRef.current[chunk.conversationId] = updatedConversation
          void window.gllm.saveConversation(updatedConversation)
        }
        return next
      })

      if (chunk.done) {
        delete streamingConversationDraftsRef.current[chunk.conversationId]
        if (chunk.targetMessageId) {
          setTranslatingMessageIds((current) => current.filter((id) => id !== chunk.targetMessageId))
        } else {
          setIsStreaming(false)
        }
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    return window.gllm.onConversationChanged((change) => {
      setConversations(change.conversations)
      if (change.action === 'deleted') {
        setActiveConversationId((current) => {
          if (current !== change.conversationId) return current

          const next = change.conversations.find((conversation) => conversation.assistantId === activeAssistantId)
          return next?.id ?? null
        })
        return
      }

      const changedConversation = change.conversations.find((conversation) => conversation.id === change.conversationId)
      if (changedConversation) {
        setActiveAssistantId(changedConversation.assistantId)
      }
      setActiveConversationId(change.conversationId)
    })
  }, [activeAssistantId])

  useEffect(() => {
    if (!selectionMenu) return

    const closeMenu = () => setSelectionMenu(null)
    const closeMenuOnEscape = (event: KeyboardEvent) => {
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
    setAutoFollowMessages(true)
    setIsNearMessageBottom(true)
    window.requestAnimationFrame(() => scrollToLatest('auto'))
  }, [activeConversationId])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return

    const updateHeight = () => setComposerHeight(composer.getBoundingClientRect().height)
    updateHeight()
    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(composer)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!autoFollowMessages) return
    window.requestAnimationFrame(() => scrollToLatest(isStreaming ? 'auto' : 'smooth'))
  }, [
    autoFollowMessages,
    isStreaming,
    activeConversation?.messages.length,
    activeConversation?.messages.at(-1)?.content,
    activeConversationTranslationSignature
  ])

  function showToolNotice(message: string) {
    setToolNotice(message)
    if (toolNoticeTimerRef.current) window.clearTimeout(toolNoticeTimerRef.current)
    toolNoticeTimerRef.current = window.setTimeout(() => setToolNotice(''), 2600)
  }

  function getDistanceToMessageBottom() {
    const list = listRef.current
    if (!list) return 0
    return list.scrollHeight - list.scrollTop - list.clientHeight
  }

  function updateMessageScrollState() {
    setSelectionMenu(null)
    const isNearBottom = getDistanceToMessageBottom() <= bottomFollowThreshold
    setIsNearMessageBottom(isNearBottom)
    setAutoFollowMessages(isNearBottom)
  }

  function scrollToLatest(behavior: ScrollBehavior = 'smooth') {
    const list = listRef.current
    if (!list) return
    list.scrollTo({ top: list.scrollHeight, behavior })
    setIsNearMessageBottom(true)
    setAutoFollowMessages(true)
  }

  async function pickComposerAttachments(kind: AttachmentKind) {
    if (isPickingAttachment) return

    setIsPickingAttachment(true)
    try {
      const picked = await window.gllm.pickAttachments(kind)
      if (picked.length === 0) return

      setPendingAttachments((current) => [...current, ...picked].slice(0, 8))
      const unsupportedImageCount = picked.filter((attachment) => attachment.kind === 'image' && !modelCapabilities.imageInput).length
      const unreadableCount = picked.filter((attachment) => attachment.kind === 'file' && !attachment.text).length
      const imageWithoutDataCount = picked.filter((attachment) => attachment.kind === 'image' && !attachment.dataUrl).length

      if (unsupportedImageCount) {
        showToolNotice('已添加图片，但当前模型可能不支持图片理解，请切换视觉模型')
      } else if (unreadableCount || imageWithoutDataCount) {
        showToolNotice('已添加附件；部分文件过大或格式暂不能解析正文')
      } else {
        showToolNotice(`已添加 ${picked.length} 个附件`)
      }
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '选择附件失败')
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = getClipboardFiles(event.clipboardData).slice(0, 8)
    if (files.length === 0) return

    event.preventDefault()
    if (isPickingAttachment) return

    setIsPickingAttachment(true)
    try {
      const inputs: ClipboardAttachmentInput[] = await Promise.all(
        files.map(async (file, index) => {
          const mimeType = file.type || 'application/octet-stream'
          const extension = getFileExtensionFromMime(mimeType)
          const name = file.name || (mimeType.startsWith('image/') ? `粘贴图片_${index + 1}.${extension}` : `粘贴附件_${index + 1}.${extension}`)
          const canReadContent = file.size <= maxPastedAttachmentBytes

          return {
            name,
            mimeType,
            size: file.size,
            kind: mimeType.startsWith('image/') ? 'image' : 'file',
            dataUrl: canReadContent ? await readFileAsDataUrl(file) : undefined
          }
        })
      )
      const pasted = await window.gllm.preparePastedAttachments(inputs)
      if (pasted.length === 0) return

      setPendingAttachments((current) => [...current, ...pasted].slice(0, 8))
      const imageCount = pasted.filter((attachment) => attachment.kind === 'image').length
      const unreadableCount = pasted.filter((attachment) => attachment.kind === 'file' && !attachment.text).length

      if (imageCount > 0 && !modelCapabilities.imageInput) {
        showToolNotice('已从剪贴板添加图片，但当前模型可能不支持图片理解')
      } else if (unreadableCount > 0) {
        showToolNotice('已从剪贴板添加附件；部分文件暂不能解析正文')
      } else {
        showToolNotice(`已从剪贴板添加 ${pasted.length} 个附件`)
      }
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '粘贴附件失败')
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function referenceKnowledgeNote(note: KnowledgeNote) {
    const reference: KnowledgeReference = {
      id: note.id,
      title: note.title,
      content: note.content
    }

    setPendingKnowledgeRefs((current) => {
      if (current.some((item) => item.id === reference.id)) return current
      return [...current, reference].slice(0, 8)
    })
    showToolNotice(`已引用「${note.title}」，发送时会作为上下文`)
  }

  function removePendingKnowledgeRef(id: string) {
    setPendingKnowledgeRefs((current) => current.filter((reference) => reference.id !== id))
  }

  function addQuoteReference(content: string) {
    const normalized = content.replace(/\r\n/g, '\n').trim()
    if (!normalized) return

    setPendingQuoteRefs((current) => {
      if (current.some((reference) => reference.content.trim() === normalized)) return current

      return [
        ...current,
        {
          id: createId('quote'),
          title: getQuoteReferenceTitle(normalized),
          content: normalized
        }
      ].slice(-6)
    })
  }

  function removePendingQuoteRef(id: string) {
    setPendingQuoteRefs((current) => current.filter((reference) => reference.id !== id))
  }

  async function captureComposerScreenshot() {
    if (isPickingAttachment) return

    setIsPickingAttachment(true)
    try {
      showToolNotice('已打开系统截图，选择区域后会自动添加')
      const screenshot = await window.gllm.captureScreenshot()
      if (!screenshot) {
        showToolNotice('未检测到新的截图')
        return
      }

      setPendingAttachments((current) => [...current, screenshot].slice(0, 8))
      showToolNotice(modelCapabilities.imageInput ? '已添加截图' : '已添加截图，但当前模型可能不支持图片理解')
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '截图失败')
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function openAssistant(assistant: Assistant) {
    setActiveAssistantId(assistant.id)
    setPendingQuoteRefs([])
    setPendingKnowledgeRefs([])
    const existing = conversations.find((conversation) => conversation.assistantId === assistant.id)
    setActiveConversationId(existing?.id ?? null)
  }

  function startNewChat() {
    const conversation = createConversation(activeAssistant, assistantDefaultProvider)
    setConversations((current) => [conversation, ...current])
    setActiveConversationId(conversation.id)
    void window.gllm.saveConversation(conversation)
  }

  function openConversationModelSettings() {
    if (activeConversation) {
      setConversationModelOpen(true)
      return
    }

    const conversation = createConversation(activeAssistant, assistantDefaultProvider)
    setConversations((current) => [conversation, ...current])
    setActiveConversationId(conversation.id)
    void window.gllm.saveConversation(conversation)
    setConversationModelOpen(true)
  }

  async function removeConversation(id: string) {
    const nextConversations = conversations.filter((conversation) => conversation.id !== id)
    setConversations(nextConversations)
    if (activeConversationId === id) {
      const next = nextConversations.find((conversation) => conversation.assistantId === activeAssistantId)
      setActiveConversationId(next?.id ?? null)
    }
    await window.gllm.deleteConversation(id)
  }

  function saveConversationUpdate(conversation: Conversation) {
    const nextConversation = withConversationTokens(conversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    void window.gllm.saveConversation(nextConversation)
  }

  function getSelectedTextForMessage(messageId: string): string {
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim() ?? ''
    if (!selection || selection.rangeCount === 0 || !selectedText) return ''

    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
    if (!messageElement) return ''

    const anchorInside = selection.anchorNode ? messageElement.contains(selection.anchorNode) : false
    const focusInside = selection.focusNode ? messageElement.contains(selection.focusNode) : false
    return anchorInside && focusInside ? selectedText : ''
  }

  async function copyMessage(content: string, messageId?: string) {
    const selectedText = messageId ? getSelectedTextForMessage(messageId) : ''
    const textToCopy = selectedText || content

    try {
      await navigator.clipboard.writeText(textToCopy)
      showToolNotice(selectedText ? '已复制选中内容' : '已复制到剪贴板')
    } catch {
      showToolNotice('复制失败，请手动选择文本复制')
    }
  }

  function quoteMessage(message: ChatMessage) {
    const selectedText = getSelectedTextForMessage(message.id)
    addQuoteReference(selectedText || message.content)
    showToolNotice(selectedText ? '已添加选中引用，发送时会作为上下文' : '已添加消息引用，发送时会作为上下文')
  }

  function openSelectionContextMenu(event: ReactMouseEvent, message: ChatMessage) {
    const selectedText = getSelectedTextForMessage(message.id)
    if (!selectedText || message.role !== 'assistant') {
      setSelectionMenu(null)
      return
    }

    event.preventDefault()
    setSelectionMenu({
      x: Math.min(event.clientX, window.innerWidth - 156),
      y: Math.min(event.clientY, window.innerHeight - 94),
      text: selectedText
    })
  }

  async function copySelectionMenuText() {
    if (!selectionMenu) return

    try {
      await navigator.clipboard.writeText(selectionMenu.text)
      showToolNotice('已复制选中内容')
    } catch {
      showToolNotice('复制失败，请手动选择文本复制')
    } finally {
      setSelectionMenu(null)
    }
  }

  function quoteSelectionMenuText() {
    if (!selectionMenu) return
    addQuoteReference(selectionMenu.text)
    setSelectionMenu(null)
    showToolNotice('已添加选中引用，发送时会作为上下文')
  }

  async function saveMessageToNote(message: ChatMessage) {
    if (!activeConversation) return

    const content = [message.content, message.translation ? `译文：\n${message.translation}` : ''].filter(Boolean).join('\n\n')
    const title = content
      .split('\n')
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 36) || '聊天笔记'
    const now = Date.now()
    const saved = await window.gllm.saveNote({
      id: createId('note'),
      title,
      content,
      assistantId: activeAssistant.id,
      conversationId: activeConversation.id,
      messageId: message.id,
      createdAt: now,
      updatedAt: now
    })

    setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)])
    showToolNotice('已保存到本地知识库')
  }

  async function deleteNote(id: string) {
    await window.gllm.deleteNote(id)
    setNotes((current) => current.filter((note) => note.id !== id))
  }

  async function saveAssistantMemory(memory: AssistantMemory) {
    const saved = await window.gllm.saveMemory(memory)
    setMemories((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    return saved
  }

  async function deleteAssistantMemory(id: string) {
    await window.gllm.deleteMemory(id)
    setMemories((current) => current.filter((memory) => memory.id !== id))
  }

  async function saveToolConfig(tool: ToolConfig) {
    const saved = await window.gllm.saveTool(tool)
    setTools((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    return saved
  }

  async function deleteToolConfig(id: string) {
    await window.gllm.deleteTool(id)
    setTools((current) => current.filter((tool) => tool.id !== id))
  }

  function translateMessage(message: ChatMessage) {
    if (!settings || !activeConversation) return
    if (isStreaming) {
      showToolNotice('当前回答生成中，稍后再翻译')
      return
    }
    if (translatingMessageIds.includes(message.id)) return
    if (needsApiKey) {
      setSettingsOpen(true)
      return
    }

    const source = message.content.trim()
    if (!source) return

    const nextConversation: Conversation = withConversationTokens({
      ...activeConversation,
      messages: activeConversation.messages.map((item) => (item.id === message.id ? { ...item, translation: '' } : item)),
      updatedAt: Date.now()
    })
    const translationAssistant: Assistant = {
      ...activeAssistant,
      id: `${activeAssistant.id}_translator`,
      name: '翻译助手',
      title: '消息翻译',
      tone: '准确、自然',
      systemPrompt:
        '你是专业翻译助手。请只输出译文，不要解释，不要添加标题。如果原文是中文，翻译成自然英文；如果原文不是中文，翻译成自然中文。保留原文的段落结构、列表结构和专有名词。'
    }

    setTranslatingMessageIds((current) => (current.includes(message.id) ? current : [...current, message.id]))
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: translationAssistant,
      provider: conversationProvider,
      messages: [createMessage('user', source)],
      settings,
      purpose: 'translation',
      targetMessageId: message.id
    })
  }

  function deleteMessage(messageId: string) {
    if (!activeConversation) return

    const messages = activeConversation.messages.filter((message) => message.id !== messageId)
    const firstUserMessage = messages.find((message) => message.role === 'user')
    const nextConversation: Conversation = {
      ...activeConversation,
      title: firstUserMessage?.content.slice(0, 28) || activeConversation.title,
      messages,
      updatedAt: Date.now()
    }

    saveConversationUpdate(nextConversation)
    showToolNotice('消息已删除')
  }

  function regenerateMessage(messageId: string) {
    if (!settings || isStreaming || !activeConversation) return
    if (needsApiKey) {
      setSettingsOpen(true)
      return
    }

    const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId)
    if (messageIndex <= 0) {
      showToolNotice('这条消息前没有可重新生成的上下文')
      return
    }

    const messages = activeConversation.messages.slice(0, messageIndex)
    if (!messages.some((message) => message.role === 'user')) {
      showToolNotice('这条消息前没有用户问题')
      return
    }

    const nextConversation: Conversation = {
      ...activeConversation,
      messages,
      updatedAt: Date.now()
    }

    setIsStreaming(true)
    saveConversationUpdate(nextConversation)
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: activeAssistant,
      assistantMemories: enabledAssistantMemories,
      provider: conversationProvider,
      messages: nextConversation.messages,
      settings,
      webSearchEnabled
    })
  }

  function sendMessage(content = draft) {
    if (!settings || isStreaming) return
    if (needsApiKey) {
      setSettingsOpen(true)
      return
    }

    const text = content.trim()
    const contextRefs = [...pendingQuoteRefs, ...pendingKnowledgeRefs]
    if (!text && pendingAttachments.length === 0 && contextRefs.length === 0) return
    const messageText =
      text ||
      (pendingQuoteRefs.length > 0
        ? '请结合我引用的对话内容回答。'
        : pendingKnowledgeRefs.length > 0
          ? '请结合我引用的本地知识库内容回答。'
        : pendingAttachments.some((attachment) => attachment.kind === 'image')
          ? '请分析我上传的图片。'
          : '请分析我上传的附件。')

    const baseConversation =
      activeConversation?.assistantId === activeAssistant.id
        ? activeConversation
        : createConversation(activeAssistant, assistantDefaultProvider)
    const attachments = pendingAttachments
    const knowledgeRefs = contextRefs
    const userMessage = createMessage('user', messageText, attachments, knowledgeRefs)
    const nextConversation: Conversation = withConversationTokens({
      ...baseConversation,
      assistantId: activeAssistant.id,
      title: baseConversation.messages.length === 0 ? messageText.slice(0, 28) : baseConversation.title,
      messages: [...baseConversation.messages, userMessage],
      updatedAt: Date.now()
    })

    setDraft('')
    setPendingAttachments([])
    setPendingQuoteRefs([])
    setPendingKnowledgeRefs([])
    setIsStreaming(true)
    setActiveConversationId(nextConversation.id)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    void window.gllm.saveConversation(nextConversation)
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: activeAssistant,
      assistantMemories: enabledAssistantMemories,
      provider: activeConversation?.assistantId === activeAssistant.id ? conversationProvider : assistantDefaultProvider,
      messages: nextConversation.messages,
      settings,
      webSearchEnabled
    })
  }

  async function saveSettings(next: AppSettings) {
    const saved = await window.gllm.saveSettings(next)
    setSettings(saved)
    return saved
  }

  async function acceptUserAgreement() {
    if (!settings) return

    const saved = await saveSettings({
      ...settings,
      setupCompleted: true
    })
    setAgreementOpen(false)

    const provider = getProviderById(saved.activeProviderId, providers)
    if (provider.requiresApiKey && !provider.apiKey.trim()) {
      setSettingsOpen(true)
    }
  }

  async function recoverExistingDataDirectory() {
    try {
      const result = await window.gllm.chooseExistingDataDirectory()
      if (!result) return

      setDataLocation(result.info)
      const shouldRestart = window.confirm(`${result.message}\n\n现在重启 G-LLM 并载入该数据目录吗？`)
      if (shouldRestart) {
        await window.gllm.relaunchApp()
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveProvider(next: ApiProvider) {
    const saved = await window.gllm.saveProvider(next)
    setProviders((current) => [saved, ...current.filter((provider) => provider.id !== saved.id)])
    return saved
  }

  async function checkProvider(next: ApiProvider): Promise<ProviderCheckResult> {
    return window.gllm.checkProvider(next)
  }

  async function refreshProviderModels(next: ApiProvider) {
    const saved = await window.gllm.refreshProviderModels(next)
    setProviders((current) => [saved, ...current.filter((provider) => provider.id !== saved.id)])
    return saved
  }

  async function deleteProvider(id: string) {
    await window.gllm.deleteProvider(id)
    setProviders((current) => current.filter((provider) => provider.id !== id))
    setSettings((current) => (current?.activeProviderId === id ? { ...current, activeProviderId: DEFAULT_PROVIDER_ID } : current))
  }

  async function saveAssistant(next: Assistant) {
    const saved = await window.gllm.saveAssistant(next)
    setAssistants((current) => {
      if (current.some((assistant) => assistant.id === saved.id)) {
        return current.map((assistant) => (assistant.id === saved.id ? saved : assistant))
      }

      const builtIns = current.filter((assistant) => assistant.builtIn)
      const custom = current.filter((assistant) => !assistant.builtIn)
      return [...builtIns, saved, ...custom]
    })
    setActiveAssistantId(saved.id)
    return saved
  }

  async function suggestAssistant(keyword: string): Promise<AssistantSuggestion> {
    if (!settings) throw new Error('设置尚未加载')
    return window.gllm.suggestAssistant({
      keyword,
      provider: activeProvider,
      settings
    })
  }

  if (!settings) {
    return (
      <div className={`boot ${isMac ? 'mac-window' : ''}`}>
        <img src={logo} alt="G-LLM" />
      </div>
    )
  }

  return (
    <div
      className={`app-shell ${isMac ? 'mac-window' : ''} ${railCollapsed ? 'rail-collapsed' : ''} ${historyCollapsed ? 'history-collapsed' : ''}`}
    >
      {!railCollapsed && (
        <aside className="rail">
          <div className="brand">
            <img src={logo} alt="G-LLM" />
            <div>
              <strong>无极界</strong>
              <span>G-LLM</span>
            </div>
            <button className="icon-button compact" onClick={() => setRailCollapsed(true)} title="折叠助手栏" type="button">
              <PanelLeftClose size={16} />
            </button>
          </div>

          <label className="assistant-search" title="搜索助手">
            <Search size={15} />
            <input
              value={assistantSearchQuery}
              placeholder="搜索助手"
              onChange={(event) => setAssistantSearchQuery(event.target.value)}
            />
            {assistantSearchQuery && (
              <button onClick={() => setAssistantSearchQuery('')} title="清空搜索" type="button">
                <X size={14} />
              </button>
            )}
          </label>

          <div className="assistant-list">
            {filteredAssistants.map((assistant) => {
              const active = assistant.id === activeAssistantId
              return (
                <button
                  key={assistant.id}
                  className={`assistant-card ${assistant.color} ${active ? 'active' : ''}`}
                  onClick={() => openAssistant(assistant)}
                  title={assistant.name}
                >
                  <AssistantAvatar assistant={assistant} />
                  <span>
                    <strong>{assistant.name}</strong>
                    <small>{assistant.title}</small>
                  </span>
                </button>
              )
            })}
            {filteredAssistants.length === 0 && (
              <div className="assistant-empty">
                <Search size={18} />
                <span>没有找到相关助手</span>
              </div>
            )}
          </div>

          <div className="rail-actions">
            <button className="icon-button" onClick={() => setAssistantCenterOpen(true)} title="新增助手">
              <Plus size={18} />
            </button>
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="供应商设置">
              <Settings size={18} />
            </button>
          </div>
        </aside>
      )}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {railCollapsed && (
              <button className="icon-button compact" onClick={() => setRailCollapsed(false)} title="展开助手栏" type="button">
                <PanelLeftOpen size={16} />
              </button>
            )}
            <div className="topbar-title">
              <p>{activeAssistant.name} · {activeAssistant.tone}</p>
              <div className="topbar-heading">
                <h1>{activeConversationTitle}</h1>
                {activeConversation && (
                  <span
                    className="topbar-token-total"
                    title={`本次会话总词元：数量 ${formatTokenUnit(activeConversationTokenUsage.total)}，输入 ${formatTokenUnit(activeConversationTokenUsage.input)}，输出 ${formatTokenUnit(activeConversationTokenUsage.output)}`}
                  >
                    总词元：{formatTokenUnit(activeConversationTokenUsage.total)}
                    <span>↑{formatTokenUnit(activeConversationTokenUsage.input)}</span>
                    <span>↓{formatTokenUnit(activeConversationTokenUsage.output)}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button compact" onClick={() => setAssistantSettingsOpen(true)} title="助手设置" type="button">
              <Pencil size={16} />
            </button>
            <button className={`status-pill ${needsApiKey ? 'warning' : ''}`} onClick={openConversationModelSettings}>
              {`${conversationProvider.name} · ${conversationProvider.defaultModel}`}
            </button>
            <button className="icon-button compact" onClick={openConversationModelSettings} title="会话模型">
              <SlidersHorizontal size={16} />
            </button>
            {historyCollapsed && (
              <button className="icon-button compact" onClick={() => setHistoryCollapsed(false)} title="展开会话栏" type="button">
                <PanelRightOpen size={16} />
              </button>
            )}
          </div>
        </header>

        <section className="chat-panel">
          <div className="messages" ref={listRef} onScroll={updateMessageScrollState}>
            {needsApiKey && (
              <div className="setup-banner">
                <KeyRound size={18} />
                <span>首次使用需要为 {conversationProvider.name} 填写 API Key。</span>
                <button onClick={() => setSettingsOpen(true)}>配置</button>
              </div>
            )}
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="starter-grid">
                {activeAssistant.starterPrompts.map((prompt) => (
                  <button key={prompt} onClick={() => sendMessage(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            ) : (
              <>
              {activeConversation.messages.map((message) => {
                const isTranslating = translatingMessageIds.includes(message.id)
                const messageTokens = estimateMessageTokenUsage(message)

                return (
                  <article
                    key={message.id}
                    className={`message ${message.role}`}
                    data-message-id={message.id}
                    onContextMenu={(event) => openSelectionContextMenu(event, message)}
                  >
                    <div className="message-stack">
                      <div className="message-bubble">
                        {message.webSearch && <WebSearchActivityCard activity={message.webSearch} />}
                        {(message.content.trim() || !message.webSearch) && (
                          <div className="message-content markdown-body">
                            <MarkdownMessage content={message.content} />
                          </div>
                        )}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="message-attachments">
                            {message.attachments.map((attachment) => (
                              <span
                                key={attachment.id}
                                className="attachment-chip"
                                title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}
                              >
                                {attachment.kind === 'image' ? <ImagePlus size={14} /> : <Paperclip size={14} />}
                                {attachment.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {message.knowledgeRefs && message.knowledgeRefs.length > 0 && (
                          <div className="message-attachments">
                            {message.knowledgeRefs.map((reference) => {
                              const isQuote = isQuoteReference(reference)
                              return (
                                <span
                                  key={reference.id}
                                  className={`attachment-chip ${isQuote ? 'quote-chip' : 'knowledge-chip'}`}
                                  title={reference.content}
                                >
                                  {isQuote ? <AtSign size={14} /> : <BookOpen size={14} />}
                                  {reference.title}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        {(message.translation !== undefined || isTranslating) && (
                          <div className="translation-block">
                            <div className="translation-divider">
                              <span />
                              <Languages size={16} />
                              <span />
                            </div>
                            <div className={`message-translation markdown-body ${!message.translation ? 'pending' : ''}`}>
                              {message.translation ? <MarkdownMessage content={message.translation} /> : '正在翻译...'}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="message-footer">
                        <div className="message-actions" onMouseDown={(event) => event.preventDefault()}>
                          <button title="复制选中内容或整条消息" type="button" onClick={() => void copyMessage(message.content, message.id)}>
                            <Copy size={16} />
                          </button>
                          {message.role === 'assistant' && (
                            <button
                              disabled={isStreaming}
                              title="重新生成"
                              type="button"
                              onClick={() => regenerateMessage(message.id)}
                            >
                              <RefreshCw size={16} />
                            </button>
                          )}
                          <button title="引用选中内容或整条消息" type="button" onClick={() => quoteMessage(message)}>
                            <AtSign size={16} />
                          </button>
                          <button
                            disabled={isStreaming || isTranslating}
                            title={isTranslating ? '正在翻译' : '翻译'}
                            type="button"
                            onClick={() => translateMessage(message)}
                          >
                            <Languages size={16} />
                          </button>
                          <button title="保存到本地知识库" type="button" onClick={() => void saveMessageToNote(message)}>
                            <NotebookPen size={16} />
                          </button>
                          <button title="删除" type="button" onClick={() => deleteMessage(message.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <span
                          className="message-token"
                          title={`词元：数量 ${formatTokenUnit(messageTokens.total)}，输入 ${formatTokenUnit(messageTokens.input)}，输出 ${formatTokenUnit(messageTokens.output)}`}
                        >
                          词元：{formatTokenUnit(messageTokens.total)}
                          <span>↑{formatTokenUnit(messageTokens.input)}</span>
                          <span>↓{formatTokenUnit(messageTokens.output)}</span>
                        </span>
                      </div>
                    </div>
                  </article>
                )
              })
              }
              {waitingForAssistantResponse && (
                <article className="message assistant pending-response" aria-live="polite">
                  <div className="message-stack">
                    <div className="message-bubble pending-response-bubble">
                      <div className="pending-response-content">
                        <span className="typing-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span>正在等待 {conversationProvider.defaultModel} 响应...</span>
                      </div>
                    </div>
                  </div>
                </article>
              )}
              </>
            )}
          </div>
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
          {showScrollToLatest && (
            <button
              className="scroll-latest-button"
              style={{ bottom: `${Math.max(104, composerHeight + 18)}px` }}
              type="button"
              onClick={() => scrollToLatest('smooth')}
            >
              {isStreaming ? 'AI 正在回复 · ↓' : '↓ 回到底部'}
            </button>
          )}

          <form
            className="composer"
            ref={composerRef}
            onSubmit={(event) => {
              event.preventDefault()
              sendMessage()
            }}
          >
            <div className="composer-toolbar">
              <div className="composer-tools">
                <button
                  className={pendingAttachments.some((attachment) => attachment.kind === 'file') ? 'active' : ''}
                  disabled={isPickingAttachment}
                  title="上传附件，支持图片、PDF、Word、文本等"
                  type="button"
                  onClick={() => void pickComposerAttachments('file')}
                >
                  <Paperclip size={16} />
                </button>
                <button
                  className={pendingAttachments.some((attachment) => attachment.kind === 'image') ? 'active' : ''}
                  disabled={isPickingAttachment}
                  title="截图"
                  type="button"
                  onClick={() => void captureComposerScreenshot()}
                >
                  <ImagePlus size={16} />
                </button>
                <button
                  className={knowledgeOpen || pendingKnowledgeRefs.length > 0 ? 'active' : ''}
                  title="知识库"
                  type="button"
                  onClick={() => setKnowledgeOpen(true)}
                >
                  <BookOpen size={16} />
                </button>
                <button
                  className={webSearchEnabled ? 'active' : ''}
                  title="联网搜索"
                  type="button"
                  onClick={() => {
                    setWebSearchEnabled((enabled) => {
                      showToolNotice(enabled ? '已关闭联网搜索' : '已开启联网搜索，发送时会抓取搜索结果')
                      return !enabled
                    })
                  }}
                >
                  <Globe2 size={16} />
                </button>
                <button
                  className={toolCenterOpen || tools.some((tool) => tool.enabled) ? 'active' : ''}
                  title="扩展工具配置"
                  type="button"
                  onClick={() => setToolCenterOpen(true)}
                >
                  <Wrench size={16} />
                </button>
              </div>
              <button className="composer-model" type="button" onClick={openConversationModelSettings} title="切换本会话模型">
                {conversationProvider.defaultModel}
              </button>
            </div>
            {toolNotice && <div className="composer-notice">{toolNotice}</div>}
            {pendingQuoteRefs.length > 0 && (
              <div className="composer-quote-cards">
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
            {pendingAttachments.length > 0 && (
              <div className="composer-attachments">
                {pendingAttachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className={`attachment-chip ${attachment.kind === 'image' && !modelCapabilities.imageInput ? 'warning' : ''}`}
                    title={`${attachment.name} · ${formatAttachmentSize(attachment.size)} · ${getAttachmentSupportLabel(attachment, modelCapabilities)}`}
                  >
                    {attachment.kind === 'image' ? <ImagePlus size={14} /> : <Paperclip size={14} />}
                    <span>{attachment.name}</span>
                    <button onClick={() => removePendingAttachment(attachment.id)} title="移除" type="button">
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {pendingKnowledgeRefs.length > 0 && (
              <div className="composer-attachments">
                {pendingKnowledgeRefs.map((reference) => (
                  <span key={reference.id} className="attachment-chip knowledge-chip" title={reference.content}>
                    <BookOpen size={14} />
                    <span>{reference.title}</span>
                    <button onClick={() => removePendingKnowledgeRef(reference.id)} title="移除引用" type="button">
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-input-row">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => void handleComposerPaste(event)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder={needsApiKey ? '请先配置 API Key' : `向 ${activeAssistant.name} 发送消息`}
                rows={1}
              />
              <button
                className="send-button"
                disabled={
                  (!draft.trim() && pendingAttachments.length === 0 && pendingQuoteRefs.length === 0 && pendingKnowledgeRefs.length === 0) ||
                  isStreaming
                }
                title="发送"
              >
                <Send size={18} />
              </button>
            </div>
          </form>
        </section>
      </main>

      {!historyCollapsed && (
        <aside className="history">
          <div className="history-title">
            <div>
              <PanelRightOpen size={17} />
              <span>当前助手会话</span>
            </div>
            <div className="history-title-actions">
              <button className="icon-button compact" onClick={startNewChat} title="新对话">
                <MessageSquarePlus size={16} />
              </button>
              <button className="icon-button compact" onClick={() => setHistoryCollapsed(true)} title="折叠会话栏" type="button">
                <PanelRightClose size={16} />
              </button>
            </div>
          </div>
          <div className="history-list">
            {activeAssistantConversations.length === 0 && <div className="history-empty">暂无会话</div>}
            {activeAssistantConversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`history-item ${conversation.id === activeConversationId ? 'active' : ''}`}
                onClick={() => {
                  setActiveConversationId(conversation.id)
                }}
              >
                <span>{conversation.title}</span>
                <Trash2
                  size={15}
                  onClick={(event) => {
                    event.stopPropagation()
                    void removeConversation(conversation.id)
                  }}
                />
              </button>
            ))}
          </div>
        </aside>
      )}

      {assistantCenterOpen && (
        <AddAssistantDialog
          globalProviderId={settings.activeProviderId}
          providers={providers}
          onClose={() => setAssistantCenterOpen(false)}
          onSave={saveAssistant}
          onSuggest={suggestAssistant}
        />
      )}
      {assistantSettingsOpen && (
        <AssistantSettingsDialog
          assistant={activeAssistant}
          onClose={() => setAssistantSettingsOpen(false)}
          onSave={saveAssistant}
        />
      )}
      {conversationModelOpen && activeConversation && (
        <ConversationModelDialog
          conversation={activeConversation}
          assistant={activeAssistant}
          globalProviderId={settings.activeProviderId}
          providers={providers}
          onClose={() => setConversationModelOpen(false)}
          onSaveAssistant={saveAssistant}
          onSaveConversation={saveConversationUpdate}
        />
      )}
      {knowledgeOpen && (
        <KnowledgeBaseDialog
          assistant={activeAssistant}
          memories={activeAssistantMemories}
          notes={activeAssistantNotes}
          onClose={() => setKnowledgeOpen(false)}
          onCopy={copyMessage}
          onDelete={deleteNote}
          onDeleteMemory={deleteAssistantMemory}
          onReference={referenceKnowledgeNote}
          onSaveMemory={saveAssistantMemory}
        />
      )}
      {toolCenterOpen && (
        <ToolConfigDialog
          tools={tools}
          onClose={() => setToolCenterOpen(false)}
          onDelete={deleteToolConfig}
          onSave={saveToolConfig}
        />
      )}
      {agreementOpen && settings && (
        <UserAgreementDialog
          onAccept={() => void acceptUserAgreement()}
          onRecoverData={() => void recoverExistingDataDirectory()}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          appVersion={appVersion}
          dataLocation={dataLocation}
          settings={settings}
          providers={providers}
          onClose={() => setSettingsOpen(false)}
          onSaveSettings={saveSettings}
          onSaveProvider={saveProvider}
          onCheckProvider={checkProvider}
          onRefreshProviderModels={refreshProviderModels}
          onDeleteProvider={deleteProvider}
          onDataLocationChange={setDataLocation}
        />
      )}
    </div>
  )
}

function UserAgreementDialog({ onAccept, onRecoverData }: { onAccept: () => void; onRecoverData: () => void }) {
  const [recoverHintVisible, setRecoverHintVisible] = useState(false)

  return (
    <div className="assistant-modal-backdrop agreement-backdrop">
      <section className="agreement-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>G-LLM</p>
            <h2>使用协议</h2>
          </div>
        </header>

        <div className="agreement-content">
          <p>
            欢迎使用无极界 G-LLM。本软件是一个本地 AI 客户端，用于连接你配置的模型服务、管理助手、会话、附件、本地知识库和长期记忆。
          </p>
          <section>
            <strong>本地数据</strong>
            <p>
              你的聊天记录、助手配置、本地知识库、长期记忆和供应商配置默认保存在当前设备本地。请自行做好重要数据备份，并妥善保管 API Key。
            </p>
            {recoverHintVisible && (
              <p className="agreement-recover-hint">
                如果你重装过系统、移动过软件目录，或已经有以前备份的 G-LLM 数据目录，可以选择该目录并重启软件恢复数据。
              </p>
            )}
          </section>
          <section>
            <strong>模型服务</strong>
            <p>
              软件会把你发送的消息、附件解析内容和必要上下文提交给你选择的模型供应商。不同供应商的数据处理规则以其自身服务条款为准。
            </p>
          </section>
          <section>
            <strong>使用责任</strong>
            <p>
              AI 输出可能存在错误、遗漏或时效性问题。医疗、法律、投资、工程等高风险场景请以专业人士或权威资料为准。
            </p>
          </section>
          <section>
            <strong>匿名使用统计</strong>
            <p>
              匿名统计默认开启，用于了解版本活跃、功能使用和错误类别；不收集聊天内容、API Key、上传文件内容和知识库内容。你可以在供应商设置中随时关闭。
            </p>
          </section>
        </div>

        <div className="agreement-actions">
          <button
            className="secondary-action"
            onClick={() => {
              setRecoverHintVisible(true)
              onRecoverData()
            }}
            type="button"
          >
            我已有数据目录
          </button>
          <button className="primary-action" onClick={onAccept} type="button">
            同意并开始使用
          </button>
        </div>
      </section>
    </div>
  )
}

function AssistantSettingsDialog({
  assistant,
  onClose,
  onSave
}: {
  assistant: Assistant
  onClose: () => void
  onSave: (assistant: Assistant) => Promise<Assistant>
}) {
  const builtInAssistant = DEFAULT_ASSISTANTS.find((item) => item.id === assistant.id)
  const [name, setName] = useState(assistant.name)
  const [title, setTitle] = useState(assistant.title)
  const [tone, setTone] = useState(assistant.tone)
  const [avatarDataUrl, setAvatarDataUrl] = useState(assistant.avatarDataUrl ?? '')
  const [avatarSourceDataUrl, setAvatarSourceDataUrl] = useState('')
  const [avatarZoom, setAvatarZoom] = useState(1)
  const [systemPrompt, setSystemPrompt] = useState(assistant.systemPrompt)
  const [starterPromptText, setStarterPromptText] = useState(assistant.starterPrompts.join('\n'))
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const previewAssistant: Assistant = { ...assistant, name, title, tone, avatarDataUrl: avatarDataUrl || undefined }
  const starterPrompts = starterPromptText
    .split('\n')
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(0, 6)
  const changed =
    name.trim() !== assistant.name ||
    title.trim() !== assistant.title ||
    tone.trim() !== assistant.tone ||
    (avatarDataUrl || undefined) !== (assistant.avatarDataUrl || undefined) ||
    systemPrompt.trim() !== assistant.systemPrompt ||
    starterPrompts.join('\n') !== assistant.starterPrompts.join('\n')

  useEffect(() => {
    if (!avatarSourceDataUrl) return

    let disposed = false
    cropImageToSquareDataUrl(avatarSourceDataUrl, avatarZoom)
      .then((dataUrl) => {
        if (!disposed) setAvatarDataUrl(dataUrl)
      })
      .catch((error) => {
        if (!disposed) setStatus(error instanceof Error ? error.message : '头像裁剪失败')
      })

    return () => {
      disposed = true
    }
  }, [avatarSourceDataUrl, avatarZoom])

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setStatus('请选择图片文件作为助手头像')
      return
    }

    if (file.size > 8 * 1024 * 1024) {
      setStatus('头像图片不能超过 8 MB')
      return
    }

    try {
      const source = await readFileAsDataUrl(file)
      const cropped = await cropImageToSquareDataUrl(source, 1)
      setAvatarZoom(1)
      setAvatarSourceDataUrl(source)
      setAvatarDataUrl(cropped)
      setStatus('已生成头像预览，保存后生效')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '头像读取失败')
    }
  }

  async function save() {
    const nextPrompt = systemPrompt.trim()
    if (!nextPrompt) {
      setStatus('默认提示词不能为空')
      return
    }

    setSaving(true)
    setStatus('正在保存助手设置...')
    try {
      await onSave({
        ...assistant,
        name: name.trim() || assistant.name,
        title: title.trim() || assistant.title,
        tone: tone.trim() || assistant.tone,
        systemPrompt: nextPrompt,
        starterPrompts: starterPrompts.length > 0 ? starterPrompts : assistant.starterPrompts,
        avatarDataUrl: avatarDataUrl || undefined,
        updatedAt: Date.now()
      })
      setStatus('已保存助手设置')
      onClose()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function restoreBuiltInPrompt() {
    if (!builtInAssistant) return
    setSystemPrompt(builtInAssistant.systemPrompt)
    setStatus('已恢复内置默认提示词，保存后生效')
  }

  function restoreDefaultAvatar() {
    setAvatarSourceDataUrl('')
    setAvatarDataUrl('')
    setAvatarZoom(1)
    setStatus('已恢复默认图标，保存后生效')
  }

  return (
    <div className="assistant-modal-backdrop" onClick={onClose}>
      <section className="assistant-settings-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>{assistant.builtIn ? '内置助手' : '自定义助手'}</p>
            <h2>助手设置</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭" type="button">
            <X size={18} />
          </button>
        </header>

        <div className="assistant-settings-form">
          <div className="assistant-avatar-editor">
            <AssistantAvatar assistant={previewAssistant} className="large" />
            <div>
              <strong>助手头像</strong>
              <p>上传图片后会自动居中裁剪为方形头像，可用缩放调整画面大小。</p>
              <input ref={avatarInputRef} accept="image/*" hidden type="file" onChange={(event) => void chooseAvatar(event)} />
              <div className="assistant-avatar-actions">
                <button className="secondary-action" disabled={saving} onClick={() => avatarInputRef.current?.click()} type="button">
                  上传图片
                </button>
                <button className="secondary-action" disabled={saving || !avatarDataUrl} onClick={restoreDefaultAvatar} type="button">
                  恢复默认图标
                </button>
              </div>
              {avatarSourceDataUrl && (
                <label className="assistant-avatar-zoom">
                  <span>裁剪缩放</span>
                  <input
                    max="2.5"
                    min="1"
                    step="0.01"
                    type="range"
                    value={avatarZoom}
                    onChange={(event) => setAvatarZoom(Number(event.target.value))}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="form-row two">
            <label>
              <span>助手名称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>回答风格</span>
              <input value={tone} onChange={(event) => setTone(event.target.value)} />
            </label>
          </div>

          <label>
            <span>助手说明</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label>
            <span>默认提示词</span>
            <textarea
              className="assistant-prompt-textarea"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </label>

          <label>
            <span>开场问题</span>
            <textarea
              className="assistant-starters-textarea"
              value={starterPromptText}
              onChange={(event) => setStarterPromptText(event.target.value)}
            />
          </label>

          <div className="assistant-settings-note">
            修改后的默认提示词会用于该助手后续发送的新请求；已经生成过的历史回复不会被改写。
          </div>

          {status && <div className="assistant-status">{status}</div>}
        </div>

        <div className="form-actions assistant-settings-actions">
          <button className="secondary-action" disabled={!builtInAssistant || saving} onClick={restoreBuiltInPrompt} type="button">
            恢复内置提示词
          </button>
          <button className="secondary-action" disabled={saving} onClick={onClose} type="button">
            不保存关闭
          </button>
          <button className="primary-action" disabled={saving || !changed} onClick={() => void save()} type="button">
            <Save size={17} />
            保存助手
          </button>
        </div>
      </section>
    </div>
  )
}

function AddAssistantDialog({
  globalProviderId,
  providers,
  onClose,
  onSave,
  onSuggest
}: {
  globalProviderId: string
  providers: ApiProvider[]
  onClose: () => void
  onSave: (assistant: Assistant) => Promise<Assistant>
  onSuggest: (keyword: string) => Promise<AssistantSuggestion>
}) {
  const [keyword, setKeyword] = useState('')
  const [activePresetCategory, setActivePresetCategory] = useState(ASSISTANT_PRESET_CATEGORIES[0])
  const [providerId, setProviderId] = useState(globalProviderId)
  const selectedProvider = getProviderById(providerId, providers)
  const [modelId, setModelId] = useState(selectedProvider.defaultModel)
  const [assistantStatus, setAssistantStatus] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const modelOptions = getModelOptions(selectedProvider, modelId)
  const visiblePresets = keyword.trim()
    ? searchAssistantPresets(keyword, '')
    : searchAssistantPresets('', activePresetCategory)

  function selectProvider(nextProviderId: string) {
    const nextProvider = getProviderById(nextProviderId, providers)
    setProviderId(nextProvider.id)
    setModelId(nextProvider.defaultModel)
  }

  function createAssistantFromSuggestion(suggestion: AssistantSuggestion): Assistant {
    const now = Date.now()
    const selectedModel = modelId.trim() || selectedProvider.defaultModel

    return {
      id: createId('assistant'),
      name: suggestion.name,
      title: suggestion.title,
      tone: suggestion.tone,
      color: suggestion.color,
      icon: suggestion.icon,
      systemPrompt: suggestion.systemPrompt,
      starterPrompts: suggestion.starterPrompts,
      modelProviderId: selectedProvider.id,
      modelId: selectedModel,
      builtIn: false,
      createdAt: now,
      updatedAt: now
    }
  }

  async function addAssistant(suggestion: AssistantSuggestion, pendingMessage: string) {
    if (isWorking) return
    setIsWorking(true)
    setAssistantStatus(pendingMessage)

    try {
      const saved = await onSave(createAssistantFromSuggestion(suggestion))
      setAssistantStatus(`已添加「${saved.name}」`)
      onClose()
    } catch (error) {
      setAssistantStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  async function usePresetAssistant(preset: AssistantPreset) {
    await addAssistant(preset, `正在添加「${preset.name}」...`)
  }

  async function generateAssistant(nextKeyword = keyword) {
    const text = nextKeyword.trim()
    if (!text) {
      setAssistantStatus('请输入想创建的助手关键词')
      return
    }

    const matchedPreset = findAssistantPreset(text)
    if (matchedPreset) {
      setActivePresetCategory(matchedPreset.featured ? '精选' : matchedPreset.category)
      await usePresetAssistant(matchedPreset)
      return
    }

    if (isWorking) return
    setIsWorking(true)
    setAssistantStatus(`正在生成「${text}」助手...`)

    try {
      const suggestion = await onSuggest(text)
      const saved = await onSave(createAssistantFromSuggestion(suggestion))
      setAssistantStatus(`已添加「${saved.name}」`)
      onClose()
    } catch (error) {
      setAssistantStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div className="assistant-modal-backdrop">
      <section className="add-assistant-modal">
        <header>
          <div>
            <p>G-LLM</p>
            <h2>新增助手</h2>
          </div>
          <div className="header-actions">
            <button className="icon-button" onClick={onClose} title="关闭">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="assistant-simple-search">
          <input
            autoFocus
            placeholder="搜索：家庭医生、合同审查、小红书文案..."
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void generateAssistant()
              }
            }}
          />
          <button disabled={isWorking} onClick={() => void generateAssistant()} type="button">
            <Sparkles size={16} />
            AI 生成添加
          </button>
        </div>

        <div className="assistant-create-model">
          <label>
            <span>供应商</span>
            <select value={providerId} onChange={(event) => selectProvider(event.target.value)}>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>模型</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {getModelDisplayLabel(model)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!keyword.trim() && (
          <div className="preset-category-tabs">
            {ASSISTANT_PRESET_CATEGORIES.map((category) => (
              <button
                key={category}
                className={category === activePresetCategory ? 'active' : ''}
                onClick={() => setActivePresetCategory(category)}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
        )}

        <div className="assistant-preset-results">
          {visiblePresets.slice(0, 12).map((preset) => {
            const Icon = iconMap[preset.icon]

            return (
              <button
                key={preset.id}
                className={`assistant-preset-card ${preset.color}`}
                disabled={isWorking}
                onClick={() => void usePresetAssistant(preset)}
                type="button"
              >
                <span className={`assistant-icon ${preset.color}`}>
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{preset.title}</small>
                  <em>{preset.description}</em>
                </span>
                <b>添加</b>
              </button>
            )
          })}

          {visiblePresets.length === 0 && (
            <div className="preset-empty">没有命中预置，可以用 AI 生成一个新的助手。</div>
          )}
        </div>

        {assistantStatus && <div className="assistant-status">{assistantStatus}</div>}
      </section>
    </div>
  )
}

function ConversationModelDialog({
  conversation,
  assistant,
  globalProviderId,
  providers,
  onClose,
  onSaveAssistant,
  onSaveConversation
}: {
  conversation: Conversation
  assistant: Assistant
  globalProviderId: string
  providers: ApiProvider[]
  onClose: () => void
  onSaveAssistant: (assistant: Assistant) => Promise<Assistant>
  onSaveConversation: (conversation: Conversation) => void
}) {
  const globalProvider = getProviderById(globalProviderId, providers)
  const assistantProvider = getEffectiveProvider(assistant, globalProvider, providers)
  const initialProviderId =
    conversation.modelProviderId && providers.some((provider) => provider.id === conversation.modelProviderId)
      ? conversation.modelProviderId
      : assistantProvider.id
  const [providerId, setProviderId] = useState(initialProviderId)
  const selectedProvider = getProviderById(providerId, providers)
  const [modelId, setModelId] = useState(conversation.modelId || assistantProvider.defaultModel)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const modelOptions = getModelOptions(selectedProvider, modelId)

  function selectProvider(nextProviderId: string) {
    const nextProvider = getProviderById(nextProviderId, providers)
    setProviderId(nextProvider.id)
    setModelId(nextProvider.defaultModel)
  }

  function saveConversationModel(useAssistantDefault = false) {
    setSaving(true)
    setStatus(useAssistantDefault ? '正在使用助手默认模型...' : '正在保存本会话模型...')

    try {
      const nextProvider = useAssistantDefault ? assistantProvider : selectedProvider
      onSaveConversation({
        ...conversation,
        modelProviderId: nextProvider.id,
        modelId: useAssistantDefault ? assistantProvider.defaultModel : modelId,
        updatedAt: Date.now()
      })
      setStatus(
        useAssistantDefault
          ? `本会话已使用助手默认模型：${assistantProvider.defaultModel}`
          : `本会话已绑定 ${selectedProvider.name} · ${modelId}`
      )
      onClose()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function saveAsAssistantDefault() {
    setSaving(true)
    setStatus('正在保存为助手默认模型...')

    try {
      const saved = await onSaveAssistant({
        ...assistant,
        modelProviderId: selectedProvider.id,
        modelId
      })
      setStatus(`「${saved.name}」之后的新会话默认使用 ${selectedProvider.name} · ${modelId}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="assistant-modal-backdrop" onClick={onClose}>
      <section className="assistant-model-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>{assistant.name}</p>
            <h2>会话模型</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="assistant-model-note">
          当前设置只影响「{conversation.title}」这一次会话。助手默认模型：{assistantProvider.name} · {assistantProvider.defaultModel}
        </div>

        <label>
          <span>供应商</span>
          <select value={providerId} onChange={(event) => selectProvider(event.target.value)}>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>模型</span>
          <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {getModelDisplayLabel(model)}
              </option>
            ))}
          </select>
        </label>

        <div className="form-actions">
          <button className="secondary-action" disabled={saving} onClick={() => saveConversationModel(true)} type="button">
            使用助手默认
          </button>
          <button className="secondary-action" disabled={saving || !modelId.trim()} onClick={() => void saveAsAssistantDefault()} type="button">
            保存为助手默认
          </button>
          <button className="primary-action" disabled={saving || !modelId.trim()} onClick={() => saveConversationModel()} type="button">
            <Save size={17} />
            保存本会话
          </button>
        </div>

        {status && <div className="assistant-status">{status}</div>}
      </section>
    </div>
  )
}

function KnowledgeBaseDialog({
  assistant,
  memories,
  notes,
  onClose,
  onCopy,
  onDelete,
  onDeleteMemory,
  onReference,
  onSaveMemory
}: {
  assistant: Assistant
  memories: AssistantMemory[]
  notes: KnowledgeNote[]
  onClose: () => void
  onCopy: (content: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDeleteMemory: (id: string) => Promise<void>
  onReference: (note: KnowledgeNote) => void
  onSaveMemory: (memory: AssistantMemory) => Promise<AssistantMemory>
}) {
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'knowledge' | 'memory'>('knowledge')
  const [memoryDraft, setMemoryDraft] = useState('')
  const [status, setStatus] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleNotes = normalizedQuery
    ? notes.filter((note) => `${note.title}\n${note.content}`.toLowerCase().includes(normalizedQuery))
    : notes
  const visibleMemories = normalizedQuery
    ? memories.filter((memory) => memory.content.toLowerCase().includes(normalizedQuery))
    : memories

  async function addMemory(content: string, source?: Pick<AssistantMemory, 'sourceNoteId' | 'sourceMessageId'>) {
    const text = content.trim()
    if (!text) {
      setStatus('请输入记忆内容')
      return
    }

    const now = Date.now()
    try {
      const saved = await onSaveMemory({
        id: createId('memory'),
        assistantId: assistant.id,
        content: text,
        enabled: true,
        sourceNoteId: source?.sourceNoteId,
        sourceMessageId: source?.sourceMessageId,
        createdAt: now,
        updatedAt: now
      })
      setStatus(`已添加长期记忆：${saved.content.slice(0, 28)}`)
      setMemoryDraft('')
      setActiveTab('memory')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function toggleMemory(memory: AssistantMemory) {
    try {
      const saved = await onSaveMemory({ ...memory, enabled: !memory.enabled, updatedAt: Date.now() })
      setStatus(`${saved.enabled ? '已启用' : '已停用'}长期记忆`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeMemory(memory: AssistantMemory) {
    try {
      await onDeleteMemory(memory.id)
      setStatus('已删除长期记忆')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="assistant-modal-backdrop">
      <section className="knowledge-modal">
        <header>
          <div>
            <p>{assistant.name}</p>
            <h2>知识与记忆</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="knowledge-tabs">
          <button className={activeTab === 'knowledge' ? 'active' : ''} onClick={() => setActiveTab('knowledge')} type="button">
            当前助手知识库
          </button>
          <button className={activeTab === 'memory' ? 'active' : ''} onClick={() => setActiveTab('memory')} type="button">
            长期记忆
          </button>
        </div>

        <div className="knowledge-search">
          <input
            autoFocus
            placeholder={activeTab === 'knowledge' ? '搜索当前助手的知识' : '搜索当前助手的记忆'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {activeTab === 'knowledge' ? (
          <div className="knowledge-list">
            {visibleNotes.length === 0 && <div className="knowledge-empty">当前助手暂无知识</div>}
            {visibleNotes.map((note) => (
              <article className="knowledge-item" key={note.id}>
                <div>
                  <strong>{note.title}</strong>
                  <time>{new Date(note.createdAt).toLocaleString()}</time>
                </div>
                <p>{note.content}</p>
                <div className="knowledge-actions">
                  <button
                    type="button"
                    onClick={() => {
                      onReference(note)
                      setStatus(`已引用「${note.title}」，关闭窗口后可在输入区看到`)
                    }}
                  >
                    <AtSign size={15} />
                    引用
                  </button>
                  <button type="button" onClick={() => void addMemory(note.content, { sourceNoteId: note.id, sourceMessageId: note.messageId })}>
                    <Brain size={15} />
                    记住
                  </button>
                  <button type="button" onClick={() => void onCopy(note.content)}>
                    <Copy size={15} />
                    复制
                  </button>
                  <button type="button" onClick={() => void onDelete(note.id)}>
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <>
            <div className="memory-form">
              <textarea
                placeholder="添加当前助手需要长期记住的内容，例如：用户喜欢简洁中文回答；用户公司品牌叫 G-LLM；合同审查时优先关注付款、交付和违约责任。"
                value={memoryDraft}
                onChange={(event) => setMemoryDraft(event.target.value)}
                rows={3}
              />
              <button className="primary-action" type="button" onClick={() => void addMemory(memoryDraft)}>
                <Plus size={16} />
                添加记忆
              </button>
            </div>

            <div className="knowledge-list">
              {visibleMemories.length === 0 && <div className="knowledge-empty">当前助手暂无长期记忆</div>}
              {visibleMemories.map((memory) => (
                <article className={`memory-item ${memory.enabled ? 'enabled' : ''}`} key={memory.id}>
                  <div>
                    <strong>{memory.enabled ? '已启用' : '已停用'}</strong>
                    <time>{new Date(memory.updatedAt).toLocaleString()}</time>
                  </div>
                  <p>{memory.content}</p>
                  <div className="knowledge-actions">
                    <button type="button" onClick={() => void toggleMemory(memory)}>
                      <CircleCheck size={15} />
                      {memory.enabled ? '停用' : '启用'}
                    </button>
                    <button type="button" onClick={() => void onCopy(memory.content)}>
                      <Copy size={15} />
                      复制
                    </button>
                    <button type="button" onClick={() => void removeMemory(memory)}>
                      <Trash2 size={15} />
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {status && <div className="assistant-status">{status}</div>}
      </section>
    </div>
  )
}

const toolTypeLabels: Record<ToolConfigType, string> = {
  function: '函数工具',
  mcp: 'MCP 服务',
  plugin: '外部插件'
}

const toolEndpointLabels: Record<ToolConfigType, string> = {
  function: 'HTTP 接口地址',
  mcp: 'MCP 命令或服务地址',
  plugin: '插件标识或入口地址'
}

const toolEndpointPlaceholders: Record<ToolConfigType, string> = {
  function: '例如：https://api.example.com/tools/search',
  mcp: '例如：npx -y @modelcontextprotocol/server-filesystem C:/data',
  plugin: '例如：company.crm 或 https://plugin.example.com/manifest.json'
}

function ToolConfigDialog({
  tools,
  onClose,
  onDelete,
  onSave
}: {
  tools: ToolConfig[]
  onClose: () => void
  onDelete: (id: string) => Promise<void>
  onSave: (tool: ToolConfig) => Promise<ToolConfig>
}) {
  const [type, setType] = useState<ToolConfigType>('function')
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveNewTool() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setStatus('请输入工具名称')
      return
    }

    setSaving(true)
    setStatus('正在保存工具配置...')
    const now = Date.now()

    try {
      const saved = await onSave({
        id: createId('tool'),
        type,
        name: trimmedName,
        endpoint: endpoint.trim() || undefined,
        description: description.trim() || undefined,
        enabled: true,
        createdAt: now,
        updatedAt: now
      })
      setStatus(`已保存「${saved.name}」`)
      setName('')
      setEndpoint('')
      setDescription('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function toggleTool(tool: ToolConfig) {
    setSaving(true)
    try {
      const saved = await onSave({ ...tool, enabled: !tool.enabled, updatedAt: Date.now() })
      setStatus(`${saved.enabled ? '已启用' : '已停用'}「${saved.name}」`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function removeTool(tool: ToolConfig) {
    setSaving(true)
    try {
      await onDelete(tool.id)
      setStatus(`已删除「${tool.name}」`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="assistant-modal-backdrop">
      <section className="tool-center-modal">
        <header>
          <div>
            <p>无极界</p>
            <h2>扩展工具配置</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="tool-center-note">
          这里仅配置模型可调用的扩展工具：函数工具、MCP 服务和外部插件。附件、截图、知识库、联网搜索继续使用输入框上的独立按钮。
        </div>

        <div className="tool-config-form">
          <div className="tool-type-tabs">
            {(['function', 'mcp', 'plugin'] as ToolConfigType[]).map((item) => (
              <button key={item} className={item === type ? 'active' : ''} onClick={() => setType(item)} type="button">
                {toolTypeLabels[item]}
              </button>
            ))}
          </div>
          <label>
            <span>工具名称</span>
            <input
              placeholder={type === 'function' ? '例如：客户资料查询' : type === 'mcp' ? '例如：本地文件 MCP' : '例如：CRM 插件'}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>{toolEndpointLabels[type]}</span>
            <input
              placeholder={toolEndpointPlaceholders[type]}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <label>
            <span>用途说明</span>
            <textarea
              placeholder="写给自己和后续模型调用系统看的说明，例如：根据客户手机号查询 CRM 客户档案。"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </label>
          <button className="primary-action" disabled={saving} onClick={() => void saveNewTool()} type="button">
            <Plus size={16} />
            添加配置
          </button>
        </div>

        <div className="tool-card-list">
          {tools.length === 0 && <div className="tool-empty">暂无扩展工具配置</div>}
          {tools.map((tool) => (
            <article key={tool.id} className={`tool-card ${tool.enabled ? 'enabled' : ''}`}>
              <span className="tool-card-icon">
                {tool.type === 'mcp' ? <Plug size={18} /> : tool.type === 'plugin' ? <Wrench size={18} /> : <Code2 size={18} />}
              </span>
              <div>
                <strong>{tool.name}</strong>
                <p>{toolTypeLabels[tool.type]}{tool.endpoint ? ` · ${tool.endpoint}` : ''}</p>
                {tool.description && <em>{tool.description}</em>}
              </div>
              <div className="tool-card-actions">
                <button disabled={saving} type="button" onClick={() => void toggleTool(tool)}>
                  {tool.enabled ? '停用' : '启用'}
                </button>
                <button disabled={saving} type="button" onClick={() => void removeTool(tool)}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>

        {status && <div className="assistant-status">{status}</div>}
      </section>
    </div>
  )
}

function ParameterToggle({
  children,
  description,
  enabled,
  label,
  valueLabel,
  onEnabledChange
}: {
  children: ReactNode
  description: string
  enabled: boolean
  label: string
  valueLabel: string
  onEnabledChange: (enabled: boolean) => void
}) {
  return (
    <div className={`parameter-card ${enabled ? 'enabled' : ''}`}>
      <div className="parameter-card-head">
        <div>
          <strong>{label}</strong>
          <small>{description}</small>
        </div>
        <div className="parameter-actions">
          <span>{valueLabel}</span>
          <input checked={enabled} type="checkbox" onChange={(event) => onEnabledChange(event.target.checked)} />
        </div>
      </div>
      {enabled && <div className="parameter-control">{children}</div>}
    </div>
  )
}

function AddProviderDialog({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (provider: ApiProvider) => Promise<void>
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<ProviderTemplateId>('openai-compatible')
  const [draft, setDraft] = useState(() => createProviderFromTemplate('openai-compatible'))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const selectedTemplate = PROVIDER_TEMPLATES.find((template) => template.id === selectedTemplateId) ?? PROVIDER_TEMPLATES[0]
  const normalizedQuery = query.trim().toLowerCase()
  const modelOptions = getModelOptions(draft)

  function matchesTemplate(template: (typeof PROVIDER_TEMPLATES)[number]) {
    if (!normalizedQuery) return true
    return [template.name, template.description, template.id, providerTemplateCategoryLabels[template.category]]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  }

  function selectTemplate(templateId: ProviderTemplateId) {
    const provider = createProviderFromTemplate(templateId)
    setSelectedTemplateId(templateId)
    setDraft(provider)
    setStatus('')
  }

  async function addProvider() {
    setSaving(true)
    setStatus('正在添加供应商...')

    try {
      await onCreate(draft)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  const hasVisibleTemplates = PROVIDER_TEMPLATES.some(matchesTemplate)

  return (
    <div className="provider-add-backdrop">
      <section className="provider-add-modal">
        <header>
          <div>
            <p>G-LLM</p>
            <h2>新增供应商</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭" type="button">
            <X size={18} />
          </button>
        </header>

        <div className="provider-add-grid">
          <aside className="provider-template-panel">
            <label className="provider-template-search">
              <Search size={17} />
              <input
                autoFocus
                placeholder="搜索供应商，例如 OpenAI、Kimi、Ollama"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="provider-template-scroll">
              {!hasVisibleTemplates && <div className="provider-template-empty">没有匹配的供应商模板</div>}
              {providerTemplateCategoryOrder.map((category) => {
                const templates = PROVIDER_TEMPLATES.filter((template) => template.category === category && matchesTemplate(template))
                if (templates.length === 0) return null

                return (
                  <div className="template-group" key={category}>
                    <span>{providerTemplateCategoryLabels[category]}</span>
                    <div className="provider-template-list">
                      {templates.map((template) => (
                        <button
                          className={template.id === selectedTemplateId ? 'active' : ''}
                          key={template.id}
                          onClick={() => selectTemplate(template.id)}
                          type="button"
                        >
                          <Plug size={16} />
                          <span>
                            <strong>{template.name}</strong>
                            <small>{template.description}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          <div className="provider-add-form">
            <div className="provider-add-summary">
              <Plug size={18} />
              <span>
                <strong>{selectedTemplate.name}</strong>
                <small>{selectedTemplate.description}</small>
              </span>
            </div>

            <label>
              <span>供应商名称</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label>
              <span>API Base URL</span>
              <input
                value={draft.apiBaseUrl}
                onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })}
              />
            </label>

            <label>
              <span>API Key</span>
              <input
                placeholder={draft.requiresApiKey ? '请输入你的密钥，也可以添加后再填写' : '本地服务可留空'}
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </label>

            <label>
              <span>默认模型</span>
              <select value={draft.defaultModel} onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}>
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {getModelDisplayLabel(model)}
                  </option>
                ))}
              </select>
            </label>

            <label className="switch-row provider-add-switch">
              <span>需要 API Key</span>
              <input
                checked={draft.requiresApiKey}
                type="checkbox"
                onChange={(event) => setDraft({ ...draft, requiresApiKey: event.target.checked })}
              />
            </label>

            <div className="provider-add-note">添加后可在供应商设置中拉取模型、测试连接，并选择全局默认模型。</div>
            {status && <div className="provider-status">{status}</div>}

            <div className="form-actions">
              <button className="secondary-action" disabled={saving} onClick={onClose} type="button">
                取消
              </button>
              <button className="primary-action" disabled={saving} onClick={() => void addProvider()} type="button">
                <Plus size={17} />
                添加供应商
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function SettingsPanel({
  appVersion,
  dataLocation,
  settings,
  providers,
  onClose,
  onSaveSettings,
  onSaveProvider,
  onCheckProvider,
  onRefreshProviderModels,
  onDeleteProvider,
  onDataLocationChange
}: {
  appVersion: string
  dataLocation: DataLocationInfo | null
  settings: AppSettings
  providers: ApiProvider[]
  onClose: () => void
  onSaveSettings: (settings: AppSettings) => Promise<AppSettings>
  onSaveProvider: (provider: ApiProvider) => Promise<ApiProvider>
  onCheckProvider: (provider: ApiProvider) => Promise<ProviderCheckResult>
  onRefreshProviderModels: (provider: ApiProvider) => Promise<ApiProvider>
  onDeleteProvider: (id: string) => Promise<void>
  onDataLocationChange: (info: DataLocationInfo) => void
}) {
  const [settingsDraft, setSettingsDraft] = useState(settings)
  const [providerDraft, setProviderDraft] = useState(() => getProviderById(settings.activeProviderId, providers))
  const [providerStatus, setProviderStatus] = useState('')
  const [dataLocationInfo, setDataLocationInfo] = useState<DataLocationInfo | null>(dataLocation)
  const [dataLocationStatus, setDataLocationStatus] = useState('')
  const [newModelId, setNewModelId] = useState('')
  const [addProviderOpen, setAddProviderOpen] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isChangingDataLocation, setIsChangingDataLocation] = useState(false)
  const [isArchivingData, setIsArchivingData] = useState(false)
  const [dataArchiveNeedsRestart, setDataArchiveNeedsRestart] = useState(false)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('providers')
  const providerNeedsKey = providerDraft.requiresApiKey && !providerDraft.apiKey.trim()
  const modelOptions = getModelOptions(providerDraft)
  const providerSaved = providers.some((provider) => provider.id === providerDraft.id)
  const savedProvider = providers.find((provider) => provider.id === providerDraft.id) ?? null
  const visibleProviders = providerSaved ? providers : [providerDraft, ...providers]
  const defaultModelLabel = providerDraft.defaultModel || '未设置'
  const settingsChanged =
    JSON.stringify(getComparableSettings(settingsDraft)) !== JSON.stringify(getComparableSettings(settings))
  const providerChanged =
    !savedProvider ||
    JSON.stringify(getComparableProvider(providerDraft)) !== JSON.stringify(getComparableProvider(savedProvider))
  const configChanged = settingsChanged || providerChanged

  useEffect(() => {
    if (dataLocation) setDataLocationInfo(dataLocation)
  }, [dataLocation])

  useEffect(() => {
    if (!dataLocationInfo) {
      void window.gllm.getDataLocation().then((info) => {
        setDataLocationInfo(info)
        onDataLocationChange(info)
      })
    }
  }, [dataLocationInfo, onDataLocationChange])

  function selectProvider(provider: ApiProvider) {
    setProviderDraft(provider)
    setSettingsDraft({ ...settingsDraft, activeProviderId: provider.id })
    setProviderStatus('')
    setNewModelId('')
    setApiKeyVisible(false)
  }

  async function createProvider(provider: ApiProvider) {
    const savedProvider = await onSaveProvider(provider)
    setProviderDraft(savedProvider)
    setSettingsDraft({ ...settingsDraft, activeProviderId: savedProvider.id })
    setProviderStatus(`已添加「${savedProvider.name}」。可继续拉取模型、测试连接；点击保存后它会成为全局默认供应商。`)
    setNewModelId('')
    setApiKeyVisible(false)
    setAddProviderOpen(false)
  }

  function setDefaultModel(modelId: string) {
    setProviderDraft({ ...providerDraft, defaultModel: modelId })
    setProviderStatus(`已选择 ${modelId} 为全局默认模型，保存配置后生效`)
  }

  function addManualModel() {
    const id = newModelId.trim()
    if (!id) return

    const models = providerDraft.models.some((model) => model.id === id)
      ? providerDraft.models
      : [{ id, name: id, capabilities: inferModelCapabilities(id), type: inferModelType(id) }, ...providerDraft.models]

    setProviderDraft({
      ...providerDraft,
      models,
      defaultModel: providerDraft.defaultModel || id
    })
    setNewModelId('')
    setProviderStatus(`已添加模型 ${id}，保存配置后生效`)
  }

  function deleteModel(id: string) {
    const nextModels = providerDraft.models.filter((model) => model.id !== id)
    const nextDefaultModel =
      providerDraft.defaultModel === id ? nextModels[0]?.id || providerDraft.defaultModel : providerDraft.defaultModel

    setProviderDraft({
      ...providerDraft,
      models: nextModels,
      defaultModel: nextDefaultModel
    })
    setProviderStatus(`已移除模型 ${id}，保存配置后生效`)
  }

  async function saveAll() {
    if (!configChanged) return

    const savedProvider = await onSaveProvider(providerDraft)
    const savedSettings = await onSaveSettings({
      ...settingsDraft,
      activeProviderId: savedProvider.id,
      setupCompleted: true
    })
    setProviderDraft(savedProvider)
    setSettingsDraft(savedSettings)
    onClose()
  }

  async function deleteCurrentProvider() {
    if (providerDraft.id === DEFAULT_PROVIDER_ID) return
    const confirmed = window.confirm(`确定删除供应商「${providerDraft.name}」吗？删除后不会影响默认 G-LLM 供应商。`)
    if (!confirmed) return

    await onDeleteProvider(providerDraft.id)
    const nextProvider = getProviderById(DEFAULT_PROVIDER_ID, providers)
    setProviderDraft(nextProvider)
    setSettingsDraft({ ...settingsDraft, activeProviderId: DEFAULT_PROVIDER_ID })
    setProviderStatus('')
  }

  async function testConnection() {
    setIsChecking(true)
    setProviderStatus('正在测试连接...')
    const result = await onCheckProvider(providerDraft)
    setProviderStatus(result.message)
    if (result.ok && result.models?.length) {
      setProviderDraft({
        ...providerDraft,
        models: result.models,
        defaultModel: providerDraft.defaultModel || result.models[0].id,
        modelsUpdatedAt: Date.now()
      })
    }
    setIsChecking(false)
  }

  async function refreshModels() {
    setIsRefreshing(true)
    setProviderStatus('正在拉取模型列表...')
    try {
      const saved = await onRefreshProviderModels(providerDraft)
      setProviderDraft(saved)
      setSettingsDraft({ ...settingsDraft, activeProviderId: saved.id })
      setProviderStatus(`已拉取 ${saved.models.length} 个模型，保存配置后生效`)
    } catch (error) {
      setProviderStatus(error instanceof Error ? error.message : String(error))
    }
    setIsRefreshing(false)
  }

  async function openDataDirectory() {
    setDataLocationStatus('')
    try {
      await window.gllm.openDataDirectory()
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function chooseDataDirectory() {
    const confirmed = window.confirm(
      '将选择新的数据目录，并把当前聊天记录、助手、本地知识库、长期记忆和供应商配置复制过去。重启软件后生效，旧目录会保留为备份。是否继续？'
    )
    if (!confirmed) return

    setIsChangingDataLocation(true)
    setDataLocationStatus('正在选择数据目录...')
    try {
      const result = await window.gllm.chooseDataDirectory()
      if (!result) {
        setDataLocationStatus('已取消选择数据目录')
        return
      }

      setDataLocationInfo(result.info)
      onDataLocationChange(result.info)
      setDataLocationStatus(result.message)
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChangingDataLocation(false)
    }
  }

  async function resetDataDirectory() {
    const confirmed = window.confirm(
      '将把当前数据复制回默认目录，并恢复使用系统默认数据位置。重启软件后生效，当前目录不会自动删除。是否继续？'
    )
    if (!confirmed) return

    setIsChangingDataLocation(true)
    setDataLocationStatus('正在恢复默认数据目录...')
    try {
      const result = await window.gllm.resetDataDirectory()
      setDataLocationInfo(result.info)
      onDataLocationChange(result.info)
      setDataLocationStatus(result.message)
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChangingDataLocation(false)
    }
  }

  async function exportDataArchive() {
    setIsArchivingData(true)
    setDataLocationStatus('正在导出数据压缩包...')
    try {
      const result = await window.gllm.exportDataArchive()
      if (!result) {
        setDataLocationStatus('已取消导出数据')
        return
      }

      setDataLocationStatus(result.message)
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsArchivingData(false)
    }
  }

  async function importDataArchive() {
    const confirmed = window.confirm(
      '导入 ZIP 数据包会先备份当前数据，然后用压缩包中的数据替换当前数据。导入完成后需要重启软件才会生效。是否继续？'
    )
    if (!confirmed) return

    setIsArchivingData(true)
    setDataLocationStatus('正在导入数据压缩包...')
    try {
      const result = await window.gllm.importDataArchive()
      if (!result) {
        setDataLocationStatus('已取消导入数据')
        return
      }

      setDataArchiveNeedsRestart(Boolean(result.restartRequired))
      setDataLocationStatus(
        result.backupPath ? `${result.message} 当前数据已备份到：${result.backupPath}` : result.message
      )
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsArchivingData(false)
    }
  }

  async function relaunchApp() {
    await window.gllm.relaunchApp()
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <section className="settings-drawer provider-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="settings-tabs-row">
          <div className="settings-tabs" role="tablist" aria-label="设置分类">
            {settingsTabs.map((tab) => (
              <button
                aria-selected={activeSettingsTab === tab.id}
                className={activeSettingsTab === tab.id ? 'active' : ''}
                key={tab.id}
                onClick={() => setActiveSettingsTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          {activeSettingsTab === 'providers' && (
            <div className="provider-tab-summary">
              <div>
                <span>全局供应商</span>
                <strong>{providerDraft.name}</strong>
              </div>
              <div>
                <span>全局默认模型</span>
                <strong>{defaultModelLabel}</strong>
              </div>
            </div>
          )}
        </div>

        {activeSettingsTab === 'providers' && providerNeedsKey && (
          <div className="setup-warning">
            <KeyRound size={18} />
            <span>首次使用需要填写 API Key。默认网关已设置为 https://llm.gprophet.com/v1。</span>
          </div>
        )}

        {activeSettingsTab === 'providers' && (
          <div className="provider-manager">
            <div className="provider-sidebar">
              <div className="provider-list">
                <div className="provider-list-head">
                  <div className="provider-list-title">
                    <strong>供应商</strong>
                    <button onClick={() => setAddProviderOpen(true)} type="button">
                      <Plus size={15} />
                      新增
                    </button>
                  </div>
                  <small>选中的供应商会成为全局默认供应商。</small>
                </div>
                {visibleProviders.map((provider) => (
                  <button
                    key={provider.id}
                    className={`provider-item ${provider.id === providerDraft.id ? 'active' : ''}`}
                    onClick={() => selectProvider(provider)}
                  >
                    <Plug size={17} />
                    <span>
                      <strong>{provider.name}{provider.id === providerDraft.id && !providerSaved ? '（未保存）' : ''}</strong>
                      <small>{provider.apiBaseUrl}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="provider-form">
              <div className="form-row two">
                <label>
                  <span>供应商名称</span>
                  <input
                    value={providerDraft.name}
                    onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
                  />
                </label>
                <label>
                  <span>全局默认模型</span>
                  <select
                    value={providerDraft.defaultModel}
                    onChange={(event) => setDefaultModel(event.target.value)}
                  >
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {getModelDisplayLabel(model)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                <span>API Base URL</span>
                <input
                  value={providerDraft.apiBaseUrl}
                  onChange={(event) => setProviderDraft({ ...providerDraft, apiBaseUrl: event.target.value })}
                />
              </label>

              <label>
                <span>API Key</span>
                <div className="secret-input-row">
                  <input
                    placeholder={providerDraft.requiresApiKey ? '请输入你的密钥' : '本地服务可留空'}
                    type={apiKeyVisible ? 'text' : 'password'}
                    value={providerDraft.apiKey}
                    onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })}
                  />
                  <button
                    aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                    aria-pressed={apiKeyVisible}
                    className="secret-toggle-button"
                    onClick={() => setApiKeyVisible((visible) => !visible)}
                    title={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                    type="button"
                  >
                    {apiKeyVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>

              <label className="switch-row">
                <span>需要 API Key</span>
                <input
                  checked={providerDraft.requiresApiKey}
                  type="checkbox"
                  onChange={(event) => setProviderDraft({ ...providerDraft, requiresApiKey: event.target.checked })}
                />
              </label>

              <div className="provider-tools">
                <button disabled={isChecking} onClick={testConnection} type="button">
                  <CircleCheck size={16} />
                  测试连接
                </button>
                <button disabled={isRefreshing} onClick={refreshModels} type="button">
                  <RefreshCw size={16} />
                  拉取模型
                </button>
                {providerDraft.modelsUpdatedAt && <span>{new Date(providerDraft.modelsUpdatedAt).toLocaleString()}</span>}
              </div>

              {providerStatus && <div className="provider-status">{providerStatus}</div>}

              <section className="model-manager">
                <div className="default-model-card">
                  <span>当前全局默认模型</span>
                  <strong>{defaultModelLabel}</strong>
                  <small>下方点击任意模型标签即可切换默认模型，不必只靠下拉框查找。</small>
                </div>
                <div className="model-manager-head">
                  <div>
                    <strong>模型管理</strong>
                    <small>模型能力会从上游模型列表和模型 ID 自动识别，用于决定聊天、看图、生成图片等能力。</small>
                  </div>
                </div>
                <div className="model-chip-list">
                  {modelOptions.map((model) => (
                    <div
                      key={model.id}
                      className={model.id === providerDraft.defaultModel ? 'active' : ''}
                    >
                      <button className="model-name-button" onClick={() => setDefaultModel(model.id)} type="button">
                        <span>{model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id}</span>
                        {model.id === providerDraft.defaultModel && <small>默认</small>}
                      </button>
                      <span className="model-capability-list">
                        {normalizeModelCapabilities(model).map((capability) => (
                          <span key={capability} className={`model-capability-badge type-${capability}`}>
                            {MODEL_CAPABILITY_LABELS[capability]}
                          </span>
                        ))}
                      </span>
                      {model.id !== providerDraft.defaultModel && (
                        <button className="model-delete-button" onClick={() => deleteModel(model.id)} title="删除模型" type="button">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="model-add-fallback">
                  <div>
                    <strong>手动添加模型</strong>
                    <small>仅在上游接口无法拉取模型，或模型尚未出现在列表中时使用。</small>
                  </div>
                  <div className="model-add-row">
                    <input
                      placeholder="输入模型 ID，例如 gpt-5.5"
                      value={newModelId}
                      onChange={(event) => setNewModelId(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          addManualModel()
                        }
                      }}
                    />
                    <button onClick={addManualModel} type="button">
                      <Plus size={16} />
                      添加模型
                    </button>
                  </div>
                </div>
              </section>

              <section className="parameter-section">
                <ParameterToggle
                  description="关闭时使用模型默认采样设置"
                  enabled={settingsDraft.enableTemperature}
                  label="模型温度"
                  valueLabel={settingsDraft.enableTemperature ? settingsDraft.temperature.toFixed(1) : '默认值'}
                  onEnabledChange={(enabled) => setSettingsDraft({ ...settingsDraft, enableTemperature: enabled })}
                >
                  <div className="temperature-control">
                    <input
                      max={2}
                      min={0}
                      step={0.1}
                      type="range"
                      value={settingsDraft.temperature}
                      onChange={(event) =>
                        setSettingsDraft({ ...settingsDraft, temperature: Number(event.target.value) })
                      }
                    />
                    <div className="range-marks">
                      <span>精确</span>
                      <span>1</span>
                      <span>创意</span>
                    </div>
                  </div>
                </ParameterToggle>

                <ParameterToggle
                  description="限制单次回复最多生成的词元数"
                  enabled={settingsDraft.enableMaxTokens}
                  label="最大词元"
                  valueLabel={settingsDraft.enableMaxTokens ? settingsDraft.maxTokens.toLocaleString() : '默认值'}
                  onEnabledChange={(enabled) => setSettingsDraft({ ...settingsDraft, enableMaxTokens: enabled })}
                >
                  <input
                    min={1}
                    step={1}
                    type="number"
                    value={settingsDraft.maxTokens}
                    onChange={(event) => setSettingsDraft({ ...settingsDraft, maxTokens: Number(event.target.value) })}
                  />
                </ParameterToggle>
              </section>

              <div className="form-actions provider-form-actions">
                <div className="provider-footer-actions">
                  <button
                    className="danger-action"
                    disabled={providerDraft.id === DEFAULT_PROVIDER_ID}
                    onClick={deleteCurrentProvider}
                    type="button"
                  >
                    <Trash2 size={17} />
                    删除供应商
                  </button>
                  <button className="secondary-action" onClick={onClose} type="button">
                    <X size={17} />
                    不保存关闭
                  </button>
                  <button className="primary-action" disabled={!configChanged} onClick={saveAll} type="button">
                    <Save size={17} />
                    保存配置
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSettingsTab === 'storage' && (
          <div className="settings-tab-panel storage-settings-panel">
            <section className="data-location-section">
              <div className="data-location-head">
                <div>
                  <strong>数据存储位置</strong>
                  <small>聊天记录、助手、本地知识库、长期记忆和供应商配置都会保存在用户本地。</small>
                </div>
                <span>{dataLocationInfo?.mode === 'portable' ? '便携版' : '标准版'}</span>
              </div>

              {dataLocationInfo ? (
                <div className="data-location-card">
                  <Database size={19} />
                  <div className="data-location-content">
                    <div className="data-location-row">
                      <span>当前目录</span>
                      <strong title={dataLocationInfo.effectivePath}>{dataLocationInfo.effectivePath}</strong>
                    </div>
                    <div className="data-location-row">
                      <span>默认目录</span>
                      <strong title={dataLocationInfo.defaultPath}>{dataLocationInfo.defaultPath}</strong>
                    </div>
                    {dataLocationInfo.customPath && (
                      <div className="data-location-row">
                        <span>自定义</span>
                        <strong title={dataLocationInfo.customPath}>{dataLocationInfo.customPath}</strong>
                      </div>
                    )}
                    {dataLocationInfo.pendingRestart && (
                      <div className="data-location-pending">
                        <span>待生效</span>
                        <strong>数据目录已修改，重启软件后生效。</strong>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="data-location-card loading">正在读取数据目录...</div>
              )}

              <div className="data-location-actions">
                <button onClick={openDataDirectory} type="button">
                  <FolderOpen size={15} />
                  打开目录
                </button>
                <button disabled={isChangingDataLocation} onClick={chooseDataDirectory} type="button">
                  <Database size={15} />
                  更改目录
                </button>
                <button disabled={isChangingDataLocation || !dataLocationInfo?.isCustom} onClick={resetDataDirectory} type="button">
                  <RotateCcw size={15} />
                  恢复默认
                </button>
                <button disabled={!(dataLocationInfo?.pendingRestart || dataArchiveNeedsRestart)} onClick={relaunchApp} type="button">
                  <Power size={15} />
                  重启生效
                </button>
              </div>
              {dataLocationStatus && <p>{dataLocationStatus}</p>}
            </section>

            <section className="data-archive-section">
              <div className="data-location-head">
                <div>
                  <strong>数据导入导出</strong>
                  <small>将当前本地数据导出为 ZIP 压缩包，或从 ZIP 压缩包恢复数据。导入前会自动备份当前数据。</small>
                </div>
                <span>ZIP</span>
              </div>
              <div className="data-archive-actions">
                <button disabled={isArchivingData} onClick={exportDataArchive} type="button">
                  <Download size={16} />
                  导出数据
                </button>
                <button disabled={isArchivingData} onClick={importDataArchive} type="button">
                  <Upload size={16} />
                  导入数据
                </button>
              </div>
            </section>

            <div className="form-actions settings-panel-actions">
              <button className="secondary-action" onClick={onClose} type="button">
                <X size={17} />
                不保存关闭
              </button>
              <button className="primary-action" disabled={!configChanged} onClick={saveAll} type="button">
                <Save size={17} />
                保存配置
              </button>
            </div>
          </div>
        )}

        {activeSettingsTab === 'about' && (
          <div className="settings-tab-panel about-settings-panel">
            <section className="about-system-section">
              <div className="about-system-card">
                <img alt="G-LLM" src={logo} />
                <div>
                  <strong>无极界 G-LLM</strong>
                  <span>本地优先的 AI 助手客户端</span>
                </div>
              </div>
              <p>
                无极界 G-LLM 面向企业和个人用户，提供多助手、多会话、模型供应商、本地知识库和长期记忆能力。用户数据默认保存在本机，可按需切换数据目录，便于备份、迁移和私有化使用。
              </p>
              <div className="about-system-meta">
                <span>版本</span>
                <strong>V{appVersion}</strong>
              </div>
            </section>

            <section className="privacy-section">
              <label className="switch-row telemetry-switch">
                <span>
                  <strong>匿名使用统计</strong>
                  <small>默认开启，仅用于统计装机量、活跃度、版本分布和基础功能使用趋势，不上传聊天内容、API Key、附件或本地知识库。</small>
                </span>
                <input
                  checked={settingsDraft.telemetryEnabled}
                  type="checkbox"
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, telemetryEnabled: event.target.checked })}
                />
              </label>
              <p>关闭后，客户端不会继续发送匿名使用统计。已关闭状态会保存在本地设置中。</p>
            </section>

            <div className="form-actions settings-panel-actions">
              <button className="secondary-action" onClick={onClose} type="button">
                <X size={17} />
                不保存关闭
              </button>
              <button className="primary-action" disabled={!configChanged} onClick={saveAll} type="button">
                <Save size={17} />
                保存配置
              </button>
            </div>
          </div>
        )}
      </section>
      {addProviderOpen && (
        <div onClick={(event) => event.stopPropagation()}>
          <AddProviderDialog
            onClose={() => setAddProviderOpen(false)}
            onCreate={(provider) => createProvider(provider)}
          />
        </div>
      )}
    </div>
  )
}
