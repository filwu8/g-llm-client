import { contextBridge, ipcRenderer } from 'electron'

import type {
  ApiProvider,
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
  DataArchiveResult,
  DataLocationChangeResult,
  DataLocationInfo,
  KnowledgeNote,
  PreparedAttachment,
  ProviderCheckResult,
  ToolConfig
} from '../shared/types'

const api = {
  platform: process.platform,
  getState: (): Promise<AppStateSnapshot> => ipcRenderer.invoke('app:get-state'),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:save', settings),
  saveProvider: (provider: ApiProvider): Promise<ApiProvider> => ipcRenderer.invoke('provider:save', provider),
  deleteProvider: (id: string): Promise<void> => ipcRenderer.invoke('provider:delete', id),
  checkProvider: (provider: ApiProvider): Promise<ProviderCheckResult> => ipcRenderer.invoke('provider:check', provider),
  refreshProviderModels: (provider: ApiProvider): Promise<ApiProvider> =>
    ipcRenderer.invoke('provider:refresh-models', provider),
  saveAssistant: (assistant: Assistant): Promise<Assistant> => ipcRenderer.invoke('assistant:save', assistant),
  deleteAssistant: (id: string): Promise<void> => ipcRenderer.invoke('assistant:delete', id),
  suggestAssistant: (request: AssistantSuggestionRequest): Promise<AssistantSuggestion> =>
    ipcRenderer.invoke('assistant:suggest', request),
  saveConversation: (conversation: Conversation): Promise<Conversation> =>
    ipcRenderer.invoke('conversation:save', conversation),
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
  captureScreenshot: (): Promise<PreparedAttachment | null> => ipcRenderer.invoke('attachment:screenshot'),
  getDataLocation: (): Promise<DataLocationInfo> => ipcRenderer.invoke('storage:get-data-location'),
  openDataDirectory: (): Promise<void> => ipcRenderer.invoke('storage:open-data-directory'),
  chooseDataDirectory: (): Promise<DataLocationChangeResult | null> => ipcRenderer.invoke('storage:choose-data-directory'),
  chooseExistingDataDirectory: (): Promise<DataLocationChangeResult | null> =>
    ipcRenderer.invoke('storage:choose-existing-data-directory'),
  resetDataDirectory: (): Promise<DataLocationChangeResult> => ipcRenderer.invoke('storage:reset-data-directory'),
  exportDataArchive: (): Promise<DataArchiveResult | null> => ipcRenderer.invoke('storage:export-data-archive'),
  importDataArchive: (): Promise<DataArchiveResult | null> => ipcRenderer.invoke('storage:import-data-archive'),
  relaunchApp: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  showMainWindow: (): Promise<void> => ipcRenderer.invoke('app:show-main-window'),
  hideQuickPanel: (): Promise<void> => ipcRenderer.invoke('app:hide-quick-panel'),
  getActiveAssistantId: (): Promise<string> => ipcRenderer.invoke('assistant:get-active'),
  setActiveAssistantId: (id: string): Promise<string> => ipcRenderer.invoke('assistant:set-active', id),
  streamChat: (request: ChatRequest): void => ipcRenderer.send('chat:stream', request),
  onActiveAssistantChanged: (listener: (id: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id)
    ipcRenderer.on('assistant:active-changed', handler)
    return () => ipcRenderer.removeListener('assistant:active-changed', handler)
  },
  onChatChunk: (listener: (chunk: ChatChunk) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: ChatChunk) => listener(chunk)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.removeListener('chat:chunk', handler)
  }
}

contextBridge.exposeInMainWorld('gllm', api)

export type GllmApi = typeof api
