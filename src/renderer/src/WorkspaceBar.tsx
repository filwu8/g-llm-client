/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import { CircleCheck, FileText, FolderOpen, LoaderCircle, ShieldCheck, Unplug, XCircle } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationWorkspace, WorkspaceToolActivity } from '@shared/types'

export function WorkspaceBar({ workspace, onUnbind }: {
  workspace: ConversationWorkspace
  onUnbind: () => void
}) {
  const { t } = useTranslation()
  return (
    <section className="workspace-bar">
      <div className="workspace-bar-head">
        <FolderOpen size={14} />
        <div><small title={workspace.rootPath}>{workspace.rootPath}</small></div>
        <span><ShieldCheck size={13} />{workspace.permission === 'read-write' ? t('workspace.readWrite') : t('workspace.readOnly')}</span>
        <button title={t('workspace.unbind')} type="button" onClick={onUnbind}><Unplug size={14} /></button>
      </div>
    </section>
  )
}

export function WorkspaceActivityLog({ activities, changedFiles, running = false, artifactRoot, onArtifactOpen, onArtifactContextMenu }: {
  activities: WorkspaceToolActivity[]
  changedFiles?: string[]
  running?: boolean
  artifactRoot?: string
  onArtifactOpen?: (rootPath: string, relativePath: string) => void
  onArtifactContextMenu?: (event: ReactMouseEvent, rootPath: string, relativePath: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="workspace-message-activities">
      <div className="workspace-message-activities-title">
        {running && <LoaderCircle className="spin" size={14} />}
        <strong>{running ? (activities.length > 0 ? t('workspace.operating') : t('workspace.understanding')) : activities.length > 0 ? t('workspace.activityLog') : t('workspace.generatedFiles')}</strong>
      </div>
      {activities.length === 0 && running && <small>{t('workspace.readingContext')}</small>}
      {activities.map((activity) => (
        <div className={`workspace-message-activity ${activity.status}`} key={activity.id} title={activity.detail}>
          {activity.status === 'running' ? <LoaderCircle className="spin" size={14} /> : activity.status === 'completed' ? <CircleCheck size={14} /> : <XCircle size={14} />}
          <span>{activity.label}</span>
          {activity.detail && <small>{activity.detail}</small>}
        </div>
      ))}
      {changedFiles && changedFiles.length > 0 && (
        <div className="workspace-changed-files">
          <span>{t('workspace.changedFiles')}</span>
          <div>
            {changedFiles.map((file) => {
              const separator = artifactRoot?.includes('\\') ? '\\' : '/'
              const fullPath = artifactRoot ? `${artifactRoot.replace(/[\\/]+$/, '')}${separator}${file}` : file
              return (
              <button
                key={file}
                title={`${fullPath}\n${t('workspace.revealHint')}`}
                type="button"
                onClick={() => {
                  if (artifactRoot && onArtifactOpen) onArtifactOpen(artifactRoot, file)
                }}
                onContextMenu={(event) => {
                  if (!artifactRoot || !onArtifactContextMenu) return
                  event.preventDefault()
                  onArtifactContextMenu(event, artifactRoot, file)
                }}
              >
                <FileText size={13} />
                <span>{file}</span>
              </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
