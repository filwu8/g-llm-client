import { useRef, useState } from 'react'

import floatingLogo from '../../../resources/app-icon-win-Top.png'

type DragState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

const DRAG_THRESHOLD = 4

export default function FloatingLogo() {
  const dragState = useRef<DragState | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false
    }
    window.gllm.beginFloatingLogoDrag()
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return

    const distance = Math.hypot(event.screenX - state.startX, event.screenY - state.startY)
    if (!state.moved && distance < DRAG_THRESHOLD) return

    event.preventDefault()
    if (!state.moved) {
      state.moved = true
      setIsDragging(true)
    }
    window.gllm.moveFloatingLogoDrag()
  }

  function finishDrag(event: React.PointerEvent<HTMLButtonElement>, shouldOpenPanel: boolean) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return

    event.preventDefault()
    dragState.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.gllm.endFloatingLogoDrag()
    setIsDragging(false)

    if (shouldOpenPanel && !state.moved) {
      void window.gllm.showQuickPanel()
    }
  }

  function openFromKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    void window.gllm.showQuickPanel()
  }

  function openContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    void window.gllm.showFloatingLogoMenu()
  }

  return (
    <button
      aria-label="打开 G-LLM 快速对话"
      className={`floating-logo-button ${isDragging ? 'dragging' : ''}`}
      title="打开 G-LLM 快速对话"
      type="button"
      onContextMenu={openContextMenu}
      onDragStart={(event) => event.preventDefault()}
      onKeyDown={openFromKeyboard}
      onPointerCancel={(event) => finishDrag(event, false)}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={(event) => finishDrag(event, true)}
    >
      <img alt="" className="floating-logo-mark" draggable={false} src={floatingLogo} />
    </button>
  )
}
