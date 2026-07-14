/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  protocol,
  screen,
  shell,
  Tray,
  type Point,
  type Rectangle
} from 'electron'
import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AppSettings, ChatRequest, Conversation, LegalDocument } from '../shared/types'
import { checkForAppUpdate, DOWNLOAD_PAGE_URL } from './appUpdate'
import { pickAttachments, preparePastedAttachments } from './attachments'
import { captureScreenshot } from './screenshot'
import { cancelLocalFileTask, executeLocalFileTask, getLocalTaskOutputDirectory, prepareLocalFileTask } from './localFileTasks'
import { resolveWorkspaceItem, runWorkspaceAgent } from './workspaceAgent'
import {
  checkGllmThemeEntitlement,
  checkProviderConnection,
  fetchProviderModels,
  generateAssistantSuggestion,
  searchConversations,
  shouldUpdateConversationProjectMemory,
  streamGllmChat,
  updateConversationProjectMemory
} from './gllmClient'
import {
  adoptExistingDataRoot,
  deleteAssistant,
  deleteConversation,
  deleteMemory,
  deleteNote,
  deleteProject,
  deleteProvider,
  deleteTool,
  exportDataArchive,
  getActiveProjectId,
  getAssistants,
  getConversationSearchSources,
  getConversations,
  getDataResourceFilePathFromUrl,
  getDataResourceProtocol,
  getDataLocationInfo,
  getMemories,
  getNotes,
  getProjects,
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
  saveProject,
  saveProvider,
  saveTool,
  setActiveProjectId,
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

function getWindowsShortcutIconPath(): string {
  return is.dev ? join(process.cwd(), 'build/icon.ico') : join(process.resourcesPath, 'resources/icon.ico')
}

function getTrayIconPath(): string {
  return process.platform === 'win32'
    ? getWindowsShortcutIconPath()
    : is.dev
      ? join(process.cwd(), 'resources/tray-icon-template.png')
      : join(process.resourcesPath, 'resources/tray-icon-template.png')
}

let mainWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null
let floatingLogoWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let activeAssistantId = 'general'
let mainHiddenMode: 'none' | 'tray' | 'floating' = 'none'
const conversationMemoryUpdates = new Set<string>()

async function maybeUpdateProjectMemory(conversation: Conversation): Promise<void> {
  if (conversationMemoryUpdates.has(conversation.id)) return
  if (!shouldUpdateConversationProjectMemory(conversation.messages, conversation.projectMemory)) return
  const providers = getProviders()
  const settings = getSettings()
  const baseProvider = providers.find((provider) => provider.id === (conversation.modelProviderId || settings.activeProviderId)) ?? providers[0]
  if (!baseProvider) return
  const provider = { ...baseProvider, defaultModel: conversation.modelId || baseProvider.defaultModel }
  conversationMemoryUpdates.add(conversation.id)
  try {
    const projectMemory = await updateConversationProjectMemory(provider, conversation.messages, conversation.projectMemory)
    const latest = getConversations(conversation.projectId).find((item) => item.id === conversation.id)
    if (!latest) return
    const saved = saveConversation({ ...latest, projectMemory, updatedAt: latest.updatedAt }, conversation.projectId)
    broadcastConversationChange(saved.id, 'saved')
  } catch {
    // 项目记忆是后台增强能力，失败不影响正常会话。
  } finally {
    conversationMemoryUpdates.delete(conversation.id)
  }
}
let lastMainWindowBounds: Rectangle | null = null
let floatingLogoBounds: Rectangle | null = null
let floatingLogoDragOffset: Point | null = null

const FLOATING_LOGO_SIZE = 88
const FLOATING_LOGO_EDGE_GAP = 8
const SCREENSHOT_WINDOW_HIDE_DELAY_MS = 180
const APP_USER_MODEL_ID = 'com.gllm.wujijie'
const shouldUseSingleInstanceLock = process.platform === 'win32'
const gotSingleInstanceLock = !shouldUseSingleInstanceLock || app.requestSingleInstanceLock()
const legalDocumentPaths = {
  license: { development: 'LICENSE', packaged: 'LICENSE.txt' },
  'third-party': { development: 'THIRD_PARTY_NOTICES.md', packaged: 'THIRD_PARTY_NOTICES.md' },
  commercial: { development: 'COMMERCIAL_LICENSE.md', packaged: 'COMMERCIAL_LICENSE.md' },
  trademarks: { development: 'TRADEMARKS.md', packaged: 'TRADEMARKS.md' }
} satisfies Record<LegalDocument, { development: string; packaged: string }>

function isLegalDocument(value: unknown): value is LegalDocument {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(legalDocumentPaths, value)
}

function getLegalDocumentPath(document: LegalDocument): string {
  const fileName = legalDocumentPaths[document]
  return is.dev ? join(process.cwd(), fileName.development) : join(process.resourcesPath, 'legal', fileName.packaged)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: getDataResourceProtocol(),
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

if (!gotSingleInstanceLock) {
  app.quit()
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

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

function writeMainLog(message: string, error?: unknown): void {
  try {
    const logDirectory = join(app.getPath('appData'), 'G-LLM', 'logs')
    mkdirSync(logDirectory, { recursive: true })
    const detail =
      error instanceof Error
        ? `${error.stack ?? error.message}`
        : error === undefined
          ? ''
          : String(error)

    appendFileSync(join(logDirectory, 'main.log'), `[${new Date().toISOString()}] ${message}${detail ? `\n${detail}` : ''}\n`)
  } catch {
    // Logging must never crash the app.
  }
}

function buildTruncationWarning(request: ChatRequest, finishReason: string): string {
  const reason = finishReason ? `（finish_reason=${finishReason}）` : ''
  const tokenAdvice = request.settings.enableMaxTokens
    ? `当前最大输出 Token 为 ${request.settings.maxTokens.toLocaleString()}，可尝试调大。`
    : '当前客户端未设置最大输出 Token，可在设置中开启并调大。'
  return `模型输出已达到上游长度限制${reason}，回复可能不完整。${tokenAdvice}`
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

function registerDataResourceProtocol(): void {
  protocol.handle(getDataResourceProtocol(), (request) => {
    const filePath = getDataResourceFilePathFromUrl(request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function showExistingInstance(): void {
  if (process.platform !== 'win32') return

  writeMainLog('Second instance requested; showing existing main window.')
  createWindow()
}

function createWindow(): BrowserWindow {
  quickWindow?.hide()
  hideFloatingLogo()
  mainHiddenMode = 'none'

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    title: '无极界',
    backgroundColor:
      getSettings().theme === 'dark' ? '#0f172a' : getSettings().theme === 'gold' ? '#1c1008' : '#f4f7f6',
    autoHideMenuBar: true,
    skipTaskbar: false,
    icon: getAppIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 10 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.setMenu(null)
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setSkipTaskbar(false)
  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMinimized()) lastMainWindowBounds = mainWindow.getBounds()
  })
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMinimized()) lastMainWindowBounds = mainWindow.getBounds()
  })
  mainWindow.on('minimize', () => {
    if (process.platform !== 'win32' || isQuitting) return

    if (mainWindow) lastMainWindowBounds = mainWindow.getNormalBounds()
    mainHiddenMode = 'floating'
    mainWindow?.hide()
    quickWindow?.hide()
    showFloatingLogo()
  })
  mainWindow.on('close', (event) => {
    if (process.platform !== 'win32' || isQuitting) return

    event.preventDefault()
    if (mainWindow) lastMainWindowBounds = mainWindow.getNormalBounds()
    mainHiddenMode = 'tray'
    mainWindow?.hide()
    quickWindow?.hide()
    hideFloatingLogo()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerExternalLinkHandler(mainWindow)
  loadRenderer(mainWindow)
  lastMainWindowBounds = mainWindow.getBounds()
  return mainWindow
}

function getFloatingLogoBounds(): Rectangle {
  if (floatingLogoBounds) {
    floatingLogoBounds = normalizeFloatingLogoBounds(floatingLogoBounds)
    return floatingLogoBounds
  }

  const display =
    lastMainWindowBounds
      ? screen.getDisplayMatching(lastMainWindowBounds)
      : mainWindow && !mainWindow.isDestroyed()
        ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay()
  const workArea = display.workArea

  return {
    x: workArea.x + workArea.width - FLOATING_LOGO_SIZE - 20,
    y: workArea.y + workArea.height - FLOATING_LOGO_SIZE - 20,
    width: FLOATING_LOGO_SIZE,
    height: FLOATING_LOGO_SIZE
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function getFloatingLogoDisplay(bounds: Rectangle): Electron.Display {
  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  })
}

function normalizeFloatingLogoBounds(bounds: Rectangle): Rectangle {
  const display = getFloatingLogoDisplay(bounds)
  const workArea = display.workArea
  const width = FLOATING_LOGO_SIZE
  const height = FLOATING_LOGO_SIZE

  return {
    x: clamp(bounds.x, workArea.x + FLOATING_LOGO_EDGE_GAP, workArea.x + workArea.width - width - FLOATING_LOGO_EDGE_GAP),
    y: clamp(bounds.y, workArea.y + FLOATING_LOGO_EDGE_GAP, workArea.y + workArea.height - height - FLOATING_LOGO_EDGE_GAP),
    width,
    height
  }
}

function snapFloatingLogoBounds(bounds: Rectangle): Rectangle {
  const normalized = normalizeFloatingLogoBounds(bounds)
  const display = getFloatingLogoDisplay(normalized)
  const workArea = display.workArea
  const distances = [
    { edge: 'left', value: Math.abs(normalized.x - workArea.x) },
    { edge: 'right', value: Math.abs(workArea.x + workArea.width - (normalized.x + normalized.width)) },
    { edge: 'top', value: Math.abs(normalized.y - workArea.y) },
    { edge: 'bottom', value: Math.abs(workArea.y + workArea.height - (normalized.y + normalized.height)) }
  ].sort((a, b) => a.value - b.value)
  const snapped = { ...normalized }

  switch (distances[0]?.edge) {
    case 'left':
      snapped.x = workArea.x + FLOATING_LOGO_EDGE_GAP
      break
    case 'right':
      snapped.x = workArea.x + workArea.width - snapped.width - FLOATING_LOGO_EDGE_GAP
      break
    case 'top':
      snapped.y = workArea.y + FLOATING_LOGO_EDGE_GAP
      break
    case 'bottom':
      snapped.y = workArea.y + workArea.height - snapped.height - FLOATING_LOGO_EDGE_GAP
      break
  }

  return snapped
}

function setFloatingLogoBounds(bounds: Rectangle): void {
  floatingLogoBounds = normalizeFloatingLogoBounds(bounds)
  if (floatingLogoWindow && !floatingLogoWindow.isDestroyed()) {
    floatingLogoWindow.setBounds(floatingLogoBounds, false)
  }
}

function beginFloatingLogoDrag(): void {
  if (!floatingLogoWindow || floatingLogoWindow.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  const bounds = floatingLogoWindow.getBounds()
  floatingLogoDragOffset = {
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y
  }
}

function moveFloatingLogoDrag(): void {
  if (!floatingLogoDragOffset || !floatingLogoWindow || floatingLogoWindow.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  setFloatingLogoBounds({
    x: cursor.x - floatingLogoDragOffset.x,
    y: cursor.y - floatingLogoDragOffset.y,
    width: FLOATING_LOGO_SIZE,
    height: FLOATING_LOGO_SIZE
  })
}

function endFloatingLogoDrag(): void {
  if (!floatingLogoWindow || floatingLogoWindow.isDestroyed()) {
    floatingLogoDragOffset = null
    return
  }

  const currentBounds = floatingLogoBounds ?? floatingLogoWindow.getBounds()
  floatingLogoDragOffset = null
  setFloatingLogoBounds(snapFloatingLogoBounds(currentBounds))
}

function createFloatingLogoWindow(): BrowserWindow {
  if (floatingLogoWindow && !floatingLogoWindow.isDestroyed()) {
    floatingLogoWindow.setBounds(getFloatingLogoBounds(), false)
    return floatingLogoWindow
  }

  floatingLogoWindow = new BrowserWindow({
    ...getFloatingLogoBounds(),
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    transparent: true,
    title: 'G-LLM',
    backgroundColor: '#00000000',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  floatingLogoWindow.setMenu(null)
  floatingLogoWindow.setMenuBarVisibility(false)
  floatingLogoWindow.setAlwaysOnTop(true, 'floating')
  floatingLogoWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      floatingLogoWindow?.hide()
    }
  })
  floatingLogoWindow.on('closed', () => {
    floatingLogoWindow = null
  })

  registerExternalLinkHandler(floatingLogoWindow)
  loadRenderer(floatingLogoWindow, 'floating-logo')
  return floatingLogoWindow
}

function revealFloatingLogoWindow(window: BrowserWindow): void {
  window.setBounds(getFloatingLogoBounds(), false)
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.showInactive()
  window.moveTop()
}

function showFloatingLogo(): void {
  if (process.platform !== 'win32' || isQuitting) return

  const window = createFloatingLogoWindow()
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => {
      if (!window.isDestroyed() && mainHiddenMode === 'floating') {
        revealFloatingLogoWindow(window)
      }
    })
    return
  }

  revealFloatingLogoWindow(window)
}

function hideFloatingLogo(): void {
  if (floatingLogoWindow && !floatingLogoWindow.isDestroyed()) {
    floatingLogoWindow.hide()
  }
}

function hideFloatingLogoToTray(): void {
  mainHiddenMode = 'tray'
  hideFloatingLogo()
}

function showFloatingLogoFromTray(): void {
  if (process.platform !== 'win32') return

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isMinimized()) lastMainWindowBounds = mainWindow.getNormalBounds()
    mainWindow.hide()
  }
  quickWindow?.hide()
  mainHiddenMode = 'floating'
  showFloatingLogo()
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
    hasShadow: process.platform !== 'win32',
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
      hideQuickWindow()
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
  hideFloatingLogo()

  const window = createQuickWindow(anchorBounds)
  window.setBounds(getQuickWindowBounds(anchorBounds), false)
  window.show()
  window.focus()
}

function hideQuickWindow(): void {
  quickWindow?.hide()

  if (mainHiddenMode === 'floating') {
    showFloatingLogo()
  }
}

function buildAppStatusMenu(anchorBounds?: Rectangle): Menu {
  const floatingLogoVisible = Boolean(floatingLogoWindow && !floatingLogoWindow.isDestroyed() && floatingLogoWindow.isVisible())

  return Menu.buildFromTemplate([
    { label: '打开快速对话', click: () => showQuickWindow(anchorBounds) },
    { label: '打开主窗口', click: () => createWindow() },
    ...(process.platform === 'win32'
      ? [
          {
            label: floatingLogoVisible ? '隐藏悬浮窗' : '显示悬浮窗',
            click: () => {
              if (floatingLogoVisible) {
                hideFloatingLogoToTray()
              } else {
                showFloatingLogoFromTray()
              }
            }
          }
        ]
      : []),
    { type: 'separator' },
    {
      label: '退出 G-LLM',
      click: () => quitApp()
    }
  ])
}

function showFloatingLogoContextMenu(): void {
  if (!floatingLogoWindow || floatingLogoWindow.isDestroyed()) return

  buildAppStatusMenu(floatingLogoWindow.getBounds()).popup({ window: floatingLogoWindow })
}

function toggleQuickWindow(anchorBounds?: Rectangle): void {
  if (quickWindow?.isVisible()) {
    hideQuickWindow()
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
  if (!['darwin', 'win32'].includes(process.platform) || tray) return

  const icon = nativeImage.createFromPath(getTrayIconPath()).resize(
    process.platform === 'darwin' ? { height: 19, quality: 'best' } : { width: 16, height: 16, quality: 'best' }
  )
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('G-LLM 快速对话')
  tray.on('click', (_, bounds) => handleTrayClick(bounds))
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildAppStatusMenu(tray.getBounds()))
  })
  tray.setContextMenu(buildAppStatusMenu(tray.getBounds()))
}

function quitApp(): void {
  isQuitting = true
  mainHiddenMode = 'none'
  app.quit()
}

function broadcastActiveAssistantChange(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('assistant:active-changed', activeAssistantId)
    }
  }
}

function broadcastSettingsChange(settings: AppSettings): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('settings:changed', settings)
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

function getAppStateSnapshot() {
  const activeProjectId = getActiveProjectId()

  return {
    appVersion: app.getVersion(),
    appBuildCode: getAppBuildCode(),
    dataLocation: getDataLocationInfo(),
    activeProjectId,
    projects: getProjects(),
    settings: getSettings(),
    providers: getProviders(),
    assistants: getAssistants(activeProjectId),
    conversations: getConversations(activeProjectId),
    notes: getNotes(activeProjectId),
    memories: getMemories(activeProjectId),
    tools: getTools(activeProjectId)
  }
}

async function captureScreenshotForWindow(owner: BrowserWindow | null): Promise<Awaited<ReturnType<typeof captureScreenshot>>> {
  const shouldHideOwner = process.platform === 'win32' && owner && !owner.isDestroyed() && owner.isVisible()

  if (shouldHideOwner) {
    owner.hide()
    await sleep(SCREENSHOT_WINDOW_HIDE_DELAY_MS)
  }

  try {
    return await captureScreenshot()
  } finally {
    if (shouldHideOwner && owner && !owner.isDestroyed()) {
      if (owner.isMinimized()) owner.restore()
      owner.show()
      owner.focus()
    }
  }
}

function copyImageDataUrlToClipboard(dataUrl: string): void {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('Invalid image data')

  clipboard.writeImage(image)
}

if (gotSingleInstanceLock && shouldUseSingleInstanceLock) {
  app.on('second-instance', () => {
    showExistingInstance()
  })
}

process.on('uncaughtException', (error) => {
  writeMainLog('Uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  writeMainLog('Unhandled rejection', reason)
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return

  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  Menu.setApplicationMenu(null)
  registerDataResourceProtocol()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('render-process-gone', (_, webContents, details) => {
    writeMainLog(`Render process gone: reason=${details.reason}, exitCode=${details.exitCode}, url=${webContents.getURL()}`)
  })

  app.on('child-process-gone', (_, details) => {
    writeMainLog(`Child process gone: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}`)
  })

  ipcMain.handle('app:get-state', () => getAppStateSnapshot())
  ipcMain.handle('app:check-for-updates', () => checkForAppUpdate(app.getVersion()))
  ipcMain.handle('app:open-download-page', async () => {
    await shell.openExternal(DOWNLOAD_PAGE_URL)
  })
  ipcMain.handle('app:open-legal-document', async (_event, document: unknown) => {
    if (!isLegalDocument(document)) throw new Error('Unsupported legal document')
    const result = await shell.openPath(getLegalDocumentPath(document))
    if (result) throw new Error(result)
  })

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
  ipcMain.handle('app:quit', () => {
    quitApp()
  })
  ipcMain.handle('app:show-main-window', () => {
    createWindow()
  })
  ipcMain.handle('app:show-quick-panel', () => {
    showQuickWindow(floatingLogoWindow?.getBounds())
  })
  ipcMain.handle('app:hide-quick-panel', () => {
    hideQuickWindow()
  })
  ipcMain.handle('app:show-floating-logo-menu', () => {
    showFloatingLogoContextMenu()
  })
  ipcMain.on('app:floating-logo-drag-start', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) === floatingLogoWindow) beginFloatingLogoDrag()
  })
  ipcMain.on('app:floating-logo-drag-move', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) === floatingLogoWindow) moveFloatingLogoDrag()
  })
  ipcMain.on('app:floating-logo-drag-end', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) === floatingLogoWindow) endFloatingLogoDrag()
  })
  ipcMain.handle('assistant:get-active', () => activeAssistantId)
  ipcMain.handle('assistant:set-active', (_, id: string) => {
    const nextId = id.trim()
    if (!nextId || nextId === activeAssistantId) return activeAssistantId

    activeAssistantId = nextId
    broadcastActiveAssistantChange()
    return activeAssistantId
  })

  ipcMain.handle('project:set-active', (_, id: string) => {
    setActiveProjectId(id)
    return getAppStateSnapshot()
  })
  ipcMain.handle('project:save', (_, project) => {
    const saved = saveProject(project)
    return {
      saved,
      state: getAppStateSnapshot()
    }
  })
  ipcMain.handle('project:delete', (_, id: string) => {
    deleteProject(id)
    return getAppStateSnapshot()
  })

  ipcMain.handle('settings:save', async (_, settings) => {
    const previous = getSettings()
    if (previous.telemetryEnabled && !settings.telemetryEnabled) {
      await trackTelemetryEvent('telemetry_disabled')
    }

    const saved = setSettings(settings)
    broadcastSettingsChange(saved)

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
  ipcMain.handle('provider:check-theme-entitlement', (_, provider) => checkGllmThemeEntitlement(provider))
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
  ipcMain.handle('conversation:search', (_, request) =>
    searchConversations(request, getConversationSearchSources())
  )
  ipcMain.handle('conversation:save', (_, conversation) => {
    const saved = saveConversation(conversation)
    broadcastConversationChange(saved.id, 'saved')
    void maybeUpdateProjectMemory(saved)
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
  ipcMain.handle('local-task:prepare', (_, request: string, attachmentIds: string[]) =>
    prepareLocalFileTask(request, attachmentIds)
  )
  ipcMain.handle('local-task:execute', async (event, planId: string) =>
    executeLocalFileTask(planId, (progress) => event.sender.send('local-task:progress', progress))
  )
  ipcMain.handle('local-task:cancel', (_, planId: string) => cancelLocalFileTask(planId))
  ipcMain.handle('local-task:open-output', async (_, planId: string) => {
    const outputPath = getLocalTaskOutputDirectory(planId)
    if (!outputPath) throw new Error('任务输出目录已失效')
    const error = await shell.openPath(outputPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('project:choose-workspace', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: '选择空间工作目录', properties: ['openDirectory', 'createDirectory'] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('workspace-agent:run', async (event, request) =>
    runWorkspaceAgent(request, (progress) => event.sender.send('workspace-agent:progress', progress))
  )
  ipcMain.handle('workspace:reveal-file', async (_, rootPath: string, relativePath: string) => {
    const filePath = await resolveWorkspaceItem(rootPath, relativePath)
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('attachment:screenshot', (event) => captureScreenshotForWindow(BrowserWindow.fromWebContents(event.sender)))
  ipcMain.handle('clipboard:copy-image', (_, dataUrl: string) => copyImageDataUrlToClipboard(dataUrl))

  ipcMain.on('chat:stream', async (event, request) => {
    const chunkBase = {
      conversationId: request.conversationId,
      purpose: request.purpose,
      targetMessageId: request.targetMessageId
    }
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    let finishReason = ''
    let isTruncated = false

    try {
      void trackTelemetryEvent('chat_started', getChatTelemetryProperties(request))
      for await (const chunk of streamGllmChat(request)) {
        if (chunk.usage) {
          inputTokens = chunk.usage.inputTokens
          outputTokens = chunk.usage.outputTokens
          totalTokens = chunk.usage.totalTokens
        }
        if (chunk.finishReason) finishReason = chunk.finishReason
        if (chunk.isTruncated) isTruncated = true
        event.sender.send('chat:chunk', {
          ...chunkBase,
          content: chunk.content ?? '',
          usage: chunk.usage,
          webSearch: chunk.webSearch,
          finishReason: chunk.finishReason,
          isTruncated: chunk.isTruncated
        })
      }
      void trackTelemetryEvent('chat_completed', {
        ...getChatTelemetryProperties(request),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        finish_reason: finishReason || 'unknown',
        truncated: isTruncated
      })
      event.sender.send('chat:chunk', {
        ...chunkBase,
        content: '',
        done: true,
        finishReason: finishReason || undefined,
        isTruncated,
        warning: isTruncated ? buildTruncationWarning(request, finishReason) : undefined
      })
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
  if (process.platform === 'win32') createFloatingLogoWindow()
  void trackTelemetryEvent('app_started')

  screen.on('display-metrics-changed', () => {
    if (floatingLogoWindow?.isVisible()) {
      floatingLogoWindow.setBounds(getFloatingLogoBounds(), false)
    }
  })

  app.on('activate', () => {
    createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit()
})
