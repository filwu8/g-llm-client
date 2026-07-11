import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  inferModelCapabilities,
  inferModelType,
  MODEL_CAPABILITY_LABELS,
  normalizeModelCapabilities
} from '@shared/modelCapabilities'
import type { ApiProvider, ProviderModel } from '@shared/types'

const modelNameCollator = new Intl.Collator(['zh-CN', 'en'], {
  numeric: true,
  sensitivity: 'base'
})

const modelFamilyPriority = [
  'gpt',
  'claude',
  'gemini',
  'qwen',
  'deepseek',
  'glm',
  'doubao',
  'kimi',
  'moonshot',
  'grok',
  'llama',
  'mistral',
  'codex',
  'sonar',
  'flux',
  'dall',
  'imagen'
]

export function getModelOptions(provider: ApiProvider, selectedModel = provider.defaultModel): ProviderModel[] {
  const models = provider.models.some((model) => model.id === selectedModel)
    ? provider.models
    : [
        {
          id: selectedModel,
          name: selectedModel,
          capabilities: inferModelCapabilities(selectedModel),
          type: inferModelType(selectedModel)
        },
        ...provider.models
      ]

  return models
    .filter((model) => model.id)
    .map((model) => ({
      ...model,
      capabilities: normalizeModelCapabilities(model),
      type: model.type ?? inferModelType(model.id)
    }))
    .sort(compareProviderModels)
}

function getModelName(model: ProviderModel): string {
  return model.name?.trim() || model.id
}

function getModelTitle(model: ProviderModel): string {
  return model.name && model.name !== model.id ? model.name : model.id
}

function getModelSubtitle(model: ProviderModel): string {
  return model.name && model.name !== model.id ? model.id : model.ownedBy || ''
}

function getModelSortText(model: ProviderModel): string {
  const displayName = getModelName(model)
  const id = model.id
  return `${displayName} ${id}`
    .toLocaleLowerCase()
    .replace(/_+/g, '-')
    .replace(/\s+/g, '-')
}

function getModelFamilyKey(model: ProviderModel): string {
  const sortText = getModelSortText(model)
  const family = modelFamilyPriority.find((key) => new RegExp(`(^|[-/])${key}(?=$|[-/]|\\d)`).test(sortText))
  if (family) return family

  const leafName = sortText.split(/[/-]/).at(-1) || sortText
  return leafName.match(/[a-z]+/)?.[0] ?? leafName
}

function getModelFamilyRank(model: ProviderModel): number {
  const familyIndex = modelFamilyPriority.indexOf(getModelFamilyKey(model))
  return familyIndex >= 0 ? familyIndex : modelFamilyPriority.length
}

function getModelVersionParts(model: ProviderModel): number[] {
  const sortText = getModelSortText(model)
  const familyKey = getModelFamilyKey(model)
  const familyIndex = sortText.indexOf(familyKey)
  const versionText = familyIndex >= 0 ? sortText.slice(familyIndex + familyKey.length) : sortText
  const match = versionText.match(/\d+(?:[.-]\d+)*/)
  if (!match) return []
  return match[0].split(/[.-]/).map((part) => Number(part)).filter((part) => Number.isFinite(part))
}

function compareModelVersionsDescending(first: ProviderModel, second: ProviderModel): number {
  const firstParts = getModelVersionParts(first)
  const secondParts = getModelVersionParts(second)
  const maxLength = Math.max(firstParts.length, secondParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const firstPart = firstParts[index] ?? -1
    const secondPart = secondParts[index] ?? -1
    if (firstPart !== secondPart) return secondPart - firstPart
  }

  return 0
}

function getModelVariantRank(model: ProviderModel): number {
  const sortText = getModelSortText(model)
  if (/\bcodex\b/.test(sortText) || /(^|-)codex($|-)/.test(sortText)) return 2
  if (/embedding|rerank|audio|tts|whisper/.test(sortText)) return 3
  return 0
}

function compareProviderModels(first: ProviderModel, second: ProviderModel): number {
  const firstFamily = getModelFamilyKey(first)
  const secondFamily = getModelFamilyKey(second)

  return (
    getModelFamilyRank(first) - getModelFamilyRank(second) ||
    modelNameCollator.compare(firstFamily, secondFamily) ||
    compareModelVersionsDescending(first, second) ||
    getModelVariantRank(first) - getModelVariantRank(second) ||
    modelNameCollator.compare(getModelName(first), getModelName(second)) ||
    modelNameCollator.compare(first.id, second.id)
  )
}

function getModelSearchText(model: ProviderModel): string {
  return [
    model.id,
    model.name,
    model.ownedBy,
    model.type,
    ...normalizeModelCapabilities(model).map((capability) => MODEL_CAPABILITY_LABELS[capability])
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}

export function getModelDisplayLabel(model: ProviderModel): string {
  const name = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id
  const capabilities = normalizeModelCapabilities(model)
    .map((capability) => MODEL_CAPABILITY_LABELS[capability])
    .join(' / ')
  return `${name} · ${capabilities}`
}

export function ModelCapabilityBadges({ model }: { model: ProviderModel }) {
  return (
    <>
      {normalizeModelCapabilities(model).map((capability) => (
        <span key={capability} className={`model-capability-badge type-${capability}`}>
          {MODEL_CAPABILITY_LABELS[capability]}
        </span>
      ))}
    </>
  )
}

function ModelPickerList({
  models,
  selectedModelId,
  onSelect,
  emptyLabel = '没有找到匹配的模型'
}: {
  models: ProviderModel[]
  selectedModelId: string
  onSelect: (modelId: string) => void
  emptyLabel?: string
}) {
  return (
    <div className="conversation-model-list" role="listbox" aria-label="模型">
      {models.map((model) => {
        const subtitle = getModelSubtitle(model)
        return (
          <button
            key={model.id}
            aria-selected={model.id === selectedModelId}
            className={model.id === selectedModelId ? 'active' : ''}
            onClick={() => onSelect(model.id)}
            role="option"
            title={getModelDisplayLabel(model)}
            type="button"
          >
            <span className="conversation-model-info">
              <strong>{getModelTitle(model)}</strong>
              {subtitle && <small>{subtitle}</small>}
            </span>
            <span className="model-capability-list">
              <ModelCapabilityBadges model={model} />
            </span>
          </button>
        )
      })}
      {models.length === 0 && <div className="conversation-model-empty">{emptyLabel}</div>}
    </div>
  )
}

export function ModelPickerMenu({
  provider,
  value,
  onChange,
  variant = 'expanded',
  className = '',
  placement = 'bottom',
  disabled = false,
  showTriggerCapabilities = true
}: {
  provider: ApiProvider
  value: string
  onChange: (modelId: string) => void
  variant?: 'expanded' | 'dropdown'
  className?: string
  placement?: 'bottom' | 'top'
  disabled?: boolean
  showTriggerCapabilities?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelOptions = useMemo(() => getModelOptions(provider, value), [provider, value])
  const selectedModel = modelOptions.find((model) => model.id === value) ?? null
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleModelOptions = normalizedQuery
    ? modelOptions.filter((model) => getModelSearchText(model).includes(normalizedQuery))
    : modelOptions

  useEffect(() => {
    setQuery('')
    setOpen(false)
  }, [provider.id])

  useEffect(() => {
    if (variant !== 'dropdown' || !open) return

    function closeOnOutsideClick(event: MouseEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, variant])

  function selectModel(modelId: string) {
    onChange(modelId)
    if (variant === 'dropdown') {
      setOpen(false)
      setQuery('')
    }
  }

  const searchField = (
    <label className="model-search-field">
      <Search size={16} />
      <input
        aria-label="搜索模型"
        placeholder="搜索模型名称、ID、供应商或能力标签"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
      />
    </label>
  )

  if (variant === 'dropdown') {
    const subtitle = selectedModel ? getModelSubtitle(selectedModel) : ''

    return (
      <div className={`model-picker-dropdown placement-${placement} ${className}`.trim()} ref={dropdownRef}>
        <button
          aria-expanded={open}
          className="model-dropdown-trigger"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          title={selectedModel ? getModelDisplayLabel(selectedModel) : '请选择模型'}
          type="button"
        >
          <span className="model-dropdown-current">
            <strong>{selectedModel ? getModelTitle(selectedModel) : value || '请选择模型'}</strong>
            {subtitle && <small>{subtitle}</small>}
          </span>
          {selectedModel && showTriggerCapabilities && (
            <span className="model-capability-list model-dropdown-capabilities">
              <ModelCapabilityBadges model={selectedModel} />
            </span>
          )}
          <ChevronDown size={17} />
        </button>
        {open && !disabled && (
          <div className="model-dropdown-popover">
            {searchField}
            <ModelPickerList models={visibleModelOptions} selectedModelId={value} onSelect={selectModel} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="conversation-model-picker">
      <div className="conversation-model-picker-head">
        <span>模型</span>
        <small>
          {selectedModel ? `当前：${getModelTitle(selectedModel)}` : '请选择模型'} · {visibleModelOptions.length}/{modelOptions.length}
        </small>
      </div>
      {searchField}
      <ModelPickerList models={visibleModelOptions} selectedModelId={value} onSelect={selectModel} />
    </div>
  )
}
