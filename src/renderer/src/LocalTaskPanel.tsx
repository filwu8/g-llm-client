/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import { CircleCheck, FolderOpen, LoaderCircle, ShieldCheck, TriangleAlert, X } from 'lucide-react'

import type { LocalTaskPlan, LocalTaskProgress, LocalTaskResult } from '@shared/types'

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${Number((size / 1024 / 1024).toFixed(2))} MiB`
  if (size >= 1024) return `${Number((size / 1024).toFixed(1))} KiB`
  return `${size} B`
}

interface LocalTaskPanelProps {
  plan: LocalTaskPlan
  progress: LocalTaskProgress | null
  result: LocalTaskResult | null
  running: boolean
  onApprove: () => void
  onCancel: () => void
  onClose: () => void
  onOpenOutput: (planId: string) => void
}

export function LocalTaskPanel({ plan, progress, result, running, onApprove, onCancel, onClose, onOpenOutput }: LocalTaskPanelProps) {
  const successCount = result?.artifacts.filter((artifact) => artifact.success).length ?? 0

  return (
    <div className="local-task-backdrop" role="presentation">
      <section className="local-task-panel" role="dialog" aria-modal="true" aria-label="本地文件任务">
        <header>
          <div>
            <span className="local-task-eyebrow">本地文件任务</span>
            <h2>{result ? '处理结果' : running ? '正在处理附件' : '确认执行计划'}</h2>
          </div>
          {!running && <button className="icon-button" type="button" onClick={onClose}><X size={18} /></button>}
        </header>

        {!result && (
          <>
            <div className="local-task-limit"><ShieldCheck size={18} /><span>目标：每个文件不超过 <strong>{plan.targetLabel}</strong></span></div>
            <div className="local-task-file-list">
              {plan.files.map((file) => (
                <div className={`local-task-file ${file.supported ? '' : 'unsupported'}`} key={file.attachmentId}>
                  {file.supported ? <CircleCheck size={17} /> : <TriangleAlert size={17} />}
                  <div><strong>{file.name}</strong><small>{formatBytes(file.originalSize)} · {file.action === 'compress-image' ? '压缩图片' : file.action === 'compress-pdf' ? '压缩 PDF（页面重建）' : file.action === 'copy' ? '已达标，复制到结果目录' : '暂不支持自动处理'}</small>{file.warning && <p>{file.warning}</p>}</div>
                </div>
              ))}
            </div>
            <div className="local-task-safety"><strong>执行边界</strong><span>不会覆盖原文件；结果保存到源文件旁的“{plan.outputDirectoryName}”文件夹；完成后会按实际字节数重新验证。</span></div>
            {running && <div className="local-task-progress"><LoaderCircle className="spin" size={18} /><span>{progress?.message ?? '正在准备任务…'}</span><strong>{progress ? `${progress.current}/${progress.total}` : ''}</strong></div>}
          </>
        )}

        {result && (
          <>
            <div className={`local-task-summary ${result.status}`}><strong>{successCount}/{result.artifacts.length} 个文件处理成功</strong><span>{result.status === 'completed' ? '所有输出均已验证达标' : '部分文件需要选择其他处理方式'}</span></div>
            <div className="local-task-result-list">
              {result.artifacts.map((artifact) => (
                <div className={artifact.success ? 'success' : 'failed'} key={artifact.attachmentId}>
                  {artifact.success ? <CircleCheck size={17} /> : <TriangleAlert size={17} />}
                  <div><strong>{artifact.outputName ?? artifact.sourceName}</strong><small>{formatBytes(artifact.originalSize)}{artifact.outputSize !== undefined ? ` → ${formatBytes(artifact.outputSize)}` : ''}</small><p>{artifact.message}</p></div>
                </div>
              ))}
            </div>
          </>
        )}

        <footer>
          {running && <button className="secondary-action" type="button" onClick={onCancel}>取消任务</button>}
          {!running && <button className="secondary-action" type="button" onClick={onClose}>{result ? '关闭' : '取消'}</button>}
          {!result && <button className="primary-action" disabled={running || !plan.files.some((file) => file.supported)} type="button" onClick={onApprove}>{running ? '正在处理…' : '开始处理'}</button>}
          {result?.outputDirectory && <button className="primary-action" type="button" onClick={() => onOpenOutput(result.planId)}><FolderOpen size={16} />打开输出文件夹</button>}
        </footer>
      </section>
    </div>
  )
}
