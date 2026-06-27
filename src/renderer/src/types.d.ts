import type { GllmApi } from '../../preload'

declare global {
  interface Window {
    gllm: GllmApi
  }
}
