import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { app } from 'electron'
import JSZip from 'jszip'
import mammoth from 'mammoth'

import type {
  ChatMessage,
  WorkspaceAgentProgress,
  WorkspaceAgentRequest,
  WorkspaceAgentResult,
  WorkspaceToolActivity
} from '../shared/types'
import { compressImageToTarget, renderPdfToTarget } from './localFileTasks'
import { getConversationProjectMemoryContext, prepareConversationContext } from './gllmClient'

type AgentMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: AgentMessageContent | null
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const workspaceRunLocks = new Map<string, string>()

const toolDefinitions = [
  { type: 'function', function: { name: 'list_directory', description: '列出工作区内目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对工作区路径，默认 .' } } } } },
  { type: 'function', function: { name: 'inspect_file', description: '检查文件或目录的类型、大小和修改时间', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'read_file', description: '读取工作区内 UTF-8 文本文件', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'read_document', description: '提取工作区内 PDF、Word（.docx）或 PowerPoint（.pptx）的正文文本，适合阅读和分析文档；返回内容可能因长度限制而截断', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'write_file', description: '在工作区内创建或完整写入 UTF-8 文本文件', parameters: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } } },
  { type: 'function', function: { name: 'replace_text', description: '精确替换文本文件中的一段内容；适合修改代码并避免重写整文件', parameters: { type: 'object', required: ['path', 'oldText', 'newText'], properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, replaceAll: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'create_directory', description: '在工作区内创建目录', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'move_file', description: '移动或重命名工作区内文件，不覆盖已有目标', parameters: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } } },
  { type: 'function', function: { name: 'search_files', description: '按文件名和可选文本内容搜索工作区', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, path: { type: 'string' }, includeContent: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'compress_image', description: '把工作区内图片压缩到指定字节数，输出为 JPEG', parameters: { type: 'object', required: ['source', 'output', 'targetBytes'], properties: { source: { type: 'string' }, output: { type: 'string' }, targetBytes: { type: 'number' } } } } },
  { type: 'function', function: { name: 'compress_pdf', description: '在不超过目标大小的前提下搜索分辨率和 JPEG 质量，选择画质最高的 PDF；会丢失文本搜索、表单、链接和签名。minimumBytes 只是接近上限的画质偏好，绝不能通过填充无意义字节满足。', parameters: { type: 'object', required: ['source', 'output', 'targetBytes'], properties: { source: { type: 'string' }, output: { type: 'string' }, targetBytes: { type: 'number' }, minimumBytes: { type: 'number', description: '可选的期望最小大小，仅用于从真实压缩候选中择优' } } } } },
  { type: 'function', function: { name: 'run_javascript', description: '在隔离执行器中运行临时 JavaScript，适合没有专用工具的批量文件、文本、JSON、CSV 和代码处理任务。代码中可使用异步 workspace API：list(path,{recursive,limit})、stat(path)、readText(path)、writeText(path,content)、readBase64(path)、writeBase64(path,base64)、mkdir(path)、copy(from,to)、move(from,to)，以及 console.log。不能使用 import、require、process、网络、系统命令或工作区外路径。最后可 return 简短结果。', parameters: { type: 'object', required: ['purpose', 'code'], properties: { purpose: { type: 'string', description: '本次脚本要完成的工作' }, code: { type: 'string', description: '直接执行的 JavaScript 代码；顶层可使用 await 和 return' } } } } },
  { type: 'function', function: { name: 'generate_image', description: '使用当前供应商的图片生成接口生成图片并保存到工作区', parameters: { type: 'object', required: ['prompt', 'output'], properties: { prompt: { type: 'string' }, output: { type: 'string', description: '建议使用 .png 文件名' } } } } }
]

function providerUrl(request: WorkspaceAgentRequest): string {
  const path = request.provider.chatCompletionsPath ?? '/chat/completions'
  return `${request.provider.apiBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function ensureRelativePath(input: unknown): string {
  const value = String(input ?? '.').trim() || '.'
  if (isAbsolute(value)) throw new Error('工具只能使用工作区相对路径')
  return value
}

function isInside(child: string, root: string): boolean {
  const diff = relative(root, child)
  return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))
}

async function resolveExisting(root: string, input: unknown): Promise<string> {
  const rootReal = await realpath(root)
  const target = await realpath(resolve(rootReal, ensureRelativePath(input)))
  if (!isInside(target, rootReal)) throw new Error('路径超出当前会话工作区')
  return target
}

export async function resolveWorkspaceItem(root: string, relativePath: string): Promise<string> {
  return resolveExisting(root, relativePath)
}

async function resolveWritable(root: string, input: unknown): Promise<string> {
  const rootReal = await realpath(root)
  const target = resolve(rootReal, ensureRelativePath(input))
  const parentReal = await realpath(dirname(target))
  if (!isInside(parentReal, rootReal) || !isInside(target, rootReal)) throw new Error('路径超出当前会话工作区')
  return target
}

async function walkFiles(root: string, start: string, limit = 400): Promise<string[]> {
  const results: string[] = []
  const pending = [start]
  while (pending.length > 0 && results.length < limit) {
    const current = pending.shift()!
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (['.git', '.gllm', 'node_modules', 'dist', 'out'].includes(entry.name)) continue
      const fullPath = resolve(current, entry.name)
      if (entry.isDirectory()) pending.push(fullPath)
      else if (entry.isFile()) results.push(relative(root, fullPath))
      if (results.length >= limit) break
    }
  }
  return results
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function extractDocumentText(path: string): Promise<string> {
  const extension = extname(path).toLocaleLowerCase()
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ path })
    return result.value
  }
  if (extension === '.pptx') {
    const archive = await JSZip.loadAsync(await readFile(path))
    const slides = Object.keys(archive.files)
      .map((name) => ({ name, match: name.match(/^ppt\/slides\/slide(\d+)\.xml$/i) }))
      .filter((item): item is { name: string; match: RegExpMatchArray } => Boolean(item.match))
      .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
    const pages: string[] = []
    for (const slide of slides.slice(0, 300)) {
      const xml = await archive.file(slide.name)?.async('text') ?? ''
      const lines = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi))
        .map((match) => decodeXmlText(match[1]).trim())
        .filter(Boolean)
      pages.push(`[第 ${Number(slide.match[1])} 页]\n${lines.join('\n') || '[无可提取文字]'}`)
    }
    return pages.join('\n\n')
  }
  if (extension === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: await readFile(path) })
    try {
      return (await parser.getText()).text
    } finally {
      await parser.destroy()
    }
  }
  throw new Error('read_document 当前支持 .pdf、.docx 和 .pptx')
}

async function snapshotWorkspace(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  for (const file of await walkFiles(root, root, 5000)) {
    try {
      const info = await stat(resolve(root, file))
      snapshot.set(file, `${info.size}:${info.mtimeMs}`)
    } catch { /* file changed while taking the snapshot */ }
  }
  return snapshot
}

function workspaceRunnerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'workspace-script-runner.cjs')
    : join(app.getAppPath(), 'resources', 'workspace-script-runner.cjs')
}

async function runWorkspaceJavascript(root: string, code: string, purpose: string): Promise<{ output: string; changedFiles: string[] }> {
  if (!code.trim()) throw new Error('脚本代码不能为空')
  if (Buffer.byteLength(code) > 120_000) throw new Error('单次脚本不能超过 120 KB')
  if (/pdf|压缩|文件大小|字节|byte|resize/i.test(purpose) && /writeBase64\s*\(/i.test(code)) {
    throw new Error('禁止用通用脚本覆写或填充 PDF 二进制数据；请使用 compress_pdf 进行真实画质压缩')
  }
  const before = await snapshotWorkspace(root)
  const runDirectory = resolve(root, '.gllm', 'runs')
  await mkdir(runDirectory, { recursive: true })
  const scriptPath = resolve(runDirectory, `${Date.now()}-${randomUUID()}.js`)
  await writeFile(scriptPath, code, 'utf8')
  const runner = workspaceRunnerPath()

  const execution = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      '--permission',
      `--allow-fs-read=${root}`,
      `--allow-fs-read=${runner}`,
      `--allow-fs-write=${root}`,
      runner,
      root,
      scriptPath
    ], {
      cwd: root,
      windowsHide: true,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        LANG: process.env.LANG ?? 'zh_CN.UTF-8',
        LC_ALL: process.env.LC_ALL ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? '',
        TMPDIR: process.env.TMPDIR ?? ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-80_000)
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('脚本运行超过 30 秒，已终止'))
    }, 30_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (exitCode) => {
      clearTimeout(timeout)
      if (exitCode !== 0) reject(new Error(`脚本运行失败：${stderr.trim().slice(-4000) || `退出码 ${exitCode}`}`))
      else resolvePromise({ stdout, stderr })
    })
  })

  const after = await snapshotWorkspace(root)
  const changedFiles = Array.from(after.entries())
    .filter(([file, signature]) => before.get(file) !== signature)
    .map(([file]) => file)
    .slice(0, 200)
  let summary = execution.stdout.trim()
  try {
    const payload = JSON.parse(summary) as { result?: unknown; logs?: string[] }
    summary = [
      ...(payload.logs ?? []).slice(-30),
      ...(payload.result === null || payload.result === undefined ? [] : [`返回结果：${typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)}`])
    ].join('\n')
  } catch { /* keep raw output for diagnostics */ }
  const fileSummary = changedFiles.length > 0 ? `\n生成或修改：${changedFiles.join('、')}` : '\n未检测到文件变化'
  return { output: `脚本任务：${purpose.trim().slice(0, 300) || '处理工作区文件'}\n${summary || '脚本执行完成'}${fileSummary}`.slice(0, 12_000), changedFiles }
}

async function executeTool(request: WorkspaceAgentRequest, root: string, permission: 'read' | 'read-write', name: string, args: Record<string, unknown>): Promise<{ output: string; changedFile?: string; changedFiles?: string[] }> {
  const requireWrite = () => {
    if (permission !== 'read-write') throw new Error('当前会话只有读取权限')
  }
  if (name === 'list_directory') {
    const target = await resolveExisting(root, args.path)
    const entries = await readdir(target, { withFileTypes: true })
    return { output: entries.slice(0, 300).map((entry) => `${entry.isDirectory() ? '[目录]' : '[文件]'} ${entry.name}`).join('\n') || '[空目录]' }
  }
  if (name === 'inspect_file') {
    const target = await resolveExisting(root, args.path)
    const info = await stat(target)
    return { output: JSON.stringify({ path: relative(root, target) || '.', type: info.isDirectory() ? 'directory' : 'file', size: info.size, modifiedAt: info.mtime.toISOString() }) }
  }
  if (name === 'read_file') {
    const target = await resolveExisting(root, args.path)
    const info = await stat(target)
    if (!info.isFile()) throw new Error('目标不是文件')
    if (info.size > 512_000) throw new Error('文本文件超过 500 KiB，请先缩小读取范围')
    return { output: (await readFile(target, 'utf8')).slice(0, 300_000) }
  }
  if (name === 'read_document') {
    const target = await resolveExisting(root, args.path)
    const info = await stat(target)
    if (!info.isFile()) throw new Error('目标不是文件')
    if (info.size > 80 * 1024 * 1024) throw new Error('文档超过 80 MB，当前版本不自动读取')
    const text = await extractDocumentText(target)
    if (!text.trim()) throw new Error('文档中没有提取到可读文字，可能是扫描件或纯图片文档')
    const truncated = text.length > 350_000
    return { output: `${text.slice(0, 350_000)}${truncated ? '\n\n[内容过长，已截断]' : ''}` }
  }
  if (name === 'write_file') {
    requireWrite()
    const target = await resolveWritable(root, args.path)
    const content = String(args.content ?? '')
    if (Buffer.byteLength(content) > 1_000_000) throw new Error('单次写入不能超过 1 MB')
    await writeFile(target, content, { encoding: 'utf8', flag: 'w' })
    return { output: `已写入 ${relative(root, target)}（${Buffer.byteLength(content)} 字节）`, changedFile: relative(root, target) }
  }
  if (name === 'replace_text') {
    requireWrite()
    const target = await resolveExisting(root, args.path)
    const oldText = String(args.oldText ?? '')
    const newText = String(args.newText ?? '')
    if (!oldText) throw new Error('oldText 不能为空')
    const content = await readFile(target, 'utf8')
    const occurrences = content.split(oldText).length - 1
    if (occurrences === 0) throw new Error('没有找到要替换的原文')
    if (!args.replaceAll && occurrences > 1) throw new Error(`原文出现 ${occurrences} 次，请提供更精确的上下文或使用 replaceAll`)
    const next = args.replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText)
    await writeFile(target, next, 'utf8')
    return { output: `已修改 ${relative(root, target)}，替换 ${args.replaceAll ? occurrences : 1} 处`, changedFile: relative(root, target) }
  }
  if (name === 'create_directory') {
    requireWrite()
    const target = resolve(await realpath(root), ensureRelativePath(args.path))
    if (!isInside(target, await realpath(root))) throw new Error('路径超出当前会话工作区')
    await mkdir(target, { recursive: true })
    return { output: `已创建目录 ${relative(root, target)}` }
  }
  if (name === 'move_file') {
    requireWrite()
    const from = await resolveExisting(root, args.from)
    const to = await resolveWritable(root, args.to)
    await rename(from, to)
    return { output: `已移动 ${relative(root, from)} → ${relative(root, to)}`, changedFile: relative(root, to) }
  }
  if (name === 'search_files') {
    const start = await resolveExisting(root, args.path)
    const query = String(args.query ?? '').toLocaleLowerCase()
    if (!query) throw new Error('搜索关键词不能为空')
    const files = await walkFiles(await realpath(root), start)
    const matched: string[] = []
    for (const file of files) {
      if (file.toLocaleLowerCase().includes(query)) matched.push(file)
      else if (args.includeContent) {
        try {
          const full = await resolveExisting(root, file)
          const info = await stat(full)
          if (info.size <= 256_000 && (await readFile(full, 'utf8')).toLocaleLowerCase().includes(query)) matched.push(file)
        } catch { /* binary or unreadable file */ }
      }
      if (matched.length >= 100) break
    }
    return { output: matched.join('\n') || '未找到匹配文件' }
  }
  if (name === 'compress_image' || name === 'compress_pdf') {
    requireWrite()
    const source = await resolveExisting(root, args.source)
    const output = await resolveWritable(root, args.output)
    const targetBytes = Math.max(10_000, Math.min(100 * 1024 * 1024, Number(args.targetBytes) || 2 * 1024 * 1024))
    const minimumBytes = Math.max(0, Math.min(targetBytes, Number(args.minimumBytes) || 0))
    const buffer = name === 'compress_pdf'
      ? await renderPdfToTarget(source, targetBytes, undefined, minimumBytes)
      : await compressImageToTarget(source, targetBytes)
    await writeFile(output, buffer, { flag: 'wx' })
    const info = await stat(output)
    if (info.size > targetBytes) throw new Error('输出文件仍超过目标大小')
    return { output: `已生成 ${relative(root, output)}（${info.size} 字节，目标不超过 ${targetBytes} 字节）`, changedFile: relative(root, output) }
  }
  if (name === 'run_javascript') {
    requireWrite()
    return runWorkspaceJavascript(root, String(args.code ?? ''), String(args.purpose ?? ''))
  }
  if (name === 'generate_image') {
    requireWrite()
    const prompt = String(args.prompt ?? '').trim()
    if (!prompt) throw new Error('图片提示词不能为空')
    const output = await resolveWritable(root, args.output)
    const path = request.provider.imageGenerationsPath ?? '/images/generations'
    const endpoint = `${request.provider.apiBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ...(request.provider.apiKey ? { Authorization: `Bearer ${request.provider.apiKey}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.provider.defaultModel, prompt, n: 1, response_format: 'b64_json' }),
      signal: AbortSignal.timeout(180_000)
    })
    if (!response.ok) throw new Error(`图片生成失败：${response.status} ${(await response.text()).slice(0, 240)}`)
    const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
    const item = payload.data?.[0]
    let buffer: Buffer
    if (item?.b64_json) buffer = Buffer.from(item.b64_json, 'base64')
    else if (item?.url && /^https?:\/\//i.test(item.url)) {
      const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(120_000) })
      if (!imageResponse.ok) throw new Error(`生成图片下载失败：${imageResponse.status}`)
      buffer = Buffer.from(await imageResponse.arrayBuffer())
    } else throw new Error('图片生成接口没有返回图片数据')
    const image = await loadImage(buffer)
    const canvas = createCanvas(image.width, image.height)
    canvas.getContext('2d').drawImage(image, 0, 0)
    const normalized = canvas.toBuffer('image/png')
    await writeFile(output, normalized, { flag: 'wx' })
    return { output: `已生成图片 ${relative(root, output)}（${normalized.length} 字节）`, changedFile: relative(root, output) }
  }
  throw new Error(`不支持的工具：${name}`)
}

function activityLabel(tool: string): string {
  return ({ list_directory: '查看目录', inspect_file: '检查文件', read_file: '读取文件', read_document: '读取文档正文', write_file: '写入文件', replace_text: '修改文件', create_directory: '创建目录', move_file: '移动文件', search_files: '搜索文件', compress_image: '压缩图片', compress_pdf: '压缩 PDF', run_javascript: '运行临时脚本', generate_image: '生成图片' } as Record<string, string>)[tool] ?? tool
}

function extractJson(value: string): Record<string, unknown> | null {
  const candidate = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value.match(/\{[\s\S]*\}/)?.[0] ?? ''
  try { return JSON.parse(candidate) as Record<string, unknown> } catch { return null }
}

function selectRecentImageAttachments(messages: ChatMessage[]): Set<string> {
  const selected = new Set<string>()
  let totalBytes = 0
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const attachments = messages[messageIndex].attachments ?? []
    for (let attachmentIndex = attachments.length - 1; attachmentIndex >= 0; attachmentIndex -= 1) {
      const attachment = attachments[attachmentIndex]
      if (attachment.kind !== 'image' || !attachment.dataUrl || selected.size >= 4) continue
      if (totalBytes + attachment.size > 12 * 1024 * 1024) continue
      selected.add(attachment.id)
      totalBytes += attachment.size
    }
    if (selected.size >= 4) break
  }
  return selected
}

function toAgentMessageContent(message: ChatMessage, selectedImages: Set<string>): AgentMessageContent {
  const textSections = [message.content]
  for (const attachment of message.attachments ?? []) {
    if (attachment.text?.trim()) {
      textSections.push(`[附件正文：${attachment.name}]\n${attachment.text.slice(0, 120_000)}`)
    } else if (attachment.kind === 'image' && !selectedImages.has(attachment.id)) {
      textSections.push(`[图片附件：${attachment.name}，本轮未重复发送图片数据]`)
    } else if (attachment.kind !== 'image') {
      textSections.push(`[附件：${attachment.name}，未提取到正文]`)
    }
  }
  for (const reference of message.knowledgeRefs ?? []) {
    textSections.push(`[引用资料：${reference.title}]\n${reference.content.slice(0, 80_000)}`)
  }
  if (message.workspaceChangedFiles?.length) {
    textSections.push(`[该轮生成或修改的文件]\n${message.workspaceChangedFiles.slice(0, 50).join('\n')}`)
  }
  const completedActivities = (message.workspaceActivities ?? [])
    .filter((activity) => activity.status !== 'running')
    .slice(-12)
    .map((activity) => `${activity.label}：${activity.status === 'failed' ? '失败' : '完成'}${activity.detail ? `；${activity.detail}` : ''}`)
  if (completedActivities.length) {
    textSections.push(`[该轮工作区操作]\n${completedActivities.join('\n')}`)
  }
  const text = textSections.filter(Boolean).join('\n\n') || '[空消息]'
  const images = (message.attachments ?? [])
    .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl && selectedImages.has(attachment.id))
    .map((attachment) => ({ type: 'image_url' as const, image_url: { url: attachment.dataUrl! } }))
  return images.length > 0 ? [{ type: 'text', text }, ...images] : text
}

function fallbackMessages(messages: AgentMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: AgentMessageContent }> {
  const fallbackToolCatalog = toolDefinitions.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }))
  const protocol = `当前供应商不支持原生 tools 参数。可用工具定义：${JSON.stringify(fallbackToolCatalog)}。需要调用工具时只返回 JSON：{"tool":"工具名","arguments":{}}。任务完成时只返回 JSON：{"final":"给用户的最终说明"}。一次只调用一个工具。`
  return messages.map((message, index): { role: 'system' | 'user' | 'assistant'; content: AgentMessageContent } => {
    if (index === 0) return { role: 'system', content: `${typeof message.content === 'string' ? message.content : ''}\n\n${protocol}` }
    if (message.role === 'tool') return { role: 'user' as const, content: `[工具结果 ${message.tool_call_id ?? ''}]\n${message.content ?? ''}` }
    if (message.tool_calls?.length) return { role: 'assistant' as const, content: message.content || `[已请求工具：${message.tool_calls.map((call) => call.function.name).join(', ')}]` }
    return { role: message.role === 'system' ? 'system' : message.role, content: message.content ?? '' }
  })
}

async function runWorkspaceAgentUnlocked(request: WorkspaceAgentRequest, onProgress?: (progress: WorkspaceAgentProgress) => void): Promise<WorkspaceAgentResult> {
  const root = await realpath(request.workspace.rootPath)
  const activities: WorkspaceToolActivity[] = []
  const changedFiles = new Set<string>()
  const latestUserRequest = request.messages.slice().reverse().find((message) => message.role === 'user')?.content ?? ''
  const actionRequested = /压缩|生成|创建|新建|修改|改成|替换|重命名|移动|整理|处理|转换|合并|拆分|写入|保存|编写|实现|修复|批量/.test(latestUserRequest)
  const conversationContext = prepareConversationContext(request.messages)
  const hasPriorWorkspaceObservation = request.messages.some((message) => (message.workspaceActivities?.length ?? 0) > 0)
  const latestMentionsWorkspace = /目录|文件夹|工作区|项目|代码库|仓库|文件/.test(latestUserRequest)
  const shouldObserveWorkspace = !hasPriorWorkspaceObservation || latestMentionsWorkspace || actionRequested
  let workspaceObservation = '本轮沿用同一会话已授权的工作目录；用户最新消息未要求重新检查目录。'
  if (shouldObserveWorkspace) {
    const initialActivity: WorkspaceToolActivity = {
      id: `observe_${randomUUID()}`,
      tool: 'list_directory',
      label: hasPriorWorkspaceObservation ? '同步工作目录' : '观察工作目录',
      status: 'running'
    }
    activities.push(initialActivity)
    onProgress?.({ conversationId: request.conversationId, activity: { ...initialActivity } })
    try {
      const observation = await executeTool(request, root, request.workspace.permission, 'list_directory', { path: '.' })
      initialActivity.status = 'completed'
      initialActivity.detail = observation.output.slice(0, 240)
      workspaceObservation = `当前工作目录清单：\n${observation.output}`
    } catch (error) {
      initialActivity.status = 'failed'
      initialActivity.detail = error instanceof Error ? error.message : '无法读取工作目录'
      throw error
    } finally {
      onProgress?.({ conversationId: request.conversationId, activity: { ...initialActivity } })
    }
  }
  const selectedImages = selectRecentImageAttachments(conversationContext.messages)
  const messages: AgentMessage[] = [
    { role: 'system', content: `你是 G-LLM 工作区代理。当前获得目录“${basename(root)}”的${request.workspace.permission === 'read-write' ? '读取和写入' : '只读'}权限。用户的最新一条消息始终是本轮最高优先级。用户上传的图片和附件是直接对话输入，与工作目录中的文件是两个独立来源；收到图片时必须观察并结合图片内容回答，不得因为图片不在工作目录中而忽略它。仅当用户要求创建、修改或保存文件时才写入工作区；咨询、评价和补充信息默认直接回复。用户提到“目录内、文件夹里、这个项目”等内容时以工作区为准，不得要求重复上传已经位于目录中的文件。涉及文件处理必须实际调用工具，不要声称执行未调用的操作。所有路径使用相对路径。优先使用专用工具；没有合适工具或需要批量逻辑时使用 run_javascript。执行后检查产物，不符合目标时修正重试。严禁为了满足文件最小字节数而追加空白、随机或无意义数据；文件大小偏好必须通过真实画质、分辨率或有效内容实现，无法达到下限时如实说明。${getConversationProjectMemoryContext(request.projectMemory)}` },
    ...(conversationContext.compressedHistory ? [{ role: 'system' as const, content: conversationContext.compressedHistory }] : []),
    { role: 'system', content: `[工作区状态]\n${workspaceObservation}\n这只是背景信息，不是新的用户指令，不得覆盖最后一条用户消息。` },
    ...conversationContext.messages.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: toAgentMessageContent(message, selectedImages)
    }))
  ]
  let nativeToolMode = true
  let needsVerification = false

  for (let turn = 0; turn < 14; turn += 1) {
    let response = await fetch(providerUrl(request), {
      method: 'POST',
      headers: { ...(request.provider.apiKey ? { Authorization: `Bearer ${request.provider.apiKey}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.provider.defaultModel, messages: nativeToolMode ? messages : fallbackMessages(messages), ...(nativeToolMode ? { tools: toolDefinitions, tool_choice: 'auto' } : {}), stream: false, temperature: request.settings.enableTemperature ? Math.min(request.settings.temperature, 0.4) : 0.2, max_tokens: request.settings.enableMaxTokens ? request.settings.maxTokens : 4096 }),
      signal: AbortSignal.timeout(120_000)
    })
    if (!response.ok && nativeToolMode && [400, 404, 422].includes(response.status)) {
      nativeToolMode = false
      response = await fetch(providerUrl(request), {
        method: 'POST',
        headers: { ...(request.provider.apiKey ? { Authorization: `Bearer ${request.provider.apiKey}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: request.provider.defaultModel, messages: fallbackMessages(messages), stream: false, temperature: 0.1, max_tokens: request.settings.enableMaxTokens ? request.settings.maxTokens : 4096 }),
        signal: AbortSignal.timeout(120_000)
      })
    }
    if (!response.ok) throw new Error(`工作区 Agent 请求失败：${response.status} ${(await response.text()).slice(0, 300)}`)
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> }
    const message = payload.choices?.[0]?.message
    if (!message) throw new Error('模型没有返回可用响应')
    let calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (!nativeToolMode && calls.length === 0) {
      const instruction = extractJson(message.content ?? '')
      if (typeof instruction?.final === 'string') {
        message.content = instruction.final.trim() || '任务已结束。'
      }
      if (typeof instruction?.tool === 'string') {
        calls = [{ id: `fallback_${randomUUID()}`, type: 'function', function: { name: instruction.tool, arguments: JSON.stringify(instruction.arguments ?? {}) } }]
      }
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls })
    if (calls.length === 0) {
      if (needsVerification && turn < 12) {
        messages.push({
          role: 'user',
          content: '你刚才生成或修改了文件，但还没有验证结果。请使用 inspect_file、read_file 或其他合适工具检查产物是否存在、大小和内容是否符合用户目标；不符合时继续修正。'
        })
        continue
      }
      if (actionRequested && changedFiles.size === 0 && turn < 2) {
        messages.push({
          role: 'user',
          content: '你尚未调用任何会产生目标文件的工具，因此任务并未完成。不要要求用户重新上传工作目录中已经列出的文件；请立即检查目标文件并调用合适工具执行。'
        })
        continue
      }
      return { conversationId: request.conversationId, content: message.content?.trim() || '任务已结束。', activities, changedFiles: Array.from(changedFiles) }
    }
    for (const call of calls.slice(0, 6)) {
      const activity: WorkspaceToolActivity = { id: call.id || randomUUID(), tool: call.function.name, label: activityLabel(call.function.name), status: 'running' }
      activities.push(activity)
      onProgress?.({ conversationId: request.conversationId, activity: { ...activity } })
      try {
        const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        const result = await executeTool(request, root, request.workspace.permission, call.function.name, args)
        if (result.changedFile) {
          changedFiles.add(result.changedFile)
          needsVerification = true
        }
        for (const file of result.changedFiles ?? []) {
          changedFiles.add(file)
          needsVerification = true
        }
        if (['inspect_file', 'read_file', 'read_document'].includes(call.function.name) && needsVerification) needsVerification = false
        activity.status = 'completed'
        activity.detail = result.output.slice(0, 240)
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.output })
      } catch (error) {
        activity.status = 'failed'
        activity.detail = error instanceof Error ? error.message : '工具执行失败'
        messages.push({ role: 'tool', tool_call_id: call.id, content: `错误：${activity.detail}` })
      }
      onProgress?.({ conversationId: request.conversationId, activity: { ...activity } })
    }
  }
  return { conversationId: request.conversationId, content: '已达到本次工作区操作的最大步骤数，请检查当前结果后继续。', activities, changedFiles: Array.from(changedFiles) }
}

export async function runWorkspaceAgent(request: WorkspaceAgentRequest, onProgress?: (progress: WorkspaceAgentProgress) => void): Promise<WorkspaceAgentResult> {
  const root = await realpath(request.workspace.rootPath)
  const lockKey = process.platform === 'linux' ? root : root.toLocaleLowerCase()
  const owner = workspaceRunLocks.get(lockKey)
  if (owner) {
    throw new Error(owner === request.conversationId ? '当前会话已有工作区任务正在运行' : '另一个会话正在操作这个工作目录，请等待其完成后再试')
  }
  workspaceRunLocks.set(lockKey, request.conversationId)
  try {
    return await runWorkspaceAgentUnlocked(request, onProgress)
  } finally {
    if (workspaceRunLocks.get(lockKey) === request.conversationId) workspaceRunLocks.delete(lockKey)
  }
}
