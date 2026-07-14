/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import {
  BarChart3,
  Brain,
  BookOpen,
  Briefcase,
  CircleCheck,
  Code2,
  Copy,
  Crown,
  Database,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  GraduationCap,
  ImagePlus,
  KeyRound,
  Languages,
  MessageSquarePlus,
  Moon,
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
  Sun,
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
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import logo from './assets/gllm-logo.png'
import { ChatErrorRetry } from './ChatErrorRetry'
import { getChatErrorPresentation } from './chatErrors'
import {
  getMessageSelectionSnapshot,
  writePlainTextToClipboard,
  writeRichTextToClipboard,
  type MessageSelectionSnapshot
} from './clipboard'
import {
  MAIN_COMPOSER_DRAFT_KEY,
  persistComposerDraft,
  readComposerDraft,
  resizeComposerTextarea
} from './composerInput'
import { getMessageSendShortcutLabel, shouldSendMessageFromKeyboard } from './keyboard'
import { MarkdownMessage } from './MarkdownMessage'
import { LocalTaskPanel } from './LocalTaskPanel'
import { WorkspaceActivityLog, WorkspaceBar } from './WorkspaceBar'
import { getModelDisplayLabel, getModelOptions, ModelPickerMenu } from './ModelPicker'
import { applyDocumentTheme } from './theme'
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
  getProviderById,
  isOfficialGllmApiProvider
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
  AppStateSnapshot,
  AppUpdateInfo,
  Assistant,
  AssistantIcon,
  AssistantMemory,
  AttachmentKind,
  AssistantSuggestion,
  ChatChunk,
  ChatMessage,
  ClipboardAttachmentInput,
  Conversation,
  ConversationSearchResponse,
  ConversationSearchResult,
  DataLocationInfo,
  KnowledgeReference,
  KnowledgeNote,
  LegalDocument,
  LocalTaskPlan,
  LocalTaskProgress,
  LocalTaskResult,
  MessageRetryAttempt,
  PreparedAttachment,
  Project,
  ProviderCheckResult,
  ProviderTemplateCategory,
  ProviderTemplateId,
  ToolConfig,
  ToolConfigType,
  ThemeEntitlementResult,
  WebSearchActivity,
  ConversationWorkspace,
  WorkspaceToolActivity
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
const defaultSpaceId = 'project_default'
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
  html: string
}

interface ImageAttachmentContextMenu {
  x: number
  y: number
  attachment: PreparedAttachment
}

type SettingsTab = 'providers' | 'personalization' | 'storage' | 'about'

interface SpaceFormPayload {
  name: string
  description: string
  logoDataUrl?: string
  workspacePath?: string
}

interface WorkspaceArtifactContextMenu {
  x: number
  y: number
  rootPath: string
  relativePath: string
}

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'providers', label: '模型供应商设置' },
  { id: 'personalization', label: '个性设置' },
  { id: 'storage', label: '数据存储设置' },
  { id: 'about', label: '关于本系统' }
]

function ModalBackdrop({
  className = 'assistant-modal-backdrop',
  closeOnBackdropClick = true,
  children,
  onClose
}: {
  className?: string
  closeOnBackdropClick?: boolean
  children: ReactNode
  onClose: () => void
}) {
  const backdropMouseDownRef = useRef(false)

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    backdropMouseDownRef.current = closeOnBackdropClick && event.target === event.currentTarget
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (backdropMouseDownRef.current && event.target === event.currentTarget) {
      onClose()
    }
    backdropMouseDownRef.current = false
  }

  return (
    <div className={className} onClick={handleClick} onMouseDown={handleMouseDown}>
      {children}
    </div>
  )
}

function stopModalClick(event: ReactMouseEvent) {
  event.stopPropagation()
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

function sanitizeLocalToken(value: unknown): number | null {
  const token = Number(value)
  return Number.isFinite(token) && token >= 0 ? Math.round(token) : null
}

function formatTokenUnit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 10_000 ? 0 : 1))}K`
  return `${value}`
}

function getSpaceName(project: Project | null): string {
  if (!project) return '无极界'
  if (project.id === defaultSpaceId && (!project.name || project.name === '默认项目')) return '无极界'
  return project.name || '未命名空间'
}

function getSpaceDescription(project: Project | null): string {
  if (!project) return '默认空间'
  if (project.id === defaultSpaceId) return project.description || '默认空间'
  return project.description || '独立空间'
}

function SpaceLogo({ className = '', project }: { className?: string; project: Project | null }) {
  const classes = ['space-logo', className, project?.logoDataUrl ? 'custom' : ''].filter(Boolean).join(' ')

  if (!project || project.id === defaultSpaceId) {
    return <img className={classes} src={logo} alt="" />
  }

  if (project.logoDataUrl) {
    return <img className={classes} src={project.logoDataUrl} alt="" />
  }

  return (
    <span className={classes} aria-hidden="true">
      {getSpaceName(project).slice(0, 1).toLocaleUpperCase()}
    </span>
  )
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
      resolve(canvas.toDataURL('image/webp', 0.92))
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

function createConversation(assistant: Assistant, provider: ApiProvider, projectId?: string): Conversation {
  const now = Date.now()
  return {
    id: createId('conv'),
    projectId,
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

function formatWorkspaceError(value: string): string {
  const normalized = value
    .replace(/^Error invoking remote method 'workspace-agent:run':\s*Error:\s*/i, '')
    .trim()
  const status = normalized.match(/(?:请求失败：|HTTP\s*)(429|500|502|503|504|524)\b/i)?.[1]
  if (/<!doctype\s+html|<html[\s>]/i.test(normalized)) {
    if (status === '429') return '模型服务当前请求较多（429），自动重试后仍未恢复。'
    if (status === '502') return '模型网关暂时无法连接上游服务（502），自动重试后仍未恢复。'
    if (status === '503') return '模型服务暂时不可用（503），自动重试后仍未恢复。'
    if (status === '504') return '模型服务响应超时（504），自动重试后仍未恢复。'
    if (status === '524') return '模型服务响应超时（524），自动重试后仍未恢复。'
    return '模型服务返回了异常网页响应，请稍后重试。'
  }
  return normalized || '工作区任务发生未知错误'
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
    const presentation = getChatErrorPresentation(chunk.error)
    messages.push({
      ...createMessage('assistant', presentation.userMessage),
      error: presentation.technicalDetail,
      retryAt: presentation.automaticallyRetryable ? Date.now() + 60_000 : undefined
    })
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

function getComparableSettings(settings: AppSettings) {
  return {
    activeProviderId: settings.activeProviderId,
    theme: settings.theme,
    temperature: Number(settings.temperature),
    enableTemperature: settings.enableTemperature,
    maxTokens: Number(settings.maxTokens),
    enableMaxTokens: settings.enableMaxTokens,
    messageSendShortcut: settings.messageSendShortcut,
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
    imageGenerationsPath: provider.imageGenerationsPath ?? '',
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
  const isWindows = window.gllm.platform === 'win32'
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [goldThemeEntitled, setGoldThemeEntitled] = useState(false)
  const [goldThemeEntitlementChecked, setGoldThemeEntitlementChecked] = useState(false)
  const [providers, setProviders] = useState<ApiProvider[]>([DEFAULT_PROVIDER])
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState('')
  const [assistants, setAssistants] = useState<Assistant[]>(DEFAULT_ASSISTANTS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [notes, setNotes] = useState<KnowledgeNote[]>([])
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [tools, setTools] = useState<ToolConfig[]>([])
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [appBuildCode, setAppBuildCode] = useState('')
  const [dataLocation, setDataLocation] = useState<DataLocationInfo | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeAssistantId, setActiveAssistantId] = useState(DEFAULT_ASSISTANTS[0].id)
  const [draft, setDraft] = useState(() => readComposerDraft(MAIN_COMPOSER_DRAFT_KEY))
  const [isStreaming, setIsStreaming] = useState(false)
  const [isPickingAttachment, setIsPickingAttachment] = useState(false)
  const [localTaskPlan, setLocalTaskPlan] = useState<LocalTaskPlan | null>(null)
  const [localTaskProgress, setLocalTaskProgress] = useState<LocalTaskProgress | null>(null)
  const [localTaskResult, setLocalTaskResult] = useState<LocalTaskResult | null>(null)
  const [localTaskRunning, setLocalTaskRunning] = useState(false)
  const [draftWorkspace, setDraftWorkspace] = useState<ConversationWorkspace | undefined>()
  const [workspaceActivities, setWorkspaceActivities] = useState<WorkspaceToolActivity[]>([])
  const workspaceActivitiesRef = useRef<WorkspaceToolActivity[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantCenterOpen, setAssistantCenterOpen] = useState(false)
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false)
  const [conversationModelOpen, setConversationModelOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [toolCenterOpen, setToolCenterOpen] = useState(false)
  const [spaceCenterOpen, setSpaceCenterOpen] = useState(false)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [assistantSearchQuery, setAssistantSearchQuery] = useState('')
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false)
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [conversationSearchResponse, setConversationSearchResponse] = useState<ConversationSearchResponse | null>(null)
  const [conversationSearchLoading, setConversationSearchLoading] = useState(false)
  const [conversationSearchError, setConversationSearchError] = useState('')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [toolNotice, setToolNotice] = useState<{
    message: string
    emphasis: boolean
    requiresConfirmation: boolean
    conversationId?: string
  } | null>(null)
  const [selectionMenu, setSelectionMenu] = useState<SelectionContextMenu | null>(null)
  const [imageAttachmentMenu, setImageAttachmentMenu] = useState<ImageAttachmentContextMenu | null>(null)
  const [workspaceArtifactMenu, setWorkspaceArtifactMenu] = useState<WorkspaceArtifactContextMenu | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PreparedAttachment[]>([])
  const [pendingQuoteRefs, setPendingQuoteRefs] = useState<KnowledgeReference[]>([])
  const [pendingKnowledgeRefs, setPendingKnowledgeRefs] = useState<KnowledgeReference[]>([])
  const [translatingMessageIds, setTranslatingMessageIds] = useState<string[]>([])
  const [autoFollowMessages, setAutoFollowMessages] = useState(true)
  const [isNearMessageBottom, setIsNearMessageBottom] = useState(true)
  const [composerHeight, setComposerHeight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const autoFollowMessagesRef = useRef(true)
  const toolNoticeTimerRef = useRef<number | null>(null)
  const streamingConversationDraftsRef = useRef<Record<string, Conversation>>({})
  const conversationSearchRequestRef = useRef(0)

  const activeSpace = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null,
    [activeProjectId, projects]
  )
  const activeSpaceName = getSpaceName(activeSpace)
  const activeSpaceSubtitle = activeSpace?.id === defaultSpaceId ? 'G-LLM · 默认空间' : `G-LLM · ${activeSpaceName}`
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
  const currentWorkspace = activeConversation ? activeConversation.workspace : draftWorkspace
  const conversationProvider = useMemo(
    () => (activeConversation ? getEffectiveProvider(activeConversation, assistantDefaultProvider, providers) : assistantDefaultProvider),
    [activeConversation, assistantDefaultProvider, providers]
  )
  const needsApiKey = Boolean(settings && conversationProvider.requiresApiKey && !conversationProvider.apiKey.trim())
  const activeConversationTranslationSignature = activeConversation?.messages
    .map((message) => message.translation?.length ?? 0)
    .join('|')
  const activeConversationTokenUsage = getConversationTokenUsage(activeConversation)
  const topbarConversationTitle = activeConversation?.title || '新会话'
  const activeConversationTokenSummary = `当前会话总词元数：${formatTokenUnit(activeConversationTokenUsage.total)}  ↑${formatTokenUnit(activeConversationTokenUsage.input)}  ↓${formatTokenUnit(activeConversationTokenUsage.output)}`
  const activeConversationTokenDetail = `当前会话总词元数：${formatTokenUnit(activeConversationTokenUsage.total)}，发送 ${formatTokenUnit(activeConversationTokenUsage.input)}，接收 ${formatTokenUnit(activeConversationTokenUsage.output)}`
  const projectMemorySummary = activeConversation?.projectMemory
    ? [
        activeConversation.projectMemory.overview,
        `需求 ${activeConversation.projectMemory.requirements.length} · 决策 ${activeConversation.projectMemory.decisions.length} · 规则 ${activeConversation.projectMemory.businessRules.length} · 待办 ${activeConversation.projectMemory.openItems.length} · 风险 ${activeConversation.projectMemory.risks.length}`
      ].filter(Boolean).join('\n')
    : ''
  const showScrollToLatest = Boolean(activeConversation?.messages.length && !isNearMessageBottom)
  const waitingForAssistantResponse = Boolean(isStreaming && activeConversation?.messages.at(-1)?.role === 'user')
  const modelCapabilities = useMemo(() => getModelCapabilities(conversationProvider), [conversationProvider])
  const messageSendShortcut = settings?.messageSendShortcut ?? 'enter'
  const messageSendShortcutLabel = getMessageSendShortcutLabel(messageSendShortcut)
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

  function applyAppState(state: AppStateSnapshot, options: { selectFirstConversation?: boolean } = {}) {
    const nextProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
    const nextAssistants = state.assistants.length > 0 ? state.assistants : DEFAULT_ASSISTANTS
    const firstConversation = state.conversations[0] ?? null

    setAppVersion(state.appVersion || '1.0.0')
    setAppBuildCode(state.appBuildCode || '')
    setDataLocation(state.dataLocation)
    setActiveProjectId(state.activeProjectId)
    setProjects(state.projects)
    setSettings(state.settings)
    setProviders(nextProviders)
    setAssistants(nextAssistants)
    setConversations(state.conversations)
    setNotes(state.notes)
    setMemories(state.memories ?? [])
    setTools(state.tools ?? [])

    if (options.selectFirstConversation) {
      setActiveConversationId(firstConversation?.id ?? null)
      setActiveAssistantId(firstConversation?.assistantId ?? nextAssistants[0]?.id ?? DEFAULT_ASSISTANTS[0].id)
    }
  }

  async function checkThemeEntitlement(provider: ApiProvider): Promise<ThemeEntitlementResult> {
    const result = await window.gllm.checkThemeEntitlement(provider)
    if (result.ok) {
      setGoldThemeEntitled(result.eligible)
      setGoldThemeEntitlementChecked(true)
    }
    return result
  }

  async function verifyGoldThemeEntitlement(providerList: ApiProvider[]): Promise<void> {
    const candidates = providerList.filter(
      (provider) => isOfficialGllmApiProvider(provider) && Boolean(provider.apiKey.trim())
    )
    if (candidates.length === 0) {
      setGoldThemeEntitled(false)
      setGoldThemeEntitlementChecked(true)
      return
    }

    for (const provider of candidates) {
      const result = await window.gllm.checkThemeEntitlement(provider)
      if (result.ok && result.eligible) {
        setGoldThemeEntitled(true)
        setGoldThemeEntitlementChecked(true)
        return
      }
    }
    setGoldThemeEntitled(false)
    setGoldThemeEntitlementChecked(true)
  }

  useEffect(() => {
    if (!isWindows) return
    document.title = `${activeSpaceName} - ${activeAssistant.name} - ${activeAssistant.title} | G-LLM`
  }, [activeAssistant.name, activeAssistant.title, activeSpaceName, isWindows])

  useEffect(() => {
    void window.gllm.getState().then((state) => {
      const nextProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
      const provider = getProviderById(state.settings.activeProviderId, nextProviders)
      applyAppState(state, { selectFirstConversation: true })
      void verifyGoldThemeEntitlement(nextProviders)
      if (!state.settings.setupCompleted) {
        setAgreementOpen(true)
      } else if (provider.requiresApiKey && !provider.apiKey.trim()) {
        setSettingsOpen(true)
      }
    })
  }, [])

  useEffect(() => {
    if (settings) applyDocumentTheme(settings.theme, goldThemeEntitled || !goldThemeEntitlementChecked)
  }, [goldThemeEntitled, goldThemeEntitlementChecked, settings?.theme])

  useEffect(() => {
    void window.gllm.setActiveAssistantId(activeAssistantId)
  }, [activeAssistantId])

  useEffect(() => {
    persistComposerDraft(MAIN_COMPOSER_DRAFT_KEY, draft)
  }, [draft])

  useEffect(() => {
    resizeComposerTextarea(composerTextareaRef.current)
  }, [draft])

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
            if (chunk.done) void window.gllm.saveConversation(updatedConversation)
            return nextWithDraft
          }
        }

        if (updatedConversation) {
          streamingConversationDraftsRef.current[chunk.conversationId] = updatedConversation
          if (chunk.done) void window.gllm.saveConversation(updatedConversation)
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
        if (chunk.warning) showToolNotice(chunk.warning, 9000)
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
    if (!selectionMenu && !imageAttachmentMenu && !workspaceArtifactMenu) return

    const closeMenu = () => {
      setSelectionMenu(null)
      setImageAttachmentMenu(null)
      setWorkspaceArtifactMenu(null)
    }
    const closeMenuOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.selection-context-menu')) return
      closeMenu()
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', closeMenuOnPointerDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeMenuOnPointerDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [selectionMenu, imageAttachmentMenu, workspaceArtifactMenu])

  useEffect(() => window.gllm.onLocalTaskProgress(setLocalTaskProgress), [])

  useEffect(
    () => window.gllm.onWorkspaceAgentProgress((progress) => {
      setWorkspaceActivities((current) => {
        const existing = current.findIndex((activity) => activity.id === progress.activity.id)
        const next = existing < 0
          ? [...current, progress.activity]
          : current.map((activity, index) => index === existing ? progress.activity : activity)
        workspaceActivitiesRef.current = next
        return next
      })
    }),
    []
  )

  useEffect(() => {
    setMessageAutoFollow(true)
    setIsNearMessageBottom(true)
    window.requestAnimationFrame(() => scrollToLatest('auto', { resumeAutoFollow: true }))
  }, [activeConversationId])

  useEffect(() => {
    if (!isStreaming || workspaceActivities.length === 0) return
    window.requestAnimationFrame(() => scrollToLatest('smooth', { requireAutoFollow: true }))
  }, [workspaceActivities])

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
    window.requestAnimationFrame(() => scrollToLatest(isStreaming ? 'auto' : 'smooth', { requireAutoFollow: true, resumeAutoFollow: false }))
  }, [
    autoFollowMessages,
    isStreaming,
    activeConversation?.messages.length,
    activeConversation?.messages.at(-1)?.content,
    activeConversationTranslationSignature
  ])

  function showToolNotice(
    message: string,
    duration = 2600,
    options: { emphasis?: boolean; requiresConfirmation?: boolean; conversationId?: string } = {}
  ) {
    setToolNotice({
      message,
      emphasis: Boolean(options.emphasis),
      requiresConfirmation: Boolean(options.requiresConfirmation),
      conversationId: options.conversationId
    })
    if (toolNoticeTimerRef.current) window.clearTimeout(toolNoticeTimerRef.current)
    toolNoticeTimerRef.current = null
    if (!options.requiresConfirmation) {
      toolNoticeTimerRef.current = window.setTimeout(() => setToolNotice(null), duration)
    }
  }

  function dismissToolNotice() {
    if (toolNoticeTimerRef.current) window.clearTimeout(toolNoticeTimerRef.current)
    toolNoticeTimerRef.current = null
    setToolNotice(null)
  }

  function openToolNoticeConversation(conversationId: string) {
    const conversation = conversations.find((item) => item.id === conversationId)
    if (!conversation) {
      showToolNotice('对应会话已不存在', 3200, { emphasis: true })
      return
    }
    setDraftWorkspace(undefined)
    setActiveAssistantId(conversation.assistantId)
    setActiveConversationId(conversation.id)
    dismissToolNotice()
    window.requestAnimationFrame(() => scrollToLatest('auto', { resumeAutoFollow: true }))
  }

  function clearSpaceTransientState() {
    setDraft('')
    setAssistantSearchQuery('')
    setPendingAttachments([])
    setPendingQuoteRefs([])
    setPendingKnowledgeRefs([])
    setSelectionMenu(null)
    setImageAttachmentMenu(null)
    setTranslatingMessageIds([])
    setIsStreaming(false)
  }

  async function switchSpace(spaceId: string) {
    if (!spaceId || spaceId === activeProjectId) return

    const state = await window.gllm.setActiveProjectId(spaceId)
    applyAppState(state, { selectFirstConversation: true })
    clearSpaceTransientState()
    showToolNotice(`已切换到空间「${getSpaceName(state.projects.find((project) => project.id === state.activeProjectId) ?? null)}」`)
  }

  async function runConversationSearch(query = conversationSearchQuery) {
    const normalizedQuery = query.trim().slice(0, 300)
    const requestId = conversationSearchRequestRef.current + 1
    conversationSearchRequestRef.current = requestId
    setConversationSearchQuery(normalizedQuery)
    setConversationSearchOpen(true)
    setConversationSearchLoading(true)
    setConversationSearchError('')
    setConversationSearchResponse(null)

    try {
      const response = await window.gllm.searchConversations({
        query: normalizedQuery,
        provider: activeProvider,
        limit: 20
      })
      if (conversationSearchRequestRef.current !== requestId) return
      setConversationSearchResponse(response)
    } catch (error) {
      if (conversationSearchRequestRef.current !== requestId) return
      setConversationSearchError(error instanceof Error ? error.message : '历史会话搜索失败')
    } finally {
      if (conversationSearchRequestRef.current === requestId) setConversationSearchLoading(false)
    }
  }

  async function openConversationSearchResult(result: ConversationSearchResult) {
    try {
      if (result.projectId !== activeProjectId) {
        const state = await window.gllm.setActiveProjectId(result.projectId)
        applyAppState(state)
        clearSpaceTransientState()
      }
      setActiveAssistantId(result.assistantId)
      setActiveConversationId(result.conversationId)
      setAssistantSearchQuery('')
      setConversationSearchOpen(false)
      showToolNotice(`已打开「${result.title}」`)
    } catch (error) {
      setConversationSearchError(error instanceof Error ? error.message : '无法打开该会话')
    }
  }

  async function createSpace(payload: SpaceFormPayload) {
    const name = payload.name.trim()
    if (!name) return

    const now = Date.now()
    const { saved } = await window.gllm.saveProject({
      id: createId('space'),
      name,
      description: payload.description.trim() || undefined,
      logoDataUrl: payload.logoDataUrl,
      workspacePath: payload.workspacePath,
      workspacePermission: payload.workspacePath ? 'read-write' : undefined,
      createdAt: now,
      updatedAt: now
    })
    const nextState = await window.gllm.setActiveProjectId(saved.id)
    applyAppState(nextState, { selectFirstConversation: true })
    clearSpaceTransientState()
    showToolNotice(`已创建并切换到空间「${saved.name}」`)
  }

  async function renameSpace(spaceId: string, payload: SpaceFormPayload) {
    const space = projects.find((project) => project.id === spaceId)
    const name = payload.name.trim()
    if (!space || !name) return

    const { saved, state } = await window.gllm.saveProject({
      ...space,
      name,
      description: payload.description.trim() || undefined,
      logoDataUrl: space.id === defaultSpaceId ? undefined : payload.logoDataUrl,
      workspacePath: payload.workspacePath,
      workspacePermission: payload.workspacePath ? 'read-write' : undefined,
      updatedAt: Date.now()
    })
    applyAppState(state)
    showToolNotice(`空间已重命名为「${saved.name}」`)
  }

  function getDistanceToMessageBottom() {
    const list = listRef.current
    if (!list) return 0
    return list.scrollHeight - list.scrollTop - list.clientHeight
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
    const list = listRef.current
    if (event.deltaY < 0 && list && list.scrollTop > 0) pauseMessageAutoFollow()
  }

  function updateMessageScrollState() {
    setSelectionMenu(null)
    const distanceToBottom = getDistanceToMessageBottom()
    const isAtBottom = distanceToBottom <= 4
    const isNearBottom = distanceToBottom <= bottomFollowThreshold

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

    const list = listRef.current
    if (!list) return
    list.scrollTo({ top: list.scrollHeight, behavior })
    if (options.resumeAutoFollow ?? true) {
      setIsNearMessageBottom(true)
      setMessageAutoFollow(true)
    }
  }

  async function pickComposerAttachments(kind: AttachmentKind) {
    if (isPickingAttachment) return

    setIsPickingAttachment(true)
    try {
      const picked = await window.gllm.pickAttachments(kind)
      if (picked.length === 0) return

      setPendingAttachments((current) => [...current, ...picked].slice(0, 8))
      const unreadableCount = picked.filter((attachment) => attachment.kind === 'file' && !attachment.text).length
      const imageWithoutDataCount = picked.filter((attachment) => attachment.kind === 'image' && !attachment.dataUrl).length

      if (imageWithoutDataCount) {
        showToolNotice('已添加附件；部分图片过大或读取失败，无法直接识别')
      } else if (unreadableCount) {
        showToolNotice('已添加附件；部分文件暂不能解析正文')
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

  function openImageAttachmentMenu(event: ReactMouseEvent, attachment: PreparedAttachment) {
    if (attachment.kind !== 'image' || !attachment.dataUrl) return

    event.preventDefault()
    event.stopPropagation()
    setSelectionMenu(null)
    setImageAttachmentMenu({
      x: Math.min(event.clientX, window.innerWidth - 156),
      y: Math.min(event.clientY, window.innerHeight - 94),
      attachment
    })
  }

  async function copyImageAttachmentToClipboard() {
    if (!imageAttachmentMenu?.attachment.dataUrl) return

    try {
      await window.gllm.copyImageToClipboard(imageAttachmentMenu.attachment.dataUrl)
      showToolNotice('已复制图片到剪贴板')
    } catch {
      showToolNotice('复制图片失败，请重新截图或保存后复制')
    } finally {
      setImageAttachmentMenu(null)
    }
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
      const imageWithoutDataCount = pasted.filter((attachment) => attachment.kind === 'image' && !attachment.dataUrl).length

      if (imageWithoutDataCount > 0) {
        showToolNotice('已从剪贴板添加附件；部分图片过大或读取失败，无法直接识别')
      } else if (unreadableCount > 0) {
        showToolNotice('已从剪贴板添加附件；部分文件暂不能解析正文')
      } else if (imageCount > 0) {
        showToolNotice(`已从剪贴板添加 ${pasted.length} 个附件，图片会作为视觉输入发送`)
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
      showToolNotice(screenshot.dataUrl ? '已添加截图，发送时会作为视觉输入' : '已添加截图，但图片数据读取失败，无法直接识别')
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '截图失败')
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function openAssistant(assistant: Assistant) {
    setDraftWorkspace(undefined)
    setActiveAssistantId(assistant.id)
    setPendingQuoteRefs([])
    setPendingKnowledgeRefs([])
    const existing = conversations.find((conversation) => conversation.assistantId === assistant.id)
    setActiveConversationId(existing?.id ?? null)
  }

  function startNewChat() {
    setDraftWorkspace(undefined)
    const conversation = createConversation(activeAssistant, assistantDefaultProvider, activeProjectId)
    setConversations((current) => [conversation, ...current])
    setActiveConversationId(conversation.id)
    void window.gllm.saveConversation(conversation)
  }

  function openConversationModelSettings() {
    if (activeConversation) {
      setConversationModelOpen(true)
      return
    }

    const conversation = createConversation(activeAssistant, assistantDefaultProvider, activeProjectId)
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
    const nextConversation = withConversationTokens({ ...conversation, projectId: conversation.projectId ?? activeProjectId })
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    void window.gllm.saveConversation(nextConversation)
  }

  function changeActiveConversationModel(modelId: string) {
    const nextModelId = modelId.trim()
    if (!nextModelId) return
    if (activeConversation?.modelProviderId === conversationProvider.id && activeConversation.modelId === nextModelId) return

    const conversation = activeConversation ?? createConversation(activeAssistant, conversationProvider, activeProjectId)
    const nextConversation: Conversation = {
      ...conversation,
      modelProviderId: conversationProvider.id,
      modelId: nextModelId,
      updatedAt: Date.now()
    }

    saveConversationUpdate(nextConversation)
    if (!activeConversation) setActiveConversationId(nextConversation.id)
    showToolNotice(`本会话已切换到 ${conversationProvider.name} · ${nextModelId}`)
  }

  function getSelectedTextForMessage(messageId: string): string {
    return getMessageSelectionForMessage(messageId)?.text ?? ''
  }

  function getMessageSelectionForMessage(messageId: string): MessageSelectionSnapshot | null {
    return getMessageSelectionSnapshot(document.querySelector(`[data-message-id="${messageId}"]`))
  }

  async function copyMessage(content: string) {
    try {
      await writePlainTextToClipboard(content)
      showToolNotice('已复制 Markdown 到剪贴板')
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
    const selection = getMessageSelectionForMessage(message.id)
    if (!selection) {
      setSelectionMenu(null)
      return
    }

    event.preventDefault()
    setSelectionMenu({
      x: Math.min(event.clientX, window.innerWidth - 156),
      y: Math.min(event.clientY, window.innerHeight - 94),
      text: selection.text,
      html: selection.html
    })
  }

  async function copySelectionMenuText() {
    if (!selectionMenu) return

    try {
      await writeRichTextToClipboard(selectionMenu)
      showToolNotice('已复制选中富文本')
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
      projectId: activeProjectId,
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
    const saved = await window.gllm.saveMemory({ ...memory, projectId: memory.projectId ?? activeProjectId })
    setMemories((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    return saved
  }

  async function deleteAssistantMemory(id: string) {
    await window.gllm.deleteMemory(id)
    setMemories((current) => current.filter((memory) => memory.id !== id))
  }

  async function saveToolConfig(tool: ToolConfig) {
    const saved = await window.gllm.saveTool({ ...tool, projectId: tool.projectId ?? activeProjectId })
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

  async function executeWorkspaceConversation(
    nextConversation: Conversation,
    workspace: ConversationWorkspace,
    provider: ApiProvider,
    retryAttempts: MessageRetryAttempt[] = []
  ) {
    if (!settings) return
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    try {
      const result = await window.gllm.runWorkspaceAgent({
        conversationId: nextConversation.id,
        workspace,
      provider,
      messages: nextConversation.messages,
      settings,
      projectMemory: nextConversation.projectMemory
      })
      const assistantMessage: ChatMessage = {
        ...createMessage('assistant', result.content),
        workspaceActivities: result.activities,
        workspaceChangedFiles: result.changedFiles,
        workspaceArtifactRoot: workspace.rootPath,
        retryAttempts: retryAttempts.length > 0 ? retryAttempts : undefined
      }
      const completedConversation = withConversationTokens({
        ...nextConversation,
        workspace,
        messages: [...nextConversation.messages, assistantMessage],
        updatedAt: Date.now()
      })
      setConversations((current) => [completedConversation, ...current.filter((item) => item.id !== completedConversation.id)])
      void window.gllm.saveConversation(completedConversation)
      if (result.changedFiles.length > 0) showToolNotice(`已修改 ${result.changedFiles.length} 个工作区文件`)
    } catch (error) {
      const message = formatWorkspaceError(error instanceof Error ? error.message : '未知错误')
      const currentAttempt: MessageRetryAttempt = {
        attemptedAt: Date.now(),
        error: message,
        activities: workspaceActivitiesRef.current
      }
      const failedConversation = withConversationTokens({
        ...nextConversation,
        workspace,
        messages: [...nextConversation.messages, {
          ...createMessage('assistant', `工作区任务失败：${message}`),
          error: message,
          workspaceActivities: workspaceActivitiesRef.current,
          workspaceArtifactRoot: workspace.rootPath,
          retryAttempts: [...retryAttempts, currentAttempt]
        }],
        updatedAt: Date.now()
      })
      setConversations((current) => [failedConversation, ...current.filter((item) => item.id !== failedConversation.id)])
      void window.gllm.saveConversation(failedConversation)
    } finally {
      setIsStreaming(false)
    }
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

    const message = activeConversation.messages[messageIndex]
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
    if (activeConversation.workspace) {
      const retryAttempts: MessageRetryAttempt[] = message.error
        ? message.retryAttempts?.length
          ? message.retryAttempts
          : [{ attemptedAt: message.createdAt, error: formatWorkspaceError(message.error), activities: message.workspaceActivities }]
        : []
      void executeWorkspaceConversation(nextConversation, activeConversation.workspace, conversationProvider, retryAttempts)
      return
    }
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: activeAssistant,
      assistantMemories: enabledAssistantMemories,
      projectMemory: nextConversation.projectMemory,
      provider: conversationProvider,
      messages: nextConversation.messages,
      settings,
      webSearchEnabled
    })
  }

  function shouldPrepareLocalTask(text: string): boolean {
    return pendingAttachments.some((attachment) => attachment.localExecutable) &&
      /压缩|文件太大|附件太大|超出.{0,6}(限制|大小)|上传.{0,6}限制|不超过\s*\d+|最多\s*\d+|2097152|帮我弄一下/.test(text)
  }

  function openWorkspaceArtifactMenu(event: ReactMouseEvent, rootPath: string, relativePath: string) {
    event.preventDefault()
    event.stopPropagation()
    setSelectionMenu(null)
    setImageAttachmentMenu(null)
    setWorkspaceArtifactMenu({
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 70),
      rootPath,
      relativePath
    })
  }

  async function openWorkspaceArtifact(rootPath: string, relativePath: string) {
    try {
      await window.gllm.revealWorkspaceFile(rootPath, relativePath)
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '无法定位该文件')
    }
  }

  async function revealWorkspaceArtifact() {
    if (!workspaceArtifactMenu) return
    try {
      await openWorkspaceArtifact(workspaceArtifactMenu.rootPath, workspaceArtifactMenu.relativePath)
    } finally {
      setWorkspaceArtifactMenu(null)
    }
  }

  async function preparePendingLocalTask(text: string) {
    try {
      const plan = await window.gllm.prepareLocalFileTask(text, pendingAttachments.map((attachment) => attachment.id))
      setLocalTaskPlan(plan)
      setLocalTaskProgress(null)
      setLocalTaskResult(null)
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '无法建立本地文件任务')
    }
  }

  async function executePendingLocalTask() {
    if (!localTaskPlan || localTaskRunning) return
    setLocalTaskRunning(true)
    setLocalTaskResult(null)
    try {
      const result = await window.gllm.executeLocalFileTask(localTaskPlan.id)
      setLocalTaskResult(result)
      const baseConversation =
        activeConversation?.assistantId === activeAssistant.id
          ? activeConversation
          : createConversation(activeAssistant, assistantDefaultProvider, activeProjectId)
      const userMessage = createMessage('user', localTaskPlan.request, pendingAttachments)
      const successCount = result.artifacts.filter((artifact) => artifact.success).length
      const resultLines = result.artifacts.map((artifact) => {
        const sizeChange = artifact.outputSize === undefined
          ? formatAttachmentSize(artifact.originalSize)
          : `${formatAttachmentSize(artifact.originalSize)} → ${formatAttachmentSize(artifact.outputSize)}`
        return `${artifact.success ? '✓' : '⚠'} ${artifact.outputName ?? artifact.sourceName}：${sizeChange}；${artifact.message}`
      })
      const assistantMessage = createMessage(
        'assistant',
        `本地文件任务${result.status === 'completed' ? '已完成' : result.status === 'partial' ? '部分完成' : '未完成'}：${successCount}/${result.artifacts.length} 个文件已验证达标。\n\n${resultLines.join('\n')}\n\n原始文件未被修改。`
      )
      const nextConversation = withConversationTokens({
        ...baseConversation,
        assistantId: activeAssistant.id,
        title: baseConversation.messages.length === 0 ? localTaskPlan.request.slice(0, 28) : baseConversation.title,
        messages: [...baseConversation.messages, userMessage, assistantMessage],
        updatedAt: Date.now()
      })
      setActiveConversationId(nextConversation.id)
      setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
      void window.gllm.saveConversation(nextConversation)
      setPendingAttachments([])
      setDraft('')
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '本地文件任务执行失败')
    } finally {
      setLocalTaskRunning(false)
    }
  }

  function closeLocalTask() {
    if (localTaskRunning) return
    setLocalTaskPlan(null)
    setLocalTaskProgress(null)
    setLocalTaskResult(null)
  }

  async function bindConversationWorkspace() {
    try {
      const rootPath = await window.gllm.chooseWorkspaceDirectory()
      if (!rootPath) return
      const normalizeWorkspacePath = (path: string) => {
        const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/')
        return window.gllm.platform === 'linux' ? normalized : normalized.toLocaleLowerCase()
      }
      const conflictingConversation = conversations.find((conversation) =>
        conversation.id !== activeConversation?.id &&
        conversation.workspace?.permission === 'read-write' &&
        normalizeWorkspacePath(conversation.workspace.rootPath) === normalizeWorkspacePath(rootPath)
      )
      if (conflictingConversation) {
        showToolNotice(
          `该目录已授权给会话「${conflictingConversation.title}」，请先在原会话解除授权`,
          0,
          { emphasis: true, requiresConfirmation: true, conversationId: conflictingConversation.id }
        )
        return
      }
      const displayName = rootPath.split(/[\\/]/).filter(Boolean).at(-1) || '工作区'
      const workspace: ConversationWorkspace = {
        rootPath,
        displayName,
        permission: 'read-write',
        grantedAt: Date.now(),
        lastVerifiedAt: Date.now()
      }
      setWorkspaceActivities([])
      workspaceActivitiesRef.current = []
      if (!activeConversation) {
        setDraftWorkspace(workspace)
        return
      }
      const nextConversation = { ...activeConversation, workspace, updatedAt: Date.now() }
      const saved = await window.gllm.saveConversation(nextConversation)
      setConversations((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '工作目录授权失败')
    }
  }

  async function unbindConversationWorkspace() {
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    if (!activeConversation) {
      setDraftWorkspace(undefined)
      return
    }
    const nextConversation = { ...activeConversation, workspace: undefined, updatedAt: Date.now() }
    try {
      const saved = await window.gllm.saveConversation(nextConversation)
      setConversations((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : '解除工作目录授权失败')
    }
  }

  async function sendMessage(content = draft) {
    if (!settings || isStreaming) return
    const candidateText = content.trim()
    if (shouldPrepareLocalTask(candidateText)) {
      await preparePendingLocalTask(candidateText)
      return
    }
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
        : createConversation(activeAssistant, assistantDefaultProvider, activeProjectId)
    const attachments = pendingAttachments
    const knowledgeRefs = contextRefs
    const userMessage = createMessage('user', messageText, attachments, knowledgeRefs)
    const nextConversation: Conversation = withConversationTokens({
      ...baseConversation,
      workspace: currentWorkspace,
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
    if (currentWorkspace) {
      if (!activeConversation) setDraftWorkspace(undefined)
      await executeWorkspaceConversation(
        nextConversation,
        currentWorkspace,
        activeConversation?.assistantId === activeAssistant.id ? conversationProvider : assistantDefaultProvider
      )
      return
    }
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: activeAssistant,
      assistantMemories: enabledAssistantMemories,
      projectMemory: nextConversation.projectMemory,
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
    const nextProviders = [saved, ...providers.filter((provider) => provider.id !== saved.id)]
    setProviders(nextProviders)
    void verifyGoldThemeEntitlement(nextProviders)
    return saved
  }

  async function checkProvider(next: ApiProvider): Promise<ProviderCheckResult> {
    return window.gllm.checkProvider(next)
  }

  async function refreshProviderModels(next: ApiProvider) {
    const saved = await window.gllm.refreshProviderModels(next)
    const nextProviders = [saved, ...providers.filter((provider) => provider.id !== saved.id)]
    setProviders(nextProviders)
    void verifyGoldThemeEntitlement(nextProviders)
    return saved
  }

  async function deleteProvider(id: string) {
    await window.gllm.deleteProvider(id)
    const nextProviders = providers.filter((provider) => provider.id !== id)
    setProviders(nextProviders)
    void verifyGoldThemeEntitlement(nextProviders)
    setSettings((current) => (current?.activeProviderId === id ? { ...current, activeProviderId: DEFAULT_PROVIDER_ID } : current))
  }

  async function saveAssistant(next: Assistant) {
    const saved = await window.gllm.saveAssistant({ ...next, projectId: next.projectId ?? activeProjectId })
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

  async function suggestAssistant(keyword: string, provider: ApiProvider): Promise<AssistantSuggestion> {
    if (!settings) throw new Error('设置尚未加载')
    return window.gllm.suggestAssistant({
      keyword,
      provider,
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
            <button className="brand-space-button" onClick={() => setSpaceCenterOpen(true)} title="打开空间中心" type="button">
              <SpaceLogo project={activeSpace} />
              <span>
                <strong>{activeSpaceName}</strong>
                <small>{activeSpaceSubtitle}</small>
              </span>
            </button>
            <button className="icon-button compact" onClick={() => setRailCollapsed(true)} title="折叠助手栏" type="button">
              <PanelLeftClose size={16} />
            </button>
          </div>

          <label className="assistant-search" title="搜索助手或历史会话">
            <Search size={15} />
            <input
              value={assistantSearchQuery}
              placeholder="搜索助手或历史会话"
              onChange={(event) => setAssistantSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void runConversationSearch(assistantSearchQuery)
              }}
            />
            {assistantSearchQuery && (
              <button onClick={() => setAssistantSearchQuery('')} title="清空搜索" type="button">
                <X size={14} />
              </button>
            )}
            <button
              className="assistant-smart-search-button"
              onClick={() => void runConversationSearch(assistantSearchQuery)}
              title={assistantSearchQuery.trim() ? '智能搜索历史会话' : '查看最近会话'}
              type="button"
            >
              <Sparkles size={14} />
            </button>
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
              <div className="topbar-heading">
                <h1 title={activeAssistant.name}>{activeAssistant.name}</h1>
                <span className="topbar-assistant-description" title={activeAssistant.title}>
                  {activeAssistant.title}
                </span>
              </div>
              <div className="topbar-session-row">
                <span className="topbar-conversation-title" title={topbarConversationTitle}>
                  {topbarConversationTitle}
                </span>
                <span className="topbar-token-summary" title={activeConversationTokenDetail}>
                  {activeConversationTokenSummary}
                </span>
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            {activeConversation?.projectMemory && (
              <button
                className="icon-button compact project-memory-button"
                onClick={() => showToolNotice(`项目长期记忆：${projectMemorySummary.slice(0, 700)}`, 9000)}
                title={`项目长期记忆\n${projectMemorySummary}`}
                type="button"
              >
                <Brain size={16} />
              </button>
            )}
            <button className="icon-button compact" onClick={() => setAssistantSettingsOpen(true)} title="助手设置" type="button">
              <Pencil size={16} />
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
          <div className="messages" ref={listRef} onScroll={updateMessageScrollState} onWheel={handleMessageWheel}>
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
              {activeConversation.messages.map((message, messageIndex) => {
                const isTranslating = translatingMessageIds.includes(message.id)
                const messageTokens = estimateMessageTokenUsage(message)

                return (
                  <article
                    key={message.id}
                    className={`message ${message.role} ${message.error ? 'message-error' : ''}`}
                    data-message-id={message.id}
                    onContextMenu={(event) => openSelectionContextMenu(event, message)}
                  >
                    <div className="message-stack">
                      <div className="message-bubble">
                        {message.webSearch && <WebSearchActivityCard activity={message.webSearch} />}
                        {((message.workspaceActivities?.length ?? 0) > 0 || (message.workspaceChangedFiles?.length ?? 0) > 0) && (
                          <WorkspaceActivityLog
                            activities={message.workspaceActivities ?? []}
                            changedFiles={message.workspaceChangedFiles}
                            artifactRoot={message.workspaceArtifactRoot}
                            onArtifactOpen={(rootPath, relativePath) => void openWorkspaceArtifact(rootPath, relativePath)}
                            onArtifactContextMenu={openWorkspaceArtifactMenu}
                          />
                        )}
                        {(message.content.trim() || !message.webSearch) && (
                          <div className="message-content markdown-body">
                            <MarkdownMessage content={message.content} />
                          </div>
                        )}
                        {message.error && (
                          <ChatErrorRetry
                            error={message.error}
                            retryAt={messageIndex === activeConversation.messages.length - 1 && !message.workspaceArtifactRoot ? message.retryAt : undefined}
                            disabled={isStreaming}
                            onRetry={() => regenerateMessage(message.id)}
                          />
                        )}
                        {(message.retryAttempts?.length ?? 0) > 0 && (
                          <details className="message-retry-history">
                            <summary>执行尝试记录（{message.retryAttempts!.length}）</summary>
                            <ol>
                              {message.retryAttempts!.map((attempt, index) => (
                                <li key={`${attempt.attemptedAt}_${index}`}>
                                  <time>{new Date(attempt.attemptedAt).toLocaleString()}</time>
                                  <span>{formatWorkspaceError(attempt.error)}</span>
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="message-attachments">
                            {message.attachments.map((attachment) => (
                              <span
                                key={attachment.id}
                                className={`attachment-chip ${attachment.kind === 'image' && attachment.dataUrl ? 'image-chip' : ''}`}
                                title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}
                                onContextMenu={(event) => openImageAttachmentMenu(event, attachment)}
                              >
                                {attachment.kind === 'image' && attachment.dataUrl ? (
                                  <img alt="" src={attachment.dataUrl} />
                                ) : attachment.kind === 'image' ? (
                                  <ImagePlus size={14} />
                                ) : (
                                  <Paperclip size={14} />
                                )}
                                <span>{attachment.name}</span>
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
                          <button title="复制整条原始 Markdown" type="button" onClick={() => void copyMessage(message.content)}>
                            <Copy size={16} />
                          </button>
                          {message.role === 'assistant' && !message.error && (
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
                      {currentWorkspace ? (
                        <WorkspaceActivityLog activities={workspaceActivities} running />
                      ) : (
                        <div className="pending-response-content">
                          <span className="typing-dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span>正在等待 {conversationProvider.defaultModel} 响应...</span>
                        </div>
                      )}
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
          {imageAttachmentMenu && (
            <div
              className="selection-context-menu"
              style={{ left: imageAttachmentMenu.x, top: imageAttachmentMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button type="button" onClick={() => void copyImageAttachmentToClipboard()}>
                <Copy size={15} />
                复制图片
              </button>
            </div>
          )}
          {workspaceArtifactMenu && (
            <div
              className="selection-context-menu workspace-artifact-context-menu"
              style={{ left: workspaceArtifactMenu.x, top: workspaceArtifactMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button type="button" onClick={() => void revealWorkspaceArtifact()}>
                <FolderOpen size={15} />
                {isMac ? '在 Finder 中显示' : '在文件资源管理器中显示'}
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
                  className={currentWorkspace ? 'active' : ''}
                  title="会话授权工作文件夹"
                  type="button"
                  onClick={() => void bindConversationWorkspace()}
                >
                  <FolderOpen size={16} />
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
              <ModelPickerMenu
                className="composer-model-picker"
                provider={conversationProvider}
                value={conversationProvider.defaultModel}
                variant="dropdown"
                placement="top"
                onChange={changeActiveConversationModel}
              />
            </div>
            {currentWorkspace && (
              <WorkspaceBar
                workspace={currentWorkspace}
                onUnbind={() => void unbindConversationWorkspace()}
              />
            )}
            {toolNotice && (
              <div
                className={`composer-notice ${toolNotice.emphasis ? 'emphasis' : ''}`}
                role={toolNotice.emphasis ? 'alert' : 'status'}
              >
                <span>{toolNotice.message}</span>
                {(toolNotice.conversationId || toolNotice.requiresConfirmation) && (
                  <div className="composer-notice-actions">
                    {toolNotice.conversationId && (
                      <button type="button" onClick={() => openToolNoticeConversation(toolNotice.conversationId!)}>
                        前往会话
                      </button>
                    )}
                    {toolNotice.requiresConfirmation && (
                      <button className="secondary" type="button" onClick={dismissToolNotice}>确认</button>
                    )}
                  </div>
                )}
              </div>
            )}
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
                    className={`attachment-chip ${attachment.kind === 'image' && attachment.dataUrl ? 'image-chip' : ''} ${attachment.kind === 'image' && !attachment.dataUrl ? 'warning' : ''} ${attachment.localExecutable ? 'local-executable' : ''}`}
                    title={`${attachment.name} · ${formatAttachmentSize(attachment.size)} · ${attachment.localExecutable ? '可执行本地处理' : getAttachmentSupportLabel(attachment, modelCapabilities)}`}
                    onContextMenu={(event) => openImageAttachmentMenu(event, attachment)}
                  >
                    {attachment.kind === 'image' && attachment.dataUrl ? (
                      <img alt="" src={attachment.dataUrl} />
                    ) : attachment.kind === 'image' ? (
                      <ImagePlus size={14} />
                    ) : (
                      <Paperclip size={14} />
                    )}
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
                ref={composerTextareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => void handleComposerPaste(event)}
                onKeyDown={(event) => {
                  if (shouldSendMessageFromKeyboard(event, messageSendShortcut)) {
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
                title={`发送（${messageSendShortcutLabel}）`}
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
                <span className="history-item-title">
                  <span>{conversation.title}</span>
                  {conversation.workspace && (
                    <FolderOpen
                      className="history-workspace-badge"
                      size={13}
                      aria-label="已授权工作文件夹"
                    />
                  )}
                </span>
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
      {spaceCenterOpen && (
        <SpaceCenterDialog
          activeSpaceId={activeProjectId}
          spaces={projects}
          onClose={() => setSpaceCenterOpen(false)}
          onCreate={createSpace}
          onRename={renameSpace}
          onSwitch={switchSpace}
        />
      )}
      {conversationSearchOpen && (
        <ConversationSearchDialog
          error={conversationSearchError}
          loading={conversationSearchLoading}
          query={conversationSearchQuery}
          response={conversationSearchResponse}
          onClose={() => setConversationSearchOpen(false)}
          onQueryChange={setConversationSearchQuery}
          onSearch={runConversationSearch}
          onSelect={openConversationSearchResult}
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
          appBuildCode={appBuildCode}
          dataLocation={dataLocation}
          settings={settings}
          providers={providers}
          goldThemeEntitled={goldThemeEntitled}
          goldThemeEntitlementChecked={goldThemeEntitlementChecked}
          onClose={() => setSettingsOpen(false)}
          onSaveSettings={saveSettings}
          onSaveProvider={saveProvider}
          onCheckProvider={checkProvider}
          onCheckThemeEntitlement={checkThemeEntitlement}
          onRefreshProviderModels={refreshProviderModels}
          onDeleteProvider={deleteProvider}
          onDataLocationChange={setDataLocation}
        />
      )}
      {localTaskPlan && (
        <LocalTaskPanel
          plan={localTaskPlan}
          progress={localTaskProgress}
          result={localTaskResult}
          running={localTaskRunning}
          onApprove={() => void executePendingLocalTask()}
          onCancel={() => void window.gllm.cancelLocalFileTask(localTaskPlan.id)}
          onClose={closeLocalTask}
          onOpenOutput={(planId) => void window.gllm.openLocalTaskOutput(planId)}
        />
      )}
    </div>
  )
}

function formatConversationSearchDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

function ConversationSearchDialog({
  error,
  loading,
  query,
  response,
  onClose,
  onQueryChange,
  onSearch,
  onSelect
}: {
  error: string
  loading: boolean
  query: string
  response: ConversationSearchResponse | null
  onClose: () => void
  onQueryChange: (query: string) => void
  onSearch: (query: string) => Promise<void>
  onSelect: (result: ConversationSearchResult) => Promise<void>
}) {
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onSearch(query)
  }

  const statusText = loading
    ? '正在理解并检索历史会话...'
    : response?.mode === 'semantic'
      ? `智能匹配 · 已检索 ${response.searchedCount} 个会话`
      : response?.mode === 'local'
        ? `本地匹配 · 已检索 ${response.searchedCount} 个会话`
        : response
          ? `最近会话 · 共 ${response.searchedCount} 个`
          : ''

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="conversation-search-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>跨空间检索</p>
            <h2>智能搜索历史会话</h2>
          </div>
          <button className="icon-button compact" onClick={onClose} title="关闭" type="button">
            <X size={16} />
          </button>
        </header>

        <form className="conversation-search-form" onSubmit={submitSearch}>
          <Search size={17} />
          <input
            autoFocus
            value={query}
            maxLength={300}
            placeholder="描述你记得的主题、问题、人物或结论"
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button className="conversation-search-clear" onClick={() => onQueryChange('')} title="清空" type="button">
              <X size={14} />
            </button>
          )}
          <button className="primary-button conversation-search-submit" disabled={loading} type="submit">
            <Sparkles size={15} />
            <span>智能搜索</span>
          </button>
        </form>

        <div className="conversation-search-status" aria-live="polite">
          <span>{error || statusText}</span>
        </div>

        <div className="conversation-search-results">
          {!loading && response?.results.length === 0 && (
            <div className="conversation-search-empty">
              <Search size={22} />
              <strong>没有找到相关会话</strong>
              <span>换一种描述方式，试试当时讨论的目标或结论。</span>
            </div>
          )}
          {response?.results.map((result) => (
            <button
              className="conversation-search-result"
              key={result.conversationId}
              onClick={() => void onSelect(result)}
              type="button"
            >
              <span className="conversation-search-result-heading">
                <strong>{result.title || '未命名会话'}</strong>
                <time>{formatConversationSearchDate(result.updatedAt)}</time>
              </span>
              <span className="conversation-search-result-meta">
                {result.projectName} · {result.assistantName}
              </span>
              <span className="conversation-search-result-snippet">{result.snippet}</span>
              {result.reason && <span className="conversation-search-result-reason">{result.reason}</span>}
            </button>
          ))}
        </div>
      </section>
    </ModalBackdrop>
  )
}

function SpaceCenterDialog({
  spaces,
  activeSpaceId,
  onClose,
  onCreate,
  onRename,
  onSwitch
}: {
  spaces: Project[]
  activeSpaceId: string
  onClose: () => void
  onCreate: (payload: SpaceFormPayload) => Promise<void>
  onRename: (spaceId: string, payload: SpaceFormPayload) => Promise<void>
  onSwitch: (spaceId: string) => Promise<void>
}) {
  const [creating, setCreating] = useState(spaces.length <= 1)
  const [newName, setNewName] = useState('工作空间')
  const [newDescription, setNewDescription] = useState('')
  const [newLogoDataUrl, setNewLogoDataUrl] = useState('')
  const [newWorkspacePath, setNewWorkspacePath] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLogoDataUrl, setEditLogoDataUrl] = useState('')
  const [editWorkspacePath, setEditWorkspacePath] = useState('')
  const [savingAction, setSavingAction] = useState<string | null>(null)
  const [error, setError] = useState('')
  const newLogoInputRef = useRef<HTMLInputElement>(null)
  const editLogoInputRef = useRef<HTMLInputElement>(null)
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null
  const hasMultipleSpaces = spaces.length > 1

  function startRename(space: Project) {
    setRenamingId(space.id)
    setEditName(getSpaceName(space))
    setEditDescription(space.description ?? '')
    setEditLogoDataUrl(space.logoDataUrl ?? '')
    setEditWorkspacePath(space.workspacePath ?? '')
    setError('')
  }

  async function chooseWorkspace(target: 'create' | 'edit') {
    try {
      const path = await window.gllm.chooseWorkspaceDirectory()
      if (!path) return
      if (target === 'create') setNewWorkspacePath(path)
      else setEditWorkspacePath(path)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '工作目录选择失败')
    }
  }

  async function chooseSpaceLogo(event: ChangeEvent<HTMLInputElement>, target: 'create' | 'edit') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件作为空间 Logo')
      return
    }

    if (file.size > 8 * 1024 * 1024) {
      setError('空间 Logo 图片不能超过 8 MB')
      return
    }

    try {
      const source = await readFileAsDataUrl(file)
      const cropped = await cropImageToSquareDataUrl(source, 1)
      if (target === 'create') {
        setNewLogoDataUrl(cropped)
      } else {
        setEditLogoDataUrl(cropped)
      }
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '空间 Logo 读取失败')
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) {
      setError('请输入空间名称')
      return
    }

    setSavingAction('create')
    setError('')
    try {
      await onCreate({ name, description: newDescription, logoDataUrl: newLogoDataUrl || undefined, workspacePath: newWorkspacePath || undefined })
      setCreating(false)
      setNewName('新空间')
      setNewDescription('')
      setNewLogoDataUrl('')
      setNewWorkspacePath('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '空间创建失败')
    } finally {
      setSavingAction(null)
    }
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renamingId) return

    const name = editName.trim()
    if (!name) {
      setError('请输入空间名称')
      return
    }

    setSavingAction(renamingId)
    setError('')
    try {
      await onRename(renamingId, { name, description: editDescription, logoDataUrl: editLogoDataUrl || undefined, workspacePath: editWorkspacePath || undefined })
      setRenamingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '空间保存失败')
    } finally {
      setSavingAction(null)
    }
  }

  async function handleSwitch(spaceId: string) {
    setSavingAction(`switch:${spaceId}`)
    setError('')
    try {
      await onSwitch(spaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '空间切换失败')
    } finally {
      setSavingAction(null)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="space-center-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>空间中心</p>
            <h2>{getSpaceName(activeSpace)}</h2>
          </div>
          <button className="icon-button compact" onClick={onClose} title="关闭" type="button">
            <X size={16} />
          </button>
        </header>

        <div className="space-center-body">
        <div className="space-current-card">
          <SpaceLogo className="large" project={activeSpace} />
          <div>
            <span>当前空间</span>
            <strong>{getSpaceName(activeSpace)}</strong>
            <p>{getSpaceDescription(activeSpace)}</p>
          </div>
          <em>{activeSpace?.id === defaultSpaceId ? '默认空间' : '独立空间'}</em>
        </div>

        <section className="space-guidance">
          <div>
            <h3>{hasMultipleSpaces ? '空间有什么用' : '为什么创建第二个空间'}</h3>
            <p>
              空间用于把不同场景的数据分开。切换空间后，你看到的助手、会话、知识库和记忆会随空间切换。
            </p>
          </div>
          <div className="space-insight-grid">
            <article>
              <Database size={17} />
              <strong>隔离内容</strong>
              <span>每个空间独立保存会话、助手配置、本地知识库和助手记忆。</span>
            </article>
            <article>
              <KeyRound size={17} />
              <strong>共享设置</strong>
              <span>模型供应商、API Key、应用偏好和版本更新仍然全局共享。</span>
            </article>
            <article>
              <FolderOpen size={17} />
              <strong>适用场景</strong>
              <span>适合区分工作、个人、客户资料、学习研究或不同团队任务。</span>
            </article>
          </div>
          {hasMultipleSpaces && (
            <div className="space-switch-note">
              <CircleCheck size={15} />
              <span>当前正在使用「{getSpaceName(activeSpace)}」。点击下方“切换”会进入对应空间，不会删除其他空间的数据。</span>
            </div>
          )}
        </section>

        {hasMultipleSpaces && (
          <section className="space-list-section">
            <div className="space-section-heading">
              <h3>所有空间</h3>
              <button className="secondary-action" onClick={() => setCreating((current) => !current)} type="button">
                <Plus size={15} />
                新建空间
              </button>
            </div>
            <div className="space-list">
              {spaces.map((space) => {
                const active = space.id === activeSpaceId
                const saving = savingAction === space.id || savingAction === `switch:${space.id}`

                return (
                  <article className={`space-row ${active ? 'active' : ''}`} key={space.id}>
                    {renamingId === space.id ? (
                      <form className="space-edit-form" onSubmit={handleRename}>
                        <div className="space-logo-editor">
                          <SpaceLogo className="editable" project={{ ...space, logoDataUrl: editLogoDataUrl || undefined }} />
                          <div>
                            <strong>{space.id === defaultSpaceId ? '默认空间 Logo' : '空间 Logo'}</strong>
                            <span>
                              {space.id === defaultSpaceId
                                ? '无极界默认空间使用固定 Logo，不支持修改。'
                                : '建议使用透明背景或简洁方形图片。'}
                            </span>
                            {space.id !== defaultSpaceId && (
                              <div className="space-logo-actions">
                                <input
                                  ref={editLogoInputRef}
                                  accept="image/*"
                                  hidden
                                  type="file"
                                  onChange={(event) => void chooseSpaceLogo(event, 'edit')}
                                />
                                <button className="secondary-action" onClick={() => editLogoInputRef.current?.click()} type="button">
                                  上传 Logo
                                </button>
                                <button
                                  className="secondary-action"
                                  disabled={!editLogoDataUrl}
                                  onClick={() => setEditLogoDataUrl('')}
                                  type="button"
                                >
                                  移除
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <label>
                          <span>空间名称</span>
                          <input value={editName} onChange={(event) => setEditName(event.target.value)} />
                        </label>
                        <label>
                          <span>空间说明</span>
                          <textarea
                            value={editDescription}
                            onChange={(event) => setEditDescription(event.target.value)}
                            placeholder="空间说明"
                            rows={2}
                          />
                        </label>
                        <div className="space-workspace-field">
                          <span>本地工作目录</span>
                          <strong title={editWorkspacePath}>{editWorkspacePath || '未绑定'}</strong>
                          <div>
                            <button className="secondary-action" onClick={() => void chooseWorkspace('edit')} type="button"><FolderOpen size={15} />选择目录</button>
                            <button className="secondary-action" disabled={!editWorkspacePath} onClick={() => setEditWorkspacePath('')} type="button">解除绑定</button>
                          </div>
                          <small>G-LLM 仅在你确认本地任务后写入该目录；macOS 首次访问时可能显示系统权限提示。</small>
                        </div>
                        <div className="space-form-actions">
                          <button className="secondary-action" onClick={() => setRenamingId(null)} type="button">
                            取消
                          </button>
                          <button className="primary-action" disabled={saving || !editName.trim()} type="submit">
                            保存
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <SpaceLogo project={space} />
                        <div className="space-row-main">
                          <strong>{getSpaceName(space)}</strong>
                          <span>{getSpaceDescription(space)}</span>
                        </div>
                        <div className="space-row-actions">
                          {active && (
                            <span className="space-active-badge">
                              <CircleCheck size={14} />
                              当前
                            </span>
                          )}
                          {!active && (
                            <button
                              className="secondary-action"
                              disabled={saving}
                              onClick={() => void handleSwitch(space.id)}
                              type="button"
                            >
                              切换
                            </button>
                          )}
                          <button className="icon-button compact" onClick={() => startRename(space)} title="重命名空间" type="button">
                            <Pencil size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        )}

        {(creating || !hasMultipleSpaces) && (
          <form className="space-create-form" onSubmit={handleCreate}>
            <div>
              <h3>{hasMultipleSpaces ? '新建空间' : '创建第二个空间'}</h3>
              <p>创建后会自动切换到新空间。</p>
            </div>
            <div className="space-logo-editor">
              <SpaceLogo
                className="editable"
                project={{
                  id: 'space_preview',
                  name: newName || '新空间',
                  description: newDescription,
                  logoDataUrl: newLogoDataUrl || undefined,
                  createdAt: 0,
                  updatedAt: 0
                }}
              />
              <div>
                <strong>空间 Logo</strong>
                <span>可选。建议使用透明背景或简洁方形图片。</span>
                <div className="space-logo-actions">
                  <input
                    ref={newLogoInputRef}
                    accept="image/*"
                    hidden
                    type="file"
                    onChange={(event) => void chooseSpaceLogo(event, 'create')}
                  />
                  <button className="secondary-action" onClick={() => newLogoInputRef.current?.click()} type="button">
                    上传 Logo
                  </button>
                  <button className="secondary-action" disabled={!newLogoDataUrl} onClick={() => setNewLogoDataUrl('')} type="button">
                    移除
                  </button>
                </div>
              </div>
            </div>
            <label>
              <span>空间名称</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="例如：客户方案空间" />
            </label>
            <label>
              <span>空间说明</span>
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="可选"
                rows={2}
              />
            </label>
            <div className="space-workspace-field">
              <span>本地工作目录</span>
              <strong title={newWorkspacePath}>{newWorkspacePath || '可选，创建后也可绑定'}</strong>
              <div>
                <button className="secondary-action" onClick={() => void chooseWorkspace('create')} type="button"><FolderOpen size={15} />选择目录</button>
                <button className="secondary-action" disabled={!newWorkspacePath} onClick={() => setNewWorkspacePath('')} type="button">清除</button>
              </div>
              <small>目录路径只保存在本机，不会发送给模型供应商。</small>
            </div>
            {error && <p className="space-error">{error}</p>}
            <div className="space-form-actions">
              {hasMultipleSpaces && (
                <button className="secondary-action" onClick={() => setCreating(false)} type="button">
                  取消
                </button>
              )}
              <button className="primary-action" disabled={savingAction === 'create' || !newName.trim()} type="submit">
                {savingAction === 'create' ? '创建中...' : '创建空间'}
              </button>
            </div>
          </form>
        )}

        {error && hasMultipleSpaces && !creating && <p className="space-error">{error}</p>}
        </div>
      </section>
    </ModalBackdrop>
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
    <ModalBackdrop onClose={onClose}>
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
    </ModalBackdrop>
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
  onSuggest: (keyword: string, provider: ApiProvider) => Promise<AssistantSuggestion>
}) {
  const [keyword, setKeyword] = useState('')
  const [activePresetCategory, setActivePresetCategory] = useState(ASSISTANT_PRESET_CATEGORIES[0])
  const [providerId, setProviderId] = useState(globalProviderId)
  const selectedProvider = getProviderById(providerId, providers)
  const [modelId, setModelId] = useState(selectedProvider.defaultModel)
  const [assistantStatus, setAssistantStatus] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const modelOptions = getModelOptions(selectedProvider, modelId)
  const selectedModel = modelId.trim() || selectedProvider.defaultModel.trim()
  const aiGenerateUnavailableReason = !selectedModel
    ? '请先选择或填写一个可用模型'
    : selectedProvider.requiresApiKey && !selectedProvider.apiKey.trim()
      ? `请先在模型供应商设置中填写「${selectedProvider.name}」API Key`
      : ''
  const canGenerateAssistant = !isWorking && Boolean(keyword.trim()) && !aiGenerateUnavailableReason
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

    if (aiGenerateUnavailableReason) {
      setAssistantStatus(aiGenerateUnavailableReason)
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
      const suggestion = await onSuggest(text, {
        ...selectedProvider,
        defaultModel: selectedModel,
        models: getModelOptions(selectedProvider, selectedModel)
      })
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
    <ModalBackdrop onClose={onClose}>
      <section className="add-assistant-modal" onClick={stopModalClick}>
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
          <button
            className="assistant-ai-generate-button"
            disabled={!canGenerateAssistant}
            onClick={() => void generateAssistant()}
            title={
              aiGenerateUnavailableReason ||
              (keyword.trim() ? `使用 ${selectedProvider.name} · ${selectedModel} 生成助手配置` : '请输入助手关键词')
            }
            type="button"
          >
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
    </ModalBackdrop>
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
    <ModalBackdrop onClose={onClose}>
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

        <ModelPickerMenu provider={selectedProvider} value={modelId} onChange={setModelId} />

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
    </ModalBackdrop>
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
    <ModalBackdrop onClose={onClose}>
      <section className="knowledge-modal" onClick={stopModalClick}>
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
    </ModalBackdrop>
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
    <ModalBackdrop onClose={onClose}>
      <section className="tool-center-modal" onClick={stopModalClick}>
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
    </ModalBackdrop>
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
    <ModalBackdrop className="provider-add-backdrop" onClose={onClose}>
      <section className="provider-add-modal" onClick={stopModalClick}>
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
    </ModalBackdrop>
  )
}

function SettingsPanel({
  appVersion,
  appBuildCode,
  dataLocation,
  settings,
  providers,
  goldThemeEntitled,
  goldThemeEntitlementChecked,
  onClose,
  onSaveSettings,
  onSaveProvider,
  onCheckProvider,
  onCheckThemeEntitlement,
  onRefreshProviderModels,
  onDeleteProvider,
  onDataLocationChange
}: {
  appVersion: string
  appBuildCode: string
  dataLocation: DataLocationInfo | null
  settings: AppSettings
  providers: ApiProvider[]
  goldThemeEntitled: boolean
  goldThemeEntitlementChecked: boolean
  onClose: () => void
  onSaveSettings: (settings: AppSettings) => Promise<AppSettings>
  onSaveProvider: (provider: ApiProvider) => Promise<ApiProvider>
  onCheckProvider: (provider: ApiProvider) => Promise<ProviderCheckResult>
  onCheckThemeEntitlement: (provider: ApiProvider) => Promise<ThemeEntitlementResult>
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
  const [isCheckingThemeEntitlement, setIsCheckingThemeEntitlement] = useState(false)
  const [themeEntitlementStatus, setThemeEntitlementStatus] = useState('')
  const [isChangingDataLocation, setIsChangingDataLocation] = useState(false)
  const [isArchivingData, setIsArchivingData] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
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
    if (goldThemeEntitlementChecked && !goldThemeEntitled && settingsDraft.theme === 'gold') {
      setSettingsDraft((current) => ({ ...current, theme: 'light' }))
    }
  }, [goldThemeEntitled, goldThemeEntitlementChecked, settingsDraft.theme])

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
    if (result.ok && providerDraft.templateId === 'gllm') {
      setIsCheckingThemeEntitlement(true)
      const entitlement = await onCheckThemeEntitlement(providerDraft)
      setThemeEntitlementStatus(entitlement.message)
      setIsCheckingThemeEntitlement(false)
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

  async function checkForUpdates() {
    setIsCheckingUpdate(true)
    setUpdateInfo(null)
    try {
      setUpdateInfo(await window.gllm.checkForUpdates())
    } catch (error) {
      setUpdateInfo({
        currentVersion: appVersion,
        updateAvailable: false,
        status: 'unavailable',
        downloadPageUrl: 'https://llm.gprophet.com/download',
        message: error instanceof Error ? error.message : '检查更新失败，请稍后重试。'
      })
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  async function openDownloadPage() {
    await window.gllm.openDownloadPage()
  }

  async function openLegalDocument(document: LegalDocument) {
    try {
      await window.gllm.openLegalDocument(document)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '无法打开法律文件，请检查安装是否完整。')
    }
  }

  const isWindows = window.gllm.platform === 'win32'

  async function quitApp() {
    const confirmed = window.confirm('确定退出 G-LLM 吗？关闭主窗口只会隐藏到托盘，最小化会显示右下角浮动 Logo。退出会关闭主窗口、小窗口和浮动 Logo。')
    if (!confirmed) return

    await window.gllm.quitApp()
  }

  return (
    <ModalBackdrop className="drawer-backdrop" onClose={onClose}>
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
                {visibleProviders.map((provider) => {
                  const isActiveProvider = provider.id === providerDraft.id
                  const displayProvider = isActiveProvider ? providerDraft : provider

                  return (
                    <button
                      key={provider.id}
                      className={`provider-item ${isActiveProvider ? 'active' : ''}`}
                      onClick={() => selectProvider(displayProvider)}
                    >
                      <Plug size={17} />
                      <span>
                        <strong>{displayProvider.name}{isActiveProvider && !providerSaved ? '（未保存）' : ''}</strong>
                        <small>{displayProvider.apiBaseUrl}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="provider-form">
              <div className="form-row two provider-default-model-row">
                <label>
                  <span>供应商名称</span>
                  <input
                    value={providerDraft.name}
                    onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
                  />
                </label>
                <div className="settings-model-field">
                  <span>全局默认模型</span>
                  <ModelPickerMenu
                    provider={providerDraft}
                    value={providerDraft.defaultModel}
                    variant="dropdown"
                    onChange={setDefaultModel}
                  />
                </div>
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

        {activeSettingsTab === 'personalization' && (
          <div className="settings-tab-panel personalization-settings-panel">
            <section className="preference-section theme-preference-section">
              <div className="data-location-head">
                <div>
                  <strong>界面主题</strong>
                  <small>主窗口、快速对话和内容组件使用同一套配色。</small>
                </div>
                {goldThemeEntitled && <span>G-LLM 专属主题</span>}
              </div>

              <div className="theme-option-list">
                <label className={`theme-option ${settingsDraft.theme === 'light' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.theme === 'light'}
                    name="app-theme"
                    type="radio"
                    value="light"
                    onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'light' })}
                  />
                  <span className="theme-preview light"><Sun size={19} /></span>
                  <span>
                    <strong>亮色</strong>
                    <small>清晰明亮</small>
                  </span>
                </label>

                <label className={`theme-option ${settingsDraft.theme === 'dark' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.theme === 'dark'}
                    name="app-theme"
                    type="radio"
                    value="dark"
                    onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'dark' })}
                  />
                  <span className="theme-preview dark"><Moon size={19} /></span>
                  <span>
                    <strong>暗色</strong>
                    <small>沉浸克制</small>
                  </span>
                </label>

                {goldThemeEntitled && (
                  <label className={`theme-option gold ${settingsDraft.theme === 'gold' ? 'active' : ''}`}>
                    <input
                      checked={settingsDraft.theme === 'gold'}
                      name="app-theme"
                      type="radio"
                      value="gold"
                      onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'gold' })}
                    />
                    <span className="theme-preview gold"><Crown size={19} /></span>
                    <span>
                      <strong>金色</strong>
                      <small>专业尊享</small>
                    </span>
                  </label>
                )}
              </div>
              {(isCheckingThemeEntitlement || themeEntitlementStatus) && (
                <small className="theme-entitlement-status">
                  {isCheckingThemeEntitlement ? '正在验证 G-LLM 主题资格...' : themeEntitlementStatus}
                </small>
              )}
            </section>

            <section className="preference-section">
              <div className="data-location-head">
                <div>
                  <strong>消息发送方式</strong>
                  <small>用于主窗口和小窗口输入框。中文输入法正在组词时，回车只确认输入，不会发送消息。</small>
                </div>
                <span>{getMessageSendShortcutLabel(settingsDraft.messageSendShortcut)}</span>
              </div>

              <div className="shortcut-option-list">
                <label className={`shortcut-option ${settingsDraft.messageSendShortcut === 'enter' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.messageSendShortcut === 'enter'}
                    name="message-send-shortcut"
                    type="radio"
                    value="enter"
                    onChange={() => setSettingsDraft({ ...settingsDraft, messageSendShortcut: 'enter' })}
                  />
                  <span>
                    <strong>按 Enter 发送</strong>
                    <small>适合短消息和快速问答；需要换行时按 Shift + Enter。</small>
                  </span>
                </label>

                <label className={`shortcut-option ${settingsDraft.messageSendShortcut === 'ctrl-enter' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.messageSendShortcut === 'ctrl-enter'}
                    name="message-send-shortcut"
                    type="radio"
                    value="ctrl-enter"
                    onChange={() => setSettingsDraft({ ...settingsDraft, messageSendShortcut: 'ctrl-enter' })}
                  />
                  <span>
                    <strong>按 Ctrl + Enter 发送</strong>
                    <small>适合长文本编辑；普通 Enter 保留为换行，macOS 也支持 Command + Enter。</small>
                  </span>
                </label>
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
                <div>
                  <span>版本</span>
                  <strong>V{appVersion}{appBuildCode ? `(${appBuildCode})` : ''}</strong>
                </div>
                <div className="about-update-actions">
                  <button
                    className="about-release-link"
                    disabled={isCheckingUpdate}
                    onClick={() => void checkForUpdates()}
                    type="button"
                  >
                    <RefreshCw className={isCheckingUpdate ? 'spin' : ''} size={15} />
                    {isCheckingUpdate ? '正在检查...' : '检查新版本'}
                  </button>
                  <button className="about-release-link" onClick={() => void openDownloadPage()} type="button">
                    <ExternalLink size={15} />
                    下载与更新日志
                  </button>
                </div>
              </div>
              {updateInfo && (
                <div className={`about-update-result ${updateInfo.status}`} role="status">
                  <strong>{updateInfo.message}</strong>
                  {updateInfo.updatedAt && <small>发布日期：{updateInfo.updatedAt}</small>}
                  {updateInfo.releaseNotes && <p>{updateInfo.releaseNotes}</p>}
                  {(updateInfo.updateAvailable || updateInfo.status === 'unavailable') && (
                    <button onClick={() => void openDownloadPage()} type="button">
                      前往官网下载页
                      <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              )}
              <div className="about-legal-summary">
                <div>
                  <strong>源码与商业使用</strong>
                  <span>V1.1.0 允许个人和企业免费内部使用，2030-07-14 自动转换为 AGPL-3.0-only。</span>
                </div>
                <div className="about-legal-actions">
                  <button className="about-release-link" onClick={() => void openLegalDocument('license')} type="button">
                    <Scale size={15} />
                    源码许可证
                  </button>
                  <button className="about-release-link" onClick={() => void openLegalDocument('third-party')} type="button">
                    <BookOpen size={15} />
                    第三方声明
                  </button>
                  <button className="about-release-link" onClick={() => void openLegalDocument('commercial')} type="button">
                    <Briefcase size={15} />
                    商业授权
                  </button>
                  <button className="about-release-link" onClick={() => void openLegalDocument('trademarks')} type="button">
                    <FileText size={15} />
                    商标政策
                  </button>
                </div>
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

            {isWindows && (
              <section className="app-lifecycle-section">
                <div className="data-location-head">
                  <div>
                    <strong>应用驻留与退出</strong>
                    <small>
                      Windows 下关闭主窗口会隐藏到系统托盘；最小化会显示右下角浮动 Logo。托盘菜单可重新显示悬浮窗，退出请使用这里、托盘菜单或浮动 Logo 右键菜单。
                    </small>
                  </div>
                </div>
                <button className="danger-action app-quit-button" onClick={quitApp} type="button">
                  <Power size={16} />
                  退出 G-LLM
                </button>
              </section>
            )}

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
    </ModalBackdrop>
  )
}
