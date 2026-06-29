import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray, type Rectangle } from 'electron'
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

function getTrayIconPath(): string {
  return is.dev ? join(process.cwd(), 'resources/tray-icon-template.png') : join(process.resourcesPath, 'resources/tray-icon-template.png')
}

let mainWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let activeAssistantId = 'general'

function formatBuildCode(date: Date): string {
  const parts = [
    date.getFullYear(),
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

function canOpenExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function loadRenderer(window: BrowserWindow, hash?: string): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = hash ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : process.env.ELECTRON_RENDERER_URL
    void window.loadURL(url)
  } else {
    if (hash) {
      void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }
}

function registerExternalLinkHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

function createWindow(): BrowserWindow {
  quickWindow?.hide()

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  mainWindow = new BrowserWindow({
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
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerExternalLinkHandler(mainWindow)
  loadRenderer(mainWindow)
  return mainWindow
}

function getQuickWindowBounds(anchorBounds?: Rectangle): Rectangle {
  const width = 760
  const height = 680
  const display = anchorBounds
    ? screen.getDisplayNearestPoint({
        x: Math.round(anchorBounds.x + anchorBounds.width / 2),
        y: Math.round(anchorBounds.y + anchorBounds.height / 2)
      })
    : screen.getPrimaryDisplay()
  const workArea = display.workArea
  const preferredX = anchorBounds ? Math.round(anchorBounds.x + anchorBounds.width / 2 - width / 2) : Math.round(workArea.x + (workArea.width - width) / 2)
  const x = Math.min(Math.max(preferredX, workArea.x + 10), workArea.x + workArea.width - width - 10)
  const y = anchorBounds ? Math.min(anchorBounds.y + anchorBounds.height + 8, workArea.y + workArea.height - height - 10) : Math.round(workArea.y + 40)

  return {
    x,
    y: Math.max(y, workArea.y + 8),
    width,
    height
  }
}

function createQuickWindow(anchorBounds?: Rectangle): BrowserWindow {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.setBounds(getQuickWindowBounds(anchorBounds), false)
    return quickWindow
  }

  quickWindow = new BrowserWindow({
    ...getQuickWindowBounds(anchorBounds),
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    transparent: true,
    title: 'G-LLM 快速对话',
    backgroundColor: '#00000000',
    icon: getAppIconPath(),
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  quickWindow.setMenu(null)
  quickWindow.setMenuBarVisibility(false)
  quickWindow.setAlwaysOnTop(true, 'floating')
  quickWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      quickWindow?.hide()
    }
  })
  quickWindow.on('closed', () => {
    quickWindow = null
  })

  registerExternalLinkHandler(quickWindow)
  loadRenderer(quickWindow, 'quick')
  return quickWindow
}

function showQuickWindow(anchorBounds?: Rectangle): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }

  const window = createQuickWindow(anchorBounds)
  window.setBounds(getQuickWindowBounds(anchorBounds), false)
  window.show()
  window.focus()
}

function toggleQuickWindow(anchorBounds?: Rectangle): void {
  if (quickWindow?.isVisible()) {
    quickWindow.hide()
    return
  }

  showQuickWindow(anchorBounds)
}

function handleTrayClick(anchorBounds?: Rectangle): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    quickWindow?.hide()
    createWindow()
    return
  }

  toggleQuickWindow(anchorBounds)
}

function setupTray(): void {
  if (process.platform !== 'darwin' || tray) return

  const icon = nativeImage.createFromPath(getTrayIconPath()).resize({ height: 19, quality: 'best' })
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('G-LLM 快速对话')
  tray.on('click', (_, bounds) => handleTrayClick(bounds))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开快速对话', click: () => showQuickWindow(tray?.getBounds()) },
      { label: '打开主窗口', click: () => createWindow() },
      { type: 'separator' },
      {
        label: '退出 G-LLM',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function broadcastActiveAssistantChange(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('assistant:active-changed', activeAssistantId)
    }
  }
}

function broadcastConversationChange(conversationId: string, action: 'saved' | 'deleted'): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('conversation:changed', {
        action,
        conversationId,
        conversations: getConversations()
      })
    }
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
  ipcMain.handle('app:show-main-window', () => {
    createWindow()
  })
  ipcMain.handle('app:hide-quick-panel', () => {
    quickWindow?.hide()
  })
  ipcMain.handle('assistant:get-active', () => activeAssistantId)
  ipcMain.handle('assistant:set-active', (_, id: string) => {
    const nextId = id.trim()
    if (!nextId || nextId === activeAssistantId) return activeAssistantId

    activeAssistantId = nextId
    broadcastActiveAssistantChange()
    return activeAssistantId
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
  ipcMain.handle('conversation:save', (_, conversation) => {
    const saved = saveConversation(conversation)
    broadcastConversationChange(saved.id, 'saved')
    return saved
  })
  ipcMain.handle('conversation:delete', (_, id: string) => {
    deleteConversation(id)
    broadcastConversationChange(id, 'deleted')
  })
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

  setupTray()
  createWindow()
  void trackTelemetryEvent('app_started')

  app.on('activate', () => {
    createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
