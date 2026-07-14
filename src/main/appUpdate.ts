/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import { net } from 'electron'

import type { AppUpdateInfo } from '../shared/types'

const DOWNLOAD_PAGE_URL = 'https://llm.gprophet.com/download'
const UPDATE_ENDPOINTS = [
  'https://llm.gprophet.com/api/client/download',
  'https://llm.gprophet.com/api/download/config',
  'https://llm.gprophet.com/api/client-download-config',
  'https://llm.gprophet.com/api/status'
]

interface DownloadConfig {
  version: string
  releaseNotes?: string
  updatedAt?: string
}

function normalizeVersion(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^v/i, '')
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): { numbers: number[]; prerelease: string[] } => {
    const [core, prerelease = ''] = normalizeVersion(value).split('-', 2)
    return {
      numbers: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      prerelease: prerelease ? prerelease.split('.') : []
    }
  }
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.numbers.length, b.numbers.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  return a.prerelease.join('.').localeCompare(b.prerelease.join('.'), undefined, { numeric: true })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseConfig(value: unknown, depth = 0): DownloadConfig | null {
  if (depth > 5) return null
  if (typeof value === 'string') {
    try {
      return parseConfig(JSON.parse(value), depth + 1)
    } catch {
      return null
    }
  }
  const record = asRecord(value)
  if (!record) return null

  const version = normalizeVersion(record.version ?? record.latestVersion ?? record.latest_version)
  const hasClientFields =
    'windows_url' in record || 'macos_url' in record || 'release_notes' in record || 'latestVersion' in record
  if (version && hasClientFields) {
    return {
      version,
      releaseNotes:
        typeof (record.release_notes ?? record.releaseNotes) === 'string'
          ? String(record.release_notes ?? record.releaseNotes).trim()
          : undefined,
      updatedAt:
        typeof (record.updated_at ?? record.updatedAt) === 'string'
          ? String(record.updated_at ?? record.updatedAt).trim()
          : undefined
    }
  }

  const preferredKeys = [
    'ClientDownloadConfig',
    'clientDownloadConfig',
    'client_download_config',
    'downloadConfig',
    'data',
    'options'
  ]
  for (const key of preferredKeys) {
    if (!(key in record)) continue
    const parsed = parseConfig(record[key], depth + 1)
    if (parsed) return parsed
  }
  return null
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    return await net.fetch(url, {
      headers: { Accept: 'application/json, text/html;q=0.9' },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function readEndpointConfig(url: string): Promise<DownloadConfig | null> {
  try {
    const response = await fetchWithTimeout(url)
    if (!response.ok) return null
    return parseConfig(await response.json())
  } catch {
    return null
  }
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
}

async function readDownloadPageConfig(): Promise<DownloadConfig | null> {
  try {
    const response = await fetchWithTimeout(DOWNLOAD_PAGE_URL)
    if (!response.ok) return null
    const html = await response.text()
    const jsonMatch = html.match(
      /<script[^>]+(?:id=["']gllm-client-download-config["']|type=["']application\/json["'][^>]+data-gllm-client-download)[^>]*>([\s\S]*?)<\/script>/i
    )
    if (jsonMatch) {
      const config = parseConfig(decodeHtml(jsonMatch[1].trim()))
      if (config) return config
    }
    const metaVersion = html.match(
      /<meta[^>]+(?:name|property)=["'](?:gllm-client-version|app:version)["'][^>]+content=["']([^"']+)["']/i
    )
    if (metaVersion) {
      return {
        version: normalizeVersion(metaVersion[1]),
        releaseNotes: html.match(/<meta[^>]+name=["']gllm-release-notes["'][^>]+content=["']([^"']*)["']/i)?.[1]
      }
    }
    const installerVersion = html.match(/G-LLM[^"'<>\s]*?(\d+\.\d+\.\d+)[^"'<>\s]*?\.exe/i)
    return installerVersion ? { version: normalizeVersion(installerVersion[1]) } : null
  } catch {
    return null
  }
}

export async function checkForAppUpdate(currentVersion: string): Promise<AppUpdateInfo> {
  let config: DownloadConfig | null = null
  for (const endpoint of UPDATE_ENDPOINTS) {
    config = await readEndpointConfig(endpoint)
    if (config) break
  }
  config ??= await readDownloadPageConfig()

  if (!config?.version) {
    return {
      currentVersion,
      updateAvailable: false,
      status: 'unavailable',
      downloadPageUrl: DOWNLOAD_PAGE_URL,
      message: '暂时无法读取官网版本信息，可前往下载页手动查看。'
    }
  }

  const updateAvailable = compareVersions(config.version, currentVersion) > 0
  return {
    currentVersion,
    latestVersion: config.version,
    updateAvailable,
    status: updateAvailable ? 'available' : 'latest',
    downloadPageUrl: DOWNLOAD_PAGE_URL,
    releaseNotes: config.releaseNotes,
    updatedAt: config.updatedAt,
    message: updateAvailable ? `发现新版本 V${config.version}` : `当前已是最新版本 V${currentVersion}`
  }
}

export { DOWNLOAD_PAGE_URL }
