import { contextBridge, ipcRenderer } from 'electron'

import type {
  ApiProvider,
  AppUpdateInfo,
  AppSettings,
  AppStateSnapshot,
  AttachmentKind,
  Assistant,
  AssistantMemory,
  AssistantSuggestion,
  AssistantSuggestionRequest,
  ChatChunk,
  ChatRequest,
  ClipboardAttachmentInput,
  Conversation,
  ConversationChangeEvent,
  ConversationSearchRequest,
  ConversationSearchResponse,
  DataArchiveResult,
  DataLocationChangeResult,
  DataLocationInfo,
  KnowledgeNote,
  LocalTaskPlan,
  LocalTaskProgress,
  LocalTaskResult,
  PreparedAttachment,
  Project,
  ProviderCheckResult,
  ThemeEntitlementResult,
  ToolConfig,
  WorkspaceAgentProgress,
  WorkspaceAgentRequest,
  WorkspaceAgentResult
} from '../shared/types'

const api = {
  platform: process.platform,
  getState: (): Promise<AppStateSnapshot> => ipcRenderer.invoke('app:get-state'),
  checkForUpdates: (): Promise<AppUpdateInfo> => ipcRenderer.invoke('app:check-for-updates'),
  openDownloadPage: (): Promise<void> => ipcRenderer.invoke('app:open-download-page'),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:save', settings),
  saveProvider: (provider: ApiProvider): Promise<ApiProvider> => ipcRenderer.invoke('provider:save', provider),
  deleteProvider: (id: string): Promise<void> => ipcRenderer.invoke('provider:delete', id),
  checkProvider: (provider: ApiProvider): Promise<ProviderCheckResult> => ipcRenderer.invoke('provider:check', provider),
  checkThemeEntitlement: (provider: ApiProvider): Promise<ThemeEntitlementResult> =>
    ipcRenderer.invoke('provider:check-theme-entitlement', provider),
  refreshProviderModels: (provider: ApiProvider): Promise<ApiProvider> =>
    ipcRenderer.invoke('provider:refresh-models', provider),
  setActiveProjectId: (id: string): Promise<AppStateSnapshot> => ipcRenderer.invoke('project:set-active', id),
  saveProject: (project: Project): Promise<{ saved: Project; state: AppStateSnapshot }> =>
    ipcRenderer.invoke('project:save', project),
  chooseWorkspaceDirectory: (): Promise<string | null> => ipcRenderer.invoke('project:choose-workspace'),
  runWorkspaceAgent: (request: WorkspaceAgentRequest): Promise<WorkspaceAgentResult> =>
    ipcRenderer.invoke('workspace-agent:run', request),
  revealWorkspaceFile: (rootPath: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke('workspace:reveal-file', rootPath, relativePath),
  deleteProject: (id: string): Promise<AppStateSnapshot> => ipcRenderer.invoke('project:delete', id),
  saveAssistant: (assistant: Assistant): Promise<Assistant> => ipcRenderer.invoke('assistant:save', assistant),
  deleteAssistant: (id: string): Promise<void> => ipcRenderer.invoke('assistant:delete', id),
  suggestAssistant: (request: AssistantSuggestionRequest): Promise<AssistantSuggestion> =>
    ipcRenderer.invoke('assistant:suggest', request),
  saveConversation: (conversation: Conversation): Promise<Conversation> =>
    ipcRenderer.invoke('conversation:save', conversation),
  searchConversations: (request: ConversationSearchRequest): Promise<ConversationSearchResponse> =>
    ipcRenderer.invoke('conversation:search', request),
  deleteConversation: (id: string): Promise<void> => ipcRenderer.invoke('conversation:delete', id),
  saveNote: (note: KnowledgeNote): Promise<KnowledgeNote> => ipcRenderer.invoke('note:save', note),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('note:delete', id),
  saveMemory: (memory: AssistantMemory): Promise<AssistantMemory> => ipcRenderer.invoke('memory:save', memory),
  deleteMemory: (id: string): Promise<void> => ipcRenderer.invoke('memory:delete', id),
  saveTool: (tool: ToolConfig): Promise<ToolConfig> => ipcRenderer.invoke('tool:save', tool),
  deleteTool: (id: string): Promise<void> => ipcRenderer.invoke('tool:delete', id),
  pickAttachments: (kind: AttachmentKind): Promise<PreparedAttachment[]> => ipcRenderer.invoke('attachment:pick', kind),
  preparePastedAttachments: (inputs: ClipboardAttachmentInput[]): Promise<PreparedAttachment[]> =>
    ipcRenderer.invoke('attachment:prepare-pasted', inputs),
  prepareLocalFileTask: (request: string, attachmentIds: string[]): Promise<LocalTaskPlan> =>
    ipcRenderer.invoke('local-task:prepare', request, attachmentIds),
  executeLocalFileTask: (planId: string): Promise<LocalTaskResult> => ipcRenderer.invoke('local-task:execute', planId),
  cancelLocalFileTask: (planId: string): Promise<void> => ipcRenderer.invoke('local-task:cancel', planId),
  openLocalTaskOutput: (planId: string): Promise<void> => ipcRenderer.invoke('local-task:open-output', planId),
  captureScreenshot: (): Promise<PreparedAttachment | null> => ipcRenderer.invoke('attachment:screenshot'),
  copyImageToClipboard: (dataUrl: string): Promise<void> => ipcRenderer.invoke('clipboard:copy-image', dataUrl),
  getDataLocation: (): Promise<DataLocationInfo> => ipcRenderer.invoke('storage:get-data-location'),
  openDataDirectory: (): Promise<void> => ipcRenderer.invoke('storage:open-data-directory'),
  chooseDataDirectory: (): Promise<DataLocationChangeResult | null> => ipcRenderer.invoke('storage:choose-data-directory'),
  chooseExistingDataDirectory: (): Promise<DataLocationChangeResult | null> =>
    ipcRenderer.invoke('storage:choose-existing-data-directory'),
  resetDataDirectory: (): Promise<DataLocationChangeResult> => ipcRenderer.invoke('storage:reset-data-directory'),
  exportDataArchive: (): Promise<DataArchiveResult | null> => ipcRenderer.invoke('storage:export-data-archive'),
  importDataArchive: (): Promise<DataArchiveResult | null> => ipcRenderer.invoke('storage:import-data-archive'),
  relaunchApp: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  showMainWindow: (): Promise<void> => ipcRenderer.invoke('app:show-main-window'),
  showQuickPanel: (): Promise<void> => ipcRenderer.invoke('app:show-quick-panel'),
  hideQuickPanel: (): Promise<void> => ipcRenderer.invoke('app:hide-quick-panel'),
  showFloatingLogoMenu: (): Promise<void> => ipcRenderer.invoke('app:show-floating-logo-menu'),
  beginFloatingLogoDrag: (): void => ipcRenderer.send('app:floating-logo-drag-start'),
  moveFloatingLogoDrag: (): void => ipcRenderer.send('app:floating-logo-drag-move'),
  endFloatingLogoDrag: (): void => ipcRenderer.send('app:floating-logo-drag-end'),
  getActiveAssistantId: (): Promise<string> => ipcRenderer.invoke('assistant:get-active'),
  setActiveAssistantId: (id: string): Promise<string> => ipcRenderer.invoke('assistant:set-active', id),
  streamChat: (request: ChatRequest): void => ipcRenderer.send('chat:stream', request),
  onSettingsChanged: (listener: (settings: AppSettings) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => listener(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  onActiveAssistantChanged: (listener: (id: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id)
    ipcRenderer.on('assistant:active-changed', handler)
    return () => ipcRenderer.removeListener('assistant:active-changed', handler)
  },
  onChatChunk: (listener: (chunk: ChatChunk) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: ChatChunk) => listener(chunk)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.removeListener('chat:chunk', handler)
  },
  onLocalTaskProgress: (listener: (progress: LocalTaskProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: LocalTaskProgress) => listener(progress)
    ipcRenderer.on('local-task:progress', handler)
    return () => ipcRenderer.removeListener('local-task:progress', handler)
  },
  onWorkspaceAgentProgress: (listener: (progress: WorkspaceAgentProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: WorkspaceAgentProgress) => listener(progress)
    ipcRenderer.on('workspace-agent:progress', handler)
    return () => ipcRenderer.removeListener('workspace-agent:progress', handler)
  },
  onConversationChanged: (listener: (event: ConversationChangeEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, change: ConversationChangeEvent) => listener(change)
    ipcRenderer.on('conversation:changed', handler)
    return () => ipcRenderer.removeListener('conversation:changed', handler)
  }
}

contextBridge.exposeInMainWorld('gllm', api)

export type GllmApi = typeof api
