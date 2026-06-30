export type Role = 'system' | 'user' | 'assistant'
export type MessageSendShortcut = 'enter' | 'ctrl-enter'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  attachments?: PreparedAttachment[]
  knowledgeRefs?: KnowledgeReference[]
  webSearch?: WebSearchActivity
  translation?: string
  tokenCount?: number
  inputTokens?: number
  outputTokens?: number
  createdAt: number
}

export type AttachmentKind = 'file' | 'image'

export interface PreparedAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: AttachmentKind
  text?: string
  dataUrl?: string
}

export interface ClipboardAttachmentInput {
  name: string
  mimeType: string
  size: number
  kind?: AttachmentKind
  dataUrl?: string
  text?: string
}

export interface KnowledgeReference {
  id: string
  title: string
  content: string
}

export interface WebSearchResult {
  title: string
  url: string
  snippet?: string
  excerpt?: string
}

export interface WebSearchActivity {
  status: 'planning' | 'searching' | 'completed' | 'failed'
  query: string
  intent?: string
  queries?: string[]
  results: WebSearchResult[]
  error?: string
  searchedAt?: number
}

export type AssistantIcon =
  | 'sparkles'
  | 'file'
  | 'scale'
  | 'code'
  | 'chart'
  | 'graduation'
  | 'brain'
  | 'briefcase'
  | 'pen'

export type AssistantColor = 'ink' | 'green' | 'amber' | 'blue' | 'rose' | 'teal' | 'violet' | 'slate'

export interface Assistant {
  id: string
  projectId?: string
  name: string
  title: string
  tone: string
  color: AssistantColor
  icon: AssistantIcon
  avatarDataUrl?: string
  systemPrompt: string
  starterPrompts: string[]
  modelProviderId?: string
  modelId?: string
  builtIn?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface Conversation {
  id: string
  projectId?: string
  assistantId: string
  title: string
  messages: ChatMessage[]
  modelProviderId?: string
  modelId?: string
  totalTokens?: number
  totalInputTokens?: number
  totalOutputTokens?: number
  createdAt: number
  updatedAt: number
}

export interface KnowledgeNote {
  id: string
  projectId?: string
  title: string
  content: string
  assistantId?: string
  conversationId?: string
  messageId?: string
  createdAt: number
  updatedAt: number
}

export interface AssistantMemory {
  id: string
  projectId?: string
  assistantId: string
  content: string
  enabled: boolean
  sourceNoteId?: string
  sourceMessageId?: string
  createdAt: number
  updatedAt: number
}

export type ToolConfigType = 'function' | 'mcp' | 'plugin'

export interface ToolConfig {
  id: string
  projectId?: string
  type: ToolConfigType
  name: string
  description?: string
  endpoint?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type ProviderTemplateId =
  | 'gllm'
  | 'openai-compatible'
  | 'openai'
  | 'google-gemini'
  | 'deepseek'
  | 'dashscope'
  | 'moonshot'
  | 'zhipu'
  | 'volcengine-ark'
  | 'siliconflow'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'together'
  | 'perplexity'
  | 'ollama'
  | 'lm-studio'
  | 'local-compatible'

export type ProviderTemplateCategory = 'default' | 'global' | 'china' | 'aggregator' | 'local'
export type ProviderModelType = 'chat' | 'vision' | 'image' | 'embedding' | 'audio' | 'rerank' | 'other'
export type ProviderModelCapability = ProviderModelType

export interface ProviderTemplate {
  id: ProviderTemplateId
  name: string
  description: string
  category: ProviderTemplateCategory
  apiBaseUrl: string
  chatCompletionsPath?: string
  modelsPath?: string
  defaultModel: string
  suggestedModels: string[]
  requiresApiKey: boolean
}

export interface ProviderModel {
  id: string
  name?: string
  ownedBy?: string
  capabilities?: ProviderModelCapability[]
  type?: ProviderModelType
}

export interface ApiProvider {
  id: string
  templateId: ProviderTemplateId
  name: string
  apiBaseUrl: string
  chatCompletionsPath?: string
  modelsPath?: string
  apiKey: string
  defaultModel: string
  models: ProviderModel[]
  modelsUpdatedAt?: number
  requiresApiKey: boolean
  createdAt?: number
  updatedAt?: number
}

export interface ProviderCheckResult {
  ok: boolean
  message: string
  models?: ProviderModel[]
}

export interface Project {
  id: string
  name: string
  description?: string
  logoDataUrl?: string
  modelProviderId?: string
  modelId?: string
  createdAt: number
  updatedAt: number
}

export interface AssistantSuggestion {
  name: string
  title: string
  tone: string
  color: AssistantColor
  icon: AssistantIcon
  systemPrompt: string
  starterPrompts: string[]
}

export interface AssistantSuggestionRequest {
  keyword: string
  provider: ApiProvider
  settings: AppSettings
}

export interface AppSettings {
  activeProviderId: string
  temperature: number
  enableTemperature: boolean
  maxTokens: number
  enableMaxTokens: boolean
  messageSendShortcut: MessageSendShortcut
  telemetryEnabled: boolean
  setupCompleted: boolean
}

export interface DataLocationInfo {
  mode: 'normal' | 'portable'
  activePath: string
  defaultPath: string
  effectivePath: string
  customPath?: string
  locatorPath: string
  isCustom: boolean
  pendingRestart: boolean
}

export interface DataLocationChangeResult {
  info: DataLocationInfo
  changed: boolean
  restartRequired: boolean
  message: string
}

export interface DataArchiveResult {
  path: string
  message: string
  fileCount: number
  byteSize?: number
  backupPath?: string
  restartRequired?: boolean
}

export interface ChatRequest {
  conversationId: string
  assistant: Assistant
  assistantMemories?: AssistantMemory[]
  provider: ApiProvider
  messages: ChatMessage[]
  settings: AppSettings
  webSearchEnabled?: boolean
  purpose?: 'chat' | 'translation'
  targetMessageId?: string
}

export interface ChatChunk {
  conversationId: string
  content: string
  webSearch?: WebSearchActivity
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  purpose?: 'chat' | 'translation'
  targetMessageId?: string
  done?: boolean
  error?: string
}

export interface ConversationChangeEvent {
  action: 'saved' | 'deleted'
  conversationId: string
  conversations: Conversation[]
}

export interface AppStateSnapshot {
  appVersion: string
  appBuildCode: string
  dataLocation: DataLocationInfo
  activeProjectId: string
  projects: Project[]
  settings: AppSettings
  providers: ApiProvider[]
  assistants: Assistant[]
  conversations: Conversation[]
  notes: KnowledgeNote[]
  memories: AssistantMemory[]
  tools: ToolConfig[]
}
