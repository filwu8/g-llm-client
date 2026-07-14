/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface ChatErrorRetryProps {
  error: string
  retryAt?: number
  disabled: boolean
  onRetry: () => void
}

export function ChatErrorRetry({ error, retryAt, disabled, onRetry }: ChatErrorRetryProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0
  )
  const retriedRef = useRef(false)

  useEffect(() => {
    if (!retryAt) return

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
      setRemainingSeconds(remaining)
      if (remaining === 0 && !disabled && !retriedRef.current) {
        retriedRef.current = true
        onRetry()
      }
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 250)
    return () => window.clearInterval(timer)
  }, [disabled, onRetry, retryAt])

  return (
    <div className="message-error-actions">
      {retryAt && remainingSeconds > 0 && (
        <p className="message-retry-countdown" aria-live="polite">
          将在 {remainingSeconds} 秒后自动重试
        </p>
      )}
      <button className="message-retry-button" disabled={disabled} type="button" onClick={onRetry}>
        <RefreshCw size={15} />
        <span>{retryAt ? '立即重试' : '重新发送'}</span>
      </button>
      <details className="message-error-detail">
        <summary>开发错误详情</summary>
        <pre>{error}</pre>
      </details>
    </div>
  )
}
