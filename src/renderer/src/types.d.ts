/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import type { GllmApi } from '../../preload'

declare global {
  interface Window {
    gllm: GllmApi
  }
}
