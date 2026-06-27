import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { statSync } from 'node:fs'
import { join } from 'node:path'

import { pickAttachments, preparePastedAttachments } from './attachments'
import { captureScreenshot } from './screenshot'
import { checkProviderConnection, fetchProviderModels, generateAssistantSuggestion, streamGllmChat } from './gllmClient'
import {
  adoptExistingDataRoot,
  deleteAssistant,
  deleteConversation,
  deleteMemory,
  deleteNote,
  deleteProvider,
  deleteTool,
  exportDataArchive,
  getAssistants,
  getConversations,
  getDataLocationInfo,
  getMemories,
  getNotes,
  getProviders,
  getSettings,
  getTools,
  importDataArchive,
  migrateDataRoot,
  resetDataRoot,
  saveAssistant,
  saveConversation,
  saveMemory,
  saveNote,
  saveProvider,
  saveTool,
  setSettings
} from './storage'
import {
  getChatTelemetryProperties,
  getErrorCategory,
  getProviderTelemetryProperties,
  trackTelemetryEvent
} from './telemetry'

function getAppIconPath(): string {
  return is.dev ? join(process.cwd(), 'resources/app-icon.png') : join(process.resourcesPath, 'resources/app-icon.png')
}

function formatBuildCode(date: Date): string {
  const parts = [
    date.getFullYear() % 100,
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ]

  return parts.map((part) => String(part).padStart(2, '0')).join('')
}

function getAppBuildCode(): string {
  const envBuildCode = process.env.GLLM_BUILD_CODE?.trim()
  if (envBuildCode) return envBuildCode

  try {
    return formatBuildCode(statSync(__filename).mtime)
  } catch {
    return formatBuildCode(new Date())
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: '无极界',
    backgroundColor: '#f7f5ef',
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.setMenu(null)
  mainWindow.setMenuBarVisibility(false)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.gllm.wujijie')
  Menu.setApplicationMenu(null)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('app:get-state', () => ({
    appVersion: app.getVersion(),
    appBuildCode: getAppBuildCode(),
    dataLocation: getDataLocationInfo(),
    settings: getSettings(),
    providers: getProviders(),
    assistants: getAssistants(),
    conversations: getConversations(),
    notes: getNotes(),
    memories: getMemories(),
    tools: getTools()
  }))

  ipcMain.handle('storage:get-data-location', () => getDataLocationInfo())
  ipcMain.handle('storage:open-data-directory', async () => {
    const result = await shell.openPath(getDataLocationInfo().activePath)
    if (result) throw new Error(result)
  })
  ipcMain.handle('storage:choose-data-directory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: '选择 G-LLM 数据存储目录',
          buttonLabel: '选择目录',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: '选择 G-LLM 数据存储目录',
          buttonLabel: '选择目录',
          properties: ['openDirectory', 'createDirectory']
        })

    if (result.canceled || !result.filePaths[0]) return null
    return migrateDataRoot(result.filePaths[0])
  })
  ipcMain.handle('storage:choose-existing-data-directory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: '选择已有的 G-LLM 数据目录',
          buttonLabel: '使用此目录',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: '选择已有的 G-LLM 数据目录',
          buttonLabel: '使用此目录',
          properties: ['openDirectory']
        })

    if (result.canceled || !result.filePaths[0]) return null
    return adoptExistingDataRoot(result.filePaths[0])
  })
  ipcMain.handle('storage:reset-data-directory', () => resetDataRoot())
  ipcMain.handle('storage:export-data-archive', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showSaveDialog(owner, {
          title: '导出 G-LLM 数据',
          defaultPath: `G-LLM-Data-${formatBuildCode(new Date())}.zip`,
          filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
        })
      : await dialog.showSaveDialog({
          title: '导出 G-LLM 数据',
          defaultPath: `G-LLM-Data-${formatBuildCode(new Date())}.zip`,
          filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
        })

    if (result.canceled || !result.filePath) return null
    return exportDataArchive(result.filePath)
  })
  ipcMain.handle('storage:import-data-archive', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: '导入 G-LLM 数据',
          buttonLabel: '导入数据',
          filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: '导入 G-LLM 数据',
          buttonLabel: '导入数据',
          filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
          properties: ['openFile']
        })

    if (result.canceled || !result.filePaths[0]) return null
    return importDataArchive(result.filePaths[0])
  })
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('settings:save', async (_, settings) => {
    const previous = getSettings()
    if (previous.telemetryEnabled && !settings.telemetryEnabled) {
      await trackTelemetryEvent('telemetry_disabled')
    }

    const saved = setSettings(settings)

    if (!previous.telemetryEnabled && saved.telemetryEnabled) {
      await trackTelemetryEvent('telemetry_enabled')
    }

    return saved
  })
  ipcMain.handle('provider:save', async (_, provider) => {
    const isNewProvider = !getProviders().some((item) => item.id === provider.id)
    const saved = saveProvider(provider)
    void trackTelemetryEvent(isNewProvider ? 'provider_added' : 'provider_updated', getProviderTelemetryProperties(saved))
    return saved
  })
  ipcMain.handle('provider:delete', (_, id: string) => deleteProvider(id))
  ipcMain.handle('provider:check', (_, provider) => checkProviderConnection(provider))
  ipcMain.handle('provider:refresh-models', async (_, provider) => {
    try {
      const models = await fetchProviderModels(provider)
      const refreshed = {
        ...provider,
        models,
        modelsUpdatedAt: Date.now(),
        defaultModel: provider.defaultModel || models[0]?.id || provider.defaultModel
      }
      void trackTelemetryEvent('provider_models_refreshed', getProviderTelemetryProperties(refreshed))
      return refreshed
    } catch (error) {
      void trackTelemetryEvent('provider_models_refresh_failed', {
        ...getProviderTelemetryProperties(provider),
        error_category: getErrorCategory(error)
      })
      throw error
    }
  })
  ipcMain.handle('assistant:save', (_, assistant) => saveAssistant(assistant))
  ipcMain.handle('assistant:delete', (_, id: string) => deleteAssistant(id))
  ipcMain.handle('assistant:suggest', (_, request) => generateAssistantSuggestion(request))
  ipcMain.handle('conversation:save', (_, conversation) => saveConversation(conversation))
  ipcMain.handle('conversation:delete', (_, id: string) => deleteConversation(id))
  ipcMain.handle('note:save', (_, note) => saveNote(note))
  ipcMain.handle('note:delete', (_, id: string) => deleteNote(id))
  ipcMain.handle('memory:save', (_, memory) => saveMemory(memory))
  ipcMain.handle('memory:delete', (_, id: string) => deleteMemory(id))
  ipcMain.handle('tool:save', (_, tool) => saveTool(tool))
  ipcMain.handle('tool:delete', (_, id: string) => deleteTool(id))
  ipcMain.handle('attachment:pick', (event, kind) => pickAttachments(BrowserWindow.fromWebContents(event.sender), kind))
  ipcMain.handle('attachment:prepare-pasted', (_, inputs) => preparePastedAttachments(inputs))
  ipcMain.handle('attachment:screenshot', () => captureScreenshot())

  ipcMain.on('chat:stream', async (event, request) => {
    const chunkBase = {
      conversationId: request.conversationId,
      purpose: request.purpose,
      targetMessageId: request.targetMessageId
    }
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0

    try {
      void trackTelemetryEvent('chat_started', getChatTelemetryProperties(request))
      for await (const chunk of streamGllmChat(request)) {
        if (chunk.usage) {
          inputTokens = chunk.usage.inputTokens
          outputTokens = chunk.usage.outputTokens
          totalTokens = chunk.usage.totalTokens
        }
        event.sender.send('chat:chunk', {
          ...chunkBase,
          content: chunk.content ?? '',
          usage: chunk.usage,
          webSearch: chunk.webSearch
        })
      }
      void trackTelemetryEvent('chat_completed', {
        ...getChatTelemetryProperties(request),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens
      })
      event.sender.send('chat:chunk', { ...chunkBase, content: '', done: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void trackTelemetryEvent('chat_failed', {
        ...getChatTelemetryProperties(request),
        error_category: getErrorCategory(error)
      })
      event.sender.send('chat:chunk', { ...chunkBase, content: '', done: true, error: message })
    }
  })

  createWindow()
  void trackTelemetryEvent('app_started')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
