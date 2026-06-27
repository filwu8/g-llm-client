import { app } from 'electron'
import Store from 'electron-store'
import JSZip from 'jszip'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { DEFAULT_ASSISTANTS } from '../shared/assistants'
import { inferModelType, normalizeModelCapabilities } from '../shared/modelCapabilities'
import { DEFAULT_PROVIDER, DEFAULT_PROVIDER_ID } from '../shared/providers'
import type {
  ApiProvider,
  AppSettings,
  Assistant,
  AssistantColor,
  AssistantIcon,
  AssistantMemory,
  ChatMessage,
  Conversation,
  DataArchiveResult,
  DataLocationChangeResult,
  DataLocationInfo,
  KnowledgeReference,
  KnowledgeNote,
  PreparedAttachment,
  ProviderModel,
  ToolConfig,
  ToolConfigType,
  WebSearchActivity,
  WebSearchResult
} from '../shared/types'

type LegacySettings = Partial<AppSettings> & {
  apiBaseUrl?: string
  apiKey?: string
  defaultModel?: string
}

interface StoreSchema {
  settings: LegacySettings
  providers: ApiProvider[]
  assistants: Assistant[]
  conversations: Conversation[]
  notes: KnowledgeNote[]
  memories: AssistantMemory[]
  tools: ToolConfig[]
  installationId: string
}

interface DataLocationConfig {
  customDataRoot?: string
  updatedAt?: number
}

const dataLocationFileName = 'data-location.json'
const installerDataLocationFileName = 'data-location.txt'
const storeFileName = 'g-llm-client.json'
const archiveManifestFileName = 'g-llm-data-archive.json'
const importBackupPrefix = 'backup-before-gllm-import-'
const migrationBackupPrefix = 'backup-before-gllm-migration-'
const assistantColors: AssistantColor[] = ['ink', 'green', 'amber', 'blue', 'rose', 'teal', 'violet', 'slate']
const assistantIcons: AssistantIcon[] = [
  'sparkles',
  'file',
  'scale',
  'code',
  'chart',
  'graduation',
  'brain',
  'briefcase',
  'pen'
]

function getPortableDataRoot(): string | null {
  if (process.platform !== 'win32' || !app.isPackaged) return null

  const installRoot = dirname(process.execPath)
  const portableMarker = join(installRoot, 'portable.flag')
  if (!existsSync(portableMarker)) return null

  return join(installRoot, 'UserData')
}

function getDefaultDataRoot(): string {
  return getPortableDataRoot() ?? (process.platform === 'win32' ? join(app.getPath('appData'), 'G-LLM') : app.getPath('userData'))
}

function getDataLocationConfigPath(defaultRoot = getDefaultDataRoot()): string {
  return join(defaultRoot, dataLocationFileName)
}

function getInstallerDataLocationConfigPath(defaultRoot = getDefaultDataRoot()): string {
  return join(defaultRoot, installerDataLocationFileName)
}

function normalizePathForCompare(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right)
}

function isPathInside(child: string, parent: string): boolean {
  const childPath = normalizePathForCompare(child)
  const parentPath = normalizePathForCompare(parent)
  const diff = relative(parentPath, childPath)
  return Boolean(diff) && !diff.startsWith('..') && !isAbsolute(diff)
}

function readDataLocationConfig(defaultRoot = getDefaultDataRoot()): DataLocationConfig {
  const configPath = getDataLocationConfigPath(defaultRoot)
  if (!existsSync(configPath)) {
    const installerConfigPath = getInstallerDataLocationConfigPath(defaultRoot)
    if (!existsSync(installerConfigPath)) return {}

    try {
      const customDataRoot = readFileSync(installerConfigPath, 'utf8').trim()
      return customDataRoot ? { customDataRoot } : {}
    } catch {
      return {}
    }
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as DataLocationConfig
  } catch {
    return {}
  }
}

function getConfiguredDataRoot(defaultRoot = getDefaultDataRoot()): string | undefined {
  const config = readDataLocationConfig(defaultRoot)
  const customDataRoot = config.customDataRoot?.trim()
  return customDataRoot ? resolve(customDataRoot) : undefined
}

function resolveDataRoot(): string {
  const defaultRoot = getDefaultDataRoot()
  mkdirSync(defaultRoot, { recursive: true })

  const customDataRoot = getConfiguredDataRoot(defaultRoot)
  if (!customDataRoot) return defaultRoot

  try {
    mkdirSync(customDataRoot, { recursive: true })
    return customDataRoot
  } catch {
    return defaultRoot
  }
}

function getDataMode(): DataLocationInfo['mode'] {
  return getPortableDataRoot() ? 'portable' : 'normal'
}

function createDataLocationInfo(activePath: string): DataLocationInfo {
  const defaultPath = getDefaultDataRoot()
  const customPath = getConfiguredDataRoot(defaultPath)
  const effectivePath = customPath ?? defaultPath

  return {
    mode: getDataMode(),
    activePath,
    defaultPath,
    effectivePath,
    customPath,
    locatorPath: getDataLocationConfigPath(defaultPath),
    isCustom: Boolean(customPath),
    pendingRestart: !isSamePath(activePath, effectivePath)
  }
}

function assertWritableDirectory(path: string): void {
  mkdirSync(path, { recursive: true })
  const probe = join(path, `.gllm-write-test-${process.pid}-${Date.now()}`)
  writeFileSync(probe, 'ok')
  rmSync(probe, { force: true })
}

function isInWindowsProgramFiles(path: string): boolean {
  if (process.platform !== 'win32') return false

  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => resolve(item))

  return roots.some((root) => isSamePath(path, root) || isPathInside(path, root))
}

function assertSafeCustomDataRoot(targetRoot: string, activeRoot: string, defaultRoot: string): void {
  if (isSamePath(targetRoot, activeRoot) || isSamePath(targetRoot, defaultRoot)) return

  if (isPathInside(targetRoot, activeRoot) || isPathInside(activeRoot, targetRoot)) {
    throw new Error('数据目录不能选择当前数据目录的上级或子级，请选择一个独立文件夹。')
  }

  const appRoot = app.isPackaged ? dirname(process.execPath) : process.cwd()
  if (isSamePath(targetRoot, appRoot) || isPathInside(targetRoot, appRoot)) {
    throw new Error('数据目录不能放在程序安装目录内，请选择一个独立且可写的文件夹。')
  }

  if (isInWindowsProgramFiles(targetRoot)) {
    throw new Error('数据目录不能放在 Program Files 内，否则普通用户运行时可能无法写入。')
  }
}

function copyDataDirectory(sourceRoot: string, targetRoot: string): void {
  if (isSamePath(sourceRoot, targetRoot)) return

  mkdirSync(targetRoot, { recursive: true })
  const entries = existsSync(sourceRoot) ? readdirSync(sourceRoot) : []
  const backupRoot = join(targetRoot, `backup-before-gllm-migration-${Date.now()}`)
  let backupCreated = false

  for (const entry of entries) {
    if (entry === dataLocationFileName || entry === installerDataLocationFileName) continue

    const sourcePath = join(sourceRoot, entry)
    const targetPath = join(targetRoot, entry)
    if (isSamePath(sourcePath, targetPath)) continue

    if (existsSync(targetPath)) {
      if (!backupCreated) {
        mkdirSync(backupRoot, { recursive: true })
        backupCreated = true
      }
      cpSync(targetPath, join(backupRoot, entry), { recursive: true, force: true })
    }

    cpSync(sourcePath, targetPath, { recursive: true, force: true })
  }
}

function writeDataLocationConfig(customDataRoot?: string): void {
  const defaultRoot = getDefaultDataRoot()
  mkdirSync(defaultRoot, { recursive: true })
  const configPath = getDataLocationConfigPath(defaultRoot)
  const installerConfigPath = getInstallerDataLocationConfigPath(defaultRoot)

  if (!customDataRoot) {
    rmSync(configPath, { force: true })
    rmSync(installerConfigPath, { force: true })
    return
  }

  const config: DataLocationConfig = {
    customDataRoot: resolve(customDataRoot),
    updatedAt: Date.now()
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  rmSync(installerConfigPath, { force: true })
}

const activeDataRoot = resolveDataRoot()

export function getDataLocationInfo(): DataLocationInfo {
  return createDataLocationInfo(activeDataRoot)
}

export function migrateDataRoot(targetRoot: string): DataLocationChangeResult {
  const targetPath = resolve(targetRoot)
  const defaultRoot = getDefaultDataRoot()

  assertSafeCustomDataRoot(targetPath, activeDataRoot, defaultRoot)
  assertWritableDirectory(targetPath)

  if (isSamePath(targetPath, defaultRoot)) {
    return resetDataRoot()
  }

  if (isSamePath(targetPath, activeDataRoot)) {
    return {
      info: getDataLocationInfo(),
      changed: false,
      restartRequired: false,
      message: '当前已经在使用这个数据目录。'
    }
  }

  copyDataDirectory(activeDataRoot, targetPath)
  writeDataLocationConfig(targetPath)

  return {
    info: getDataLocationInfo(),
    changed: true,
    restartRequired: true,
    message: '已复制当前数据并设置新的数据目录，重启软件后生效。'
  }
}

export function adoptExistingDataRoot(targetRoot: string): DataLocationChangeResult {
  const targetPath = resolve(targetRoot)
  const defaultRoot = getDefaultDataRoot()

  assertSafeCustomDataRoot(targetPath, activeDataRoot, defaultRoot)
  assertWritableDirectory(targetPath)

  if (!existsSync(join(targetPath, storeFileName))) {
    throw new Error('未在该目录中发现 G-LLM 数据文件，请确认选择的是以前备份或迁移的数据目录。')
  }

  if (isSamePath(targetPath, activeDataRoot)) {
    return {
      info: getDataLocationInfo(),
      changed: false,
      restartRequired: false,
      message: '当前已经在使用这个数据目录。'
    }
  }

  if (isSamePath(targetPath, defaultRoot)) {
    writeDataLocationConfig(undefined)
  } else {
    writeDataLocationConfig(targetPath)
  }

  return {
    info: getDataLocationInfo(),
    changed: true,
    restartRequired: true,
    message: '已设置为使用已有数据目录，重启软件后生效。'
  }
}

export function resetDataRoot(): DataLocationChangeResult {
  const defaultRoot = getDefaultDataRoot()

  assertWritableDirectory(defaultRoot)
  if (!isSamePath(activeDataRoot, defaultRoot)) {
    copyDataDirectory(activeDataRoot, defaultRoot)
  }
  writeDataLocationConfig(undefined)

  return {
    info: getDataLocationInfo(),
    changed: !isSamePath(activeDataRoot, defaultRoot),
    restartRequired: !isSamePath(activeDataRoot, defaultRoot),
    message: isSamePath(activeDataRoot, defaultRoot)
      ? '当前已经在使用默认数据目录。'
      : '已复制当前数据并恢复默认目录，重启软件后生效。'
  }
}

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function shouldSkipArchiveEntry(relativePath: string): boolean {
  const normalized = normalizeArchivePath(relativePath)
  const [topLevel] = normalized.split('/')

  return (
    !normalized ||
    normalized === archiveManifestFileName ||
    topLevel === dataLocationFileName ||
    topLevel === installerDataLocationFileName ||
    topLevel.startsWith(importBackupPrefix) ||
    topLevel.startsWith(migrationBackupPrefix)
  )
}

function getSafeArchiveTargetPath(entryName: string): string | null {
  const normalized = normalizeArchivePath(entryName)
  if (shouldSkipArchiveEntry(normalized)) return null

  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..' || segment.includes(':') || segment.includes('\0'))) {
    throw new Error(`压缩包中包含不安全路径：${entryName}`)
  }

  const targetPath = resolve(activeDataRoot, ...segments)
  if (!isSamePath(targetPath, activeDataRoot) && !isPathInside(targetPath, activeDataRoot)) {
    throw new Error(`压缩包中包含越界路径：${entryName}`)
  }

  return targetPath
}

function addDirectoryToZip(zip: JSZip, rootPath: string, currentPath = rootPath): number {
  let fileCount = 0
  const entries = existsSync(currentPath) ? readdirSync(currentPath) : []

  for (const entry of entries) {
    const sourcePath = join(currentPath, entry)
    const relativePath = normalizeArchivePath(relative(rootPath, sourcePath))
    if (shouldSkipArchiveEntry(relativePath)) continue

    const stat = statSync(sourcePath)
    if (stat.isDirectory()) {
      fileCount += addDirectoryToZip(zip, rootPath, sourcePath)
      continue
    }

    if (!stat.isFile()) continue
    zip.file(relativePath, readFileSync(sourcePath), { date: stat.mtime })
    fileCount += 1
  }

  return fileCount
}

function backupAndClearActiveDataRoot(): string | undefined {
  const entries = existsSync(activeDataRoot) ? readdirSync(activeDataRoot) : []
  const backupRoot = join(activeDataRoot, `${importBackupPrefix}${Date.now()}`)
  let hasBackup = false

  for (const entry of entries) {
    if (shouldSkipArchiveEntry(entry)) continue

    const sourcePath = join(activeDataRoot, entry)
    if (!hasBackup) {
      mkdirSync(backupRoot, { recursive: true })
      hasBackup = true
    }

    cpSync(sourcePath, join(backupRoot, entry), { recursive: true, force: true })
    rmSync(sourcePath, { recursive: true, force: true })
  }

  return hasBackup ? backupRoot : undefined
}

export async function exportDataArchive(outputPath: string): Promise<DataArchiveResult> {
  const targetPath = resolve(outputPath)
  mkdirSync(dirname(targetPath), { recursive: true })

  const zip = new JSZip()
  zip.file(
    archiveManifestFileName,
    JSON.stringify(
      {
        app: 'G-LLM',
        format: 'g-llm-data-archive',
        version: 1,
        exportedAt: new Date().toISOString()
      },
      null,
      2
    )
  )

  const fileCount = addDirectoryToZip(zip, activeDataRoot)
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })

  writeFileSync(targetPath, content)

  return {
    path: targetPath,
    fileCount,
    byteSize: content.byteLength,
    message: `已导出 ${fileCount} 个数据文件。`
  }
}

export async function importDataArchive(archivePath: string): Promise<DataArchiveResult> {
  const sourcePath = resolve(archivePath)
  const zip = await JSZip.loadAsync(readFileSync(sourcePath))
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  const filesToExtract = entries
    .map((entry) => ({ entry, targetPath: getSafeArchiveTargetPath(entry.name) }))
    .filter((item): item is { entry: JSZip.JSZipObject; targetPath: string } => Boolean(item.targetPath))

  if (filesToExtract.length === 0) {
    throw new Error('压缩包中没有可导入的 G-LLM 数据文件。')
  }

  assertWritableDirectory(activeDataRoot)
  const backupPath = backupAndClearActiveDataRoot()

  for (const { entry, targetPath } of filesToExtract) {
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, await entry.async('nodebuffer'))
  }

  return {
    path: sourcePath,
    backupPath,
    fileCount: filesToExtract.length,
    restartRequired: true,
    message: `已导入 ${filesToExtract.length} 个数据文件，重启软件后生效。`
  }
}

export const defaultSettings: AppSettings = {
  activeProviderId: DEFAULT_PROVIDER_ID,
  temperature: 1,
  enableTemperature: false,
  maxTokens: 4096,
  enableMaxTokens: false,
  telemetryEnabled: true,
  setupCompleted: false
}

const store = new Store<StoreSchema>({
  name: 'g-llm-client',
  cwd: activeDataRoot,
  defaults: {
    settings: defaultSettings,
    providers: [],
    assistants: [],
    conversations: [],
    notes: [],
    memories: [],
    tools: [],
    installationId: ''
  }
})

function sanitizeProvider(provider: ApiProvider): ApiProvider {
  const now = Date.now()
  const fallbackModel = provider.defaultModel?.trim() || DEFAULT_PROVIDER.defaultModel
  const models = sanitizeModels(provider.models?.length ? provider.models : [{ id: fallbackModel }])
  const chatCompletionsPath = sanitizeEndpointPath(provider.chatCompletionsPath)
  const modelsPath = sanitizeEndpointPath(provider.modelsPath)

  return {
    ...DEFAULT_PROVIDER,
    ...provider,
    id: provider.id || DEFAULT_PROVIDER_ID,
    name: provider.name.trim() || '自定义供应商',
    apiBaseUrl: provider.apiBaseUrl.trim().replace(/\/$/, '') || DEFAULT_PROVIDER.apiBaseUrl,
    chatCompletionsPath,
    modelsPath,
    apiKey: provider.apiKey.trim(),
    defaultModel: provider.defaultModel.trim() || models[0]?.id || DEFAULT_PROVIDER.defaultModel,
    models,
    modelsUpdatedAt: provider.modelsUpdatedAt,
    requiresApiKey: provider.requiresApiKey,
    createdAt: provider.createdAt ?? now,
    updatedAt: now
  }
}

function sanitizeEndpointPath(value?: string): string | undefined {
  const path = value?.trim()
  if (!path) return undefined
  return path.startsWith('/') ? path : `/${path}`
}

function sanitizeModels(models: ProviderModel[] = []): ProviderModel[] {
  const seen = new Set<string>()
  const normalized: ProviderModel[] = []

  for (const model of models) {
    const id = model.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      name: model.name?.trim() || id,
      ownedBy: model.ownedBy?.trim(),
      capabilities: normalizeModelCapabilities({
        ...model,
        id
      }),
      type: model.type ?? inferModelType(id)
    })
  }

  return normalized.slice(0, 300)
}

function sanitizeTokenCount(value: unknown): number | undefined {
  const tokenCount = Number(value)
  return Number.isFinite(tokenCount) && tokenCount >= 0 ? Math.round(tokenCount) : undefined
}

function sanitizeAssistantAvatar(value: unknown): string | undefined {
  const avatarDataUrl = String(value ?? '').trim()
  if (!avatarDataUrl || !avatarDataUrl.startsWith('data:image/')) return undefined

  return avatarDataUrl.length <= 1_000_000 ? avatarDataUrl : undefined
}

function sanitizeAttachment(attachment: PreparedAttachment): PreparedAttachment | null {
  const name = String(attachment.name ?? '').trim()
  if (!name) return null

  const kind = attachment.kind === 'image' ? 'image' : 'file'
  const text = attachment.text ? String(attachment.text).slice(0, 40_000) : undefined
  const dataUrl = attachment.dataUrl && attachment.dataUrl.startsWith('data:image/') ? attachment.dataUrl : undefined

  return {
    id: attachment.id?.trim() || `att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name,
    mimeType: String(attachment.mimeType ?? '').trim() || (kind === 'image' ? 'image/*' : 'application/octet-stream'),
    size: Number.isFinite(attachment.size) ? Math.max(0, Number(attachment.size)) : 0,
    kind,
    text,
    dataUrl
  }
}

function sanitizeKnowledgeReference(reference: KnowledgeReference): KnowledgeReference | null {
  const title = String(reference.title ?? '').trim()
  const content = String(reference.content ?? '').trim()
  if (!title || !content) return null

  return {
    id: reference.id?.trim() || `know_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    title: title.slice(0, 80),
    content: content.slice(0, 20_000)
  }
}

function sanitizeWebSearchResult(result: WebSearchResult): WebSearchResult | null {
  const title = String(result.title ?? '').trim()
  const url = String(result.url ?? '').trim()
  if (!title || !/^https?:\/\//i.test(url)) return null

  return {
    title: title.slice(0, 160),
    url: url.slice(0, 1000),
    snippet: result.snippet ? String(result.snippet).trim().slice(0, 500) : undefined,
    excerpt: result.excerpt ? String(result.excerpt).trim().slice(0, 1000) : undefined
  }
}

function sanitizeWebSearchActivity(activity?: WebSearchActivity): WebSearchActivity | undefined {
  if (!activity) return undefined

  const query = String(activity.query ?? '').trim()
  if (!query) return undefined

  const statusOptions: WebSearchActivity['status'][] = ['planning', 'searching', 'completed', 'failed']
  const status = statusOptions.includes(activity.status) ? activity.status : 'completed'
  const results = (activity.results ?? [])
    .map(sanitizeWebSearchResult)
    .filter((result): result is WebSearchResult => Boolean(result))
    .slice(0, 8)
  const queries = Array.isArray(activity.queries)
    ? activity.queries.map((query) => String(query).trim().slice(0, 120)).filter(Boolean).slice(0, 4)
    : undefined

  return {
    status,
    query: query.slice(0, 300),
    intent: activity.intent ? String(activity.intent).trim().slice(0, 180) : undefined,
    queries,
    results,
    error: activity.error ? String(activity.error).trim().slice(0, 300) : undefined,
    searchedAt: Number.isFinite(activity.searchedAt) ? Number(activity.searchedAt) : undefined
  }
}

function sanitizeMessage(message: ChatMessage): ChatMessage {
  const role = message.role === 'assistant' || message.role === 'user' || message.role === 'system' ? message.role : 'user'
  const translation = message.translation?.trim()
  const attachments = (message.attachments ?? [])
    .map(sanitizeAttachment)
    .filter((attachment): attachment is PreparedAttachment => Boolean(attachment))
    .slice(0, 8)
  const knowledgeRefs = (message.knowledgeRefs ?? [])
    .map(sanitizeKnowledgeReference)
    .filter((reference): reference is KnowledgeReference => Boolean(reference))
    .slice(0, 8)

  return {
    id: message.id?.trim() || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    role,
    content: String(message.content ?? ''),
    attachments: attachments.length > 0 ? attachments : undefined,
    knowledgeRefs: knowledgeRefs.length > 0 ? knowledgeRefs : undefined,
    webSearch: sanitizeWebSearchActivity(message.webSearch),
    translation: translation || undefined,
    tokenCount: sanitizeTokenCount(message.tokenCount),
    inputTokens: sanitizeTokenCount(message.inputTokens),
    outputTokens: sanitizeTokenCount(message.outputTokens),
    createdAt: Number.isFinite(message.createdAt) ? Number(message.createdAt) : Date.now()
  }
}

function sanitizeConversation(conversation: Conversation): Conversation {
  const now = Date.now()
  const messages = (conversation.messages ?? []).map(sanitizeMessage)
  const totalTokens =
    sanitizeTokenCount(conversation.totalTokens) ??
    messages.reduce((sum, message) => sum + (sanitizeTokenCount(message.tokenCount) ?? 0), 0)
  const totalInputTokens =
    sanitizeTokenCount(conversation.totalInputTokens) ??
    messages.reduce((sum, message) => sum + (sanitizeTokenCount(message.inputTokens) ?? 0), 0)
  const totalOutputTokens =
    sanitizeTokenCount(conversation.totalOutputTokens) ??
    messages.reduce((sum, message) => sum + (sanitizeTokenCount(message.outputTokens) ?? 0), 0)

  return {
    ...conversation,
    id: conversation.id?.trim() || `conv_${now}_${Math.random().toString(16).slice(2)}`,
    assistantId: conversation.assistantId?.trim() || DEFAULT_ASSISTANTS[0].id,
    title: conversation.title?.trim() || '新会话',
    messages,
    modelProviderId: conversation.modelProviderId?.trim() || undefined,
    modelId: conversation.modelId?.trim() || undefined,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    createdAt: Number.isFinite(conversation.createdAt) ? Number(conversation.createdAt) : now,
    updatedAt: Number.isFinite(conversation.updatedAt) ? Number(conversation.updatedAt) : now
  }
}

function sanitizeNote(note: KnowledgeNote): KnowledgeNote {
  const now = Date.now()
  const content = String(note.content ?? '').trim()

  return {
    id: note.id?.trim() || `note_${now}_${Math.random().toString(16).slice(2)}`,
    title: String(note.title ?? '').trim() || content.slice(0, 32) || '未命名笔记',
    content,
    assistantId: note.assistantId?.trim() || undefined,
    conversationId: note.conversationId?.trim() || undefined,
    messageId: note.messageId?.trim() || undefined,
    createdAt: Number.isFinite(note.createdAt) ? Number(note.createdAt) : now,
    updatedAt: Number.isFinite(note.updatedAt) ? Number(note.updatedAt) : now
  }
}

function sanitizeMemory(memory: AssistantMemory): AssistantMemory | null {
  const now = Date.now()
  const content = String(memory.content ?? '').trim()
  const assistantId = String(memory.assistantId ?? '').trim()
  if (!assistantId || !content) return null

  return {
    id: memory.id?.trim() || `memory_${now}_${Math.random().toString(16).slice(2)}`,
    assistantId,
    content: content.slice(0, 4000),
    enabled: Boolean(memory.enabled),
    sourceNoteId: memory.sourceNoteId?.trim() || undefined,
    sourceMessageId: memory.sourceMessageId?.trim() || undefined,
    createdAt: Number.isFinite(memory.createdAt) ? Number(memory.createdAt) : now,
    updatedAt: now
  }
}

function sanitizeTool(tool: ToolConfig): ToolConfig {
  const now = Date.now()
  const typeOptions: ToolConfigType[] = ['function', 'mcp', 'plugin']
  const type = typeOptions.includes(tool.type) ? tool.type : 'function'

  return {
    id: tool.id?.trim() || `tool_${now}_${Math.random().toString(16).slice(2)}`,
    type,
    name: String(tool.name ?? '').trim() || (type === 'mcp' ? 'MCP 服务' : type === 'plugin' ? '外部插件' : '函数工具'),
    description: String(tool.description ?? '').trim().slice(0, 600) || undefined,
    endpoint: String(tool.endpoint ?? '').trim().slice(0, 1000) || undefined,
    enabled: Boolean(tool.enabled),
    createdAt: Number.isFinite(tool.createdAt) ? Number(tool.createdAt) : now,
    updatedAt: now
  }
}

function getMigratedDefaultProvider(): ApiProvider {
  const legacy = store.get('settings', defaultSettings) as LegacySettings
  const legacyUrl = legacy.apiBaseUrl?.trim()
  const apiBaseUrl = legacyUrl && legacyUrl !== 'https://api.g-llm.com/v1' ? legacyUrl : DEFAULT_PROVIDER.apiBaseUrl

  return sanitizeProvider({
    ...DEFAULT_PROVIDER,
    apiBaseUrl,
    apiKey: legacy.apiKey ?? '',
    defaultModel: legacy.defaultModel?.trim() || DEFAULT_PROVIDER.defaultModel
  })
}

export function getProviders(): ApiProvider[] {
  const providers = store.get('providers', [])
  const normalized = providers.map(sanitizeProvider)
  const hasDefaultProvider = normalized.some((provider) => provider.id === DEFAULT_PROVIDER_ID)

  if (normalized.length === 0) {
    return [getMigratedDefaultProvider()]
  }

  return hasDefaultProvider ? normalized : [getMigratedDefaultProvider(), ...normalized]
}

export function saveProvider(provider: ApiProvider): ApiProvider {
  const normalized = sanitizeProvider(provider)
  const providers = getProviders()
  const next = [normalized, ...providers.filter((item) => item.id !== normalized.id)]
  store.set('providers', next.slice(0, 40))
  return normalized
}

export function deleteProvider(id: string): void {
  if (id === DEFAULT_PROVIDER_ID) return

  store.set(
    'providers',
    getProviders().filter((provider) => provider.id !== id)
  )

  const settings = getSettings()
  if (settings.activeProviderId === id) {
    setSettings({ ...settings, activeProviderId: DEFAULT_PROVIDER_ID })
  }
}

function sanitizeAssistant(assistant: Assistant): Assistant {
  const now = Date.now()
  const starterPrompts = assistant.starterPrompts
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(0, 6)

  return {
    ...assistant,
    builtIn: Boolean(assistant.builtIn),
    name: assistant.name.trim() || '未命名助手',
    title: assistant.title.trim() || '自定义助手',
    tone: assistant.tone.trim() || '专属助手',
    color: assistantColors.includes(assistant.color) ? assistant.color : 'ink',
    icon: assistantIcons.includes(assistant.icon) ? assistant.icon : 'sparkles',
    avatarDataUrl: sanitizeAssistantAvatar(assistant.avatarDataUrl),
    modelProviderId: assistant.modelProviderId?.trim() || undefined,
    modelId: assistant.modelId?.trim() || undefined,
    systemPrompt:
      assistant.systemPrompt.trim() ||
      '你是无极界 G-LLM 的专业助手。请用清晰、准确、可执行的方式帮助用户完成任务。',
    starterPrompts: starterPrompts.length > 0 ? starterPrompts : ['帮我分析这个问题', '帮我写一份方案', '把下面内容整理清楚'],
    createdAt: assistant.createdAt ?? now,
    updatedAt: now
  }
}

export function getSettings(): AppSettings {
  const saved = store.get('settings', defaultSettings) as LegacySettings
  const providers = getProviders()
  const activeProviderId =
    saved.activeProviderId && providers.some((provider) => provider.id === saved.activeProviderId)
      ? saved.activeProviderId
      : DEFAULT_PROVIDER_ID

  return {
    ...defaultSettings,
    activeProviderId,
    temperature: Number.isFinite(saved.temperature)
      ? Math.min(2, Math.max(0, Number(saved.temperature)))
      : defaultSettings.temperature,
    enableTemperature: Boolean(saved.enableTemperature),
    maxTokens: Number.isFinite(saved.maxTokens) ? Math.max(1, Math.round(Number(saved.maxTokens))) : defaultSettings.maxTokens,
    enableMaxTokens: Boolean(saved.enableMaxTokens),
    telemetryEnabled:
      saved.telemetryEnabled === undefined ? defaultSettings.telemetryEnabled : Boolean(saved.telemetryEnabled),
    setupCompleted: Boolean(saved.setupCompleted)
  }
}

export function setSettings(settings: AppSettings): AppSettings {
  const providers = getProviders()
  const activeProviderId = providers.some((provider) => provider.id === settings.activeProviderId)
    ? settings.activeProviderId
    : DEFAULT_PROVIDER_ID

  const normalized: AppSettings = {
    ...defaultSettings,
    ...settings,
    activeProviderId,
    temperature: Number.isFinite(settings.temperature)
      ? Math.min(2, Math.max(0, Number(settings.temperature)))
      : defaultSettings.temperature,
    enableTemperature: Boolean(settings.enableTemperature),
    maxTokens: Number.isFinite(settings.maxTokens)
      ? Math.max(1, Math.round(Number(settings.maxTokens)))
      : defaultSettings.maxTokens,
    enableMaxTokens: Boolean(settings.enableMaxTokens),
    telemetryEnabled:
      settings.telemetryEnabled === undefined ? defaultSettings.telemetryEnabled : Boolean(settings.telemetryEnabled),
    setupCompleted: settings.setupCompleted
  }

  store.set('settings', normalized)
  return normalized
}

export function getInstallationId(): string {
  const existing = store.get('installationId', '').trim()
  if (existing) return existing

  const installationId = randomUUID()
  store.set('installationId', installationId)
  return installationId
}

export function getCustomAssistants(): Assistant[] {
  return store.get('assistants', [])
}

export function getAssistants(): Assistant[] {
  const savedAssistants = getCustomAssistants()
  const defaultIds = new Set(DEFAULT_ASSISTANTS.map((assistant) => assistant.id))
  const savedById = new Map(savedAssistants.map((assistant) => [assistant.id, assistant]))
  const defaults = DEFAULT_ASSISTANTS.map((assistant) => {
    const saved = savedById.get(assistant.id)
    return saved ? { ...assistant, ...saved, builtIn: true } : assistant
  })
  const custom = savedAssistants.filter((assistant) => !defaultIds.has(assistant.id))

  return [...defaults, ...custom]
}

export function saveAssistant(assistant: Assistant): Assistant {
  const normalized = sanitizeAssistant(assistant)
  const assistants = getCustomAssistants()
  const next = [normalized, ...assistants.filter((item) => item.id !== normalized.id)]
  store.set('assistants', next.slice(0, 80))
  return normalized
}

export function deleteAssistant(id: string): void {
  if (DEFAULT_ASSISTANTS.some((assistant) => assistant.id === id)) return

  store.set(
    'assistants',
    getCustomAssistants().filter((assistant) => assistant.id !== id)
  )
}

export function getConversations(): Conversation[] {
  return store.get('conversations', []).map(sanitizeConversation)
}

export function saveConversation(conversation: Conversation): Conversation {
  const normalized = sanitizeConversation(conversation)
  const conversations = getConversations()
  const next = [normalized, ...conversations.filter((item) => item.id !== normalized.id)]
  store.set('conversations', next.slice(0, 100))
  return normalized
}

export function deleteConversation(id: string): void {
  store.set(
    'conversations',
    getConversations().filter((conversation) => conversation.id !== id)
  )
}

export function getNotes(): KnowledgeNote[] {
  return store.get('notes', []).map(sanitizeNote).filter((note) => note.content)
}

export function saveNote(note: KnowledgeNote): KnowledgeNote {
  const normalized = sanitizeNote(note)
  const notes = getNotes()
  const next = [normalized, ...notes.filter((item) => item.id !== normalized.id)]
  store.set('notes', next.slice(0, 500))
  return normalized
}

export function deleteNote(id: string): void {
  store.set(
    'notes',
    getNotes().filter((note) => note.id !== id)
  )
}

export function getMemories(): AssistantMemory[] {
  return store
    .get('memories', [])
    .map(sanitizeMemory)
    .filter((memory): memory is AssistantMemory => Boolean(memory))
}

export function saveMemory(memory: AssistantMemory): AssistantMemory {
  const normalized = sanitizeMemory(memory)
  if (!normalized) throw new Error('记忆内容不能为空')

  const memories = getMemories()
  const next = [normalized, ...memories.filter((item) => item.id !== normalized.id)]
  store.set('memories', next.slice(0, 300))
  return normalized
}

export function deleteMemory(id: string): void {
  store.set(
    'memories',
    getMemories().filter((memory) => memory.id !== id)
  )
}

export function getTools(): ToolConfig[] {
  return store.get('tools', []).map(sanitizeTool)
}

export function saveTool(tool: ToolConfig): ToolConfig {
  const normalized = sanitizeTool(tool)
  const tools = getTools()
  const next = [normalized, ...tools.filter((item) => item.id !== normalized.id)]
  store.set('tools', next.slice(0, 80))
  return normalized
}

export function deleteTool(id: string): void {
  store.set(
    'tools',
    getTools().filter((tool) => tool.id !== id)
  )
}
