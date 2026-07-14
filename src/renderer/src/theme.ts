/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import type { AppTheme } from '@shared/types'

const themeClasses = ['theme-light', 'theme-dark', 'theme-gold']

export function getEffectiveTheme(theme: AppTheme, goldThemeEntitled: boolean): AppTheme {
  return theme === 'gold' && !goldThemeEntitled ? 'light' : theme
}

export function applyDocumentTheme(theme: AppTheme, goldThemeEntitled: boolean): AppTheme {
  const effectiveTheme = getEffectiveTheme(theme, goldThemeEntitled)
  const root = document.documentElement
  root.classList.remove(...themeClasses)
  root.classList.add(`theme-${effectiveTheme}`)
  root.dataset.theme = effectiveTheme
  root.style.colorScheme = effectiveTheme === 'light' ? 'light' : 'dark'
  window.dispatchEvent(new CustomEvent('gllm-theme-changed', { detail: { theme: effectiveTheme } }))
  return effectiveTheme
}
