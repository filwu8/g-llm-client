/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

const automaticallyRetryableStatuses = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527
])

export interface ChatErrorPresentation {
  userMessage: string
  technicalDetail: string
  automaticallyRetryable: boolean
}

function getHttpStatus(value: string): number | undefined {
  const match = value.match(/(?:请求失败[：:]?|HTTP|error\s+code|status(?:\s+code)?)[^\d]{0,12}(\d{3})\b/i)
  return match ? Number(match[1]) : undefined
}

export function getChatErrorPresentation(value: string): ChatErrorPresentation {
  const raw = value.trim()
  const status = getHttpStatus(raw)
  const isHtml = /<!doctype\s+html|<html[\s>]/i.test(raw)
  const looksLikeNetworkFailure = /fetch failed|network|econn|enotfound|etimedout|socket|连接.*(?:失败|异常|超时)|网络.*(?:失败|异常|超时)|timeout/i.test(raw)
  const automaticallyRetryable = (status !== undefined && automaticallyRetryableStatuses.has(status)) || (!status && looksLikeNetworkFailure)

  let userMessage: string
  if (status === 524) {
    userMessage = '暂时无法连接大模型，服务响应超时。'
  } else if (status === 429) {
    userMessage = '大模型服务当前请求较多，请稍后再试。'
  } else if (automaticallyRetryable) {
    userMessage = '暂时无法连接大模型。'
  } else if (isHtml) {
    userMessage = '大模型服务返回异常，请稍后再试。'
  } else {
    userMessage = raw || '请求失败，请稍后再试。'
  }

  return {
    userMessage,
    technicalDetail: status ? `HTTP ${status}\n${raw}` : raw,
    automaticallyRetryable
  }
}
