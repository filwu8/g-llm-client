import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import mammoth from 'mammoth'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { PDFParse } from 'pdf-parse'

import type { AttachmentKind, ClipboardAttachmentInput, PreparedAttachment } from '../shared/types'

const maxTextBytes = 2 * 1024 * 1024
const maxDocumentBytes = 12 * 1024 * 1024
const maxImageBytes = 8 * 1024 * 1024

const textExtensions = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.sql',
  '.log',
  '.yml',
  '.yaml',
  '.ini',
  '.toml'
])

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const pdfExtensions = new Set(['.pdf'])
const wordExtensions = new Set(['.docx'])

const mimeByExtension: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.sql': 'application/sql'
}

function createAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getMimeType(filePath: string, kind: AttachmentKind): string {
  const extension = extname(filePath).toLowerCase()
  return mimeByExtension[extension] ?? (kind === 'image' ? 'image/*' : 'application/octet-stream')
}

function getMimeTypeByName(name: string, kind: AttachmentKind, mimeType?: string): string {
  const extension = extname(name).toLowerCase()
  return mimeType || mimeByExtension[extension] || (kind === 'image' ? 'image/*' : 'application/octet-stream')
}

function normalizeText(text: string): string {
  return text.replace(/\u0000/g, '').slice(0, 40_000)
}

async function readPdfText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText()
    return normalizeText(result.text)
  } finally {
    await parser.destroy()
  }
}

async function readWordText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })
  return normalizeText(result.value)
}

async function readPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText()
    return normalizeText(result.text)
  } finally {
    await parser.destroy()
  }
}

async function readWordTextFromBuffer(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return normalizeText(result.value)
}

function parseDataUrl(dataUrl?: string): Buffer | null {
  if (!dataUrl) return null
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) return null

  const payload = match[3] ?? ''
  return match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
}

async function readAttachment(filePath: string, kind: AttachmentKind): Promise<PreparedAttachment> {
  const fileStat = await stat(filePath)
  const extension = extname(filePath).toLowerCase()
  const actualKind: AttachmentKind = kind === 'image' || imageExtensions.has(extension) ? 'image' : 'file'
  const mimeType = getMimeType(filePath, actualKind)
  const base: PreparedAttachment = {
    id: createAttachmentId(),
    name: basename(filePath),
    mimeType,
    size: fileStat.size,
    kind: actualKind
  }

  if (actualKind === 'image') {
    if (fileStat.size > maxImageBytes) return base
    const buffer = await readFile(filePath)
    return {
      ...base,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
    }
  }

  if (fileStat.size <= maxDocumentBytes && pdfExtensions.has(extension)) {
    return {
      ...base,
      text: await readPdfText(filePath).catch(() => '')
    }
  }

  if (fileStat.size <= maxDocumentBytes && wordExtensions.has(extension)) {
    return {
      ...base,
      text: await readWordText(filePath).catch(() => '')
    }
  }

  if (fileStat.size <= maxTextBytes && textExtensions.has(extension)) {
    const text = await readFile(filePath, 'utf8')
    return {
      ...base,
      text: normalizeText(text)
    }
  }

  return base
}

function getClipboardAttachmentName(input: ClipboardAttachmentInput, index: number): string {
  const name = input.name?.trim()
  if (name) return name
  if (input.kind === 'image' || input.mimeType.startsWith('image/')) return `粘贴图片_${index + 1}.png`
  return `粘贴附件_${index + 1}`
}

async function prepareClipboardAttachment(input: ClipboardAttachmentInput, index: number): Promise<PreparedAttachment> {
  const name = getClipboardAttachmentName(input, index)
  const extension = extname(name).toLowerCase()
  const actualKind: AttachmentKind =
    input.kind === 'image' || input.mimeType.startsWith('image/') || imageExtensions.has(extension) ? 'image' : 'file'
  const mimeType = getMimeTypeByName(name, actualKind, input.mimeType)
  const size = Number.isFinite(input.size) ? Math.max(0, Number(input.size)) : 0
  const buffer = parseDataUrl(input.dataUrl)
  const base: PreparedAttachment = {
    id: createAttachmentId(),
    name,
    mimeType,
    size,
    kind: actualKind
  }

  if (actualKind === 'image') {
    if (!input.dataUrl || size > maxImageBytes) return base
    return {
      ...base,
      dataUrl: input.dataUrl
    }
  }

  if (size <= maxDocumentBytes && buffer && (pdfExtensions.has(extension) || mimeType === 'application/pdf')) {
    return {
      ...base,
      text: await readPdfTextFromBuffer(buffer).catch(() => '')
    }
  }

  if (
    size <= maxDocumentBytes &&
    buffer &&
    (wordExtensions.has(extension) || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ) {
    return {
      ...base,
      text: await readWordTextFromBuffer(buffer).catch(() => '')
    }
  }

  if (size <= maxTextBytes && (input.text || buffer) && (textExtensions.has(extension) || mimeType.startsWith('text/'))) {
    return {
      ...base,
      text: normalizeText(input.text ?? buffer?.toString('utf8') ?? '')
    }
  }

  return base
}

export async function pickAttachments(owner: BrowserWindow | null, kind: AttachmentKind): Promise<PreparedAttachment[]> {
  const options: Electron.OpenDialogOptions = {
    title: kind === 'image' ? '选择图片' : '选择附件',
    properties: ['openFile', 'multiSelections'],
    filters:
      kind === 'image'
        ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        : [
            {
              name: '文档、图片与常用文本',
              extensions: [
                'pdf',
                'docx',
                'png',
                'jpg',
                'jpeg',
                'webp',
                'gif',
                ...Array.from(textExtensions).map((extension) => extension.slice(1))
              ]
            },
            { name: '所有文件', extensions: ['*'] }
          ]
  }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)

  if (result.canceled) return []

  const selected = await Promise.all(result.filePaths.slice(0, 8).map((filePath) => readAttachment(filePath, kind)))
  return selected
}

export async function preparePastedAttachments(inputs: ClipboardAttachmentInput[]): Promise<PreparedAttachment[]> {
  return Promise.all(inputs.slice(0, 8).map((input, index) => prepareClipboardAttachment(input, index)))
}
