'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { Editor, Tldraw, useEditor } from 'tldraw'
import 'tldraw/tldraw.css'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WhiteboardSnapshot {
  blob: Blob
  /** data-URL (base64 PNG) ready to send to the backend */
  base64: string
  timestamp: number
}

/** Methods exposed to a parent via ref */
export interface TldrawBoardHandle {
  /** Manually trigger a snapshot of the current canvas */
  captureSnapshot: () => Promise<WhiteboardSnapshot | null>
  /** Direct access to the tldraw Editor instance */
  getEditor: () => Editor | null
}

interface TldrawBoardProps {
  /**
   * Called automatically after the user stops drawing.
   * Fires `strokeEndDebounceMs` ms after the last pen event.
   */
  onStrokeEnd?: (snapshot: WhiteboardSnapshot) => void
  /** How long to wait after the last stroke before auto-capturing (default 3000 ms) */
  strokeEndDebounceMs?: number
  className?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function captureEditorSnapshot(
  editor: Editor
): Promise<WhiteboardSnapshot | null> {
  const shapeIds = [...editor.getCurrentPageShapeIds()]
  if (shapeIds.length === 0) return null

  const { blob } = await editor.toImage(shapeIds, {
    format: 'png',
    background: true,
  })

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  return { blob, base64, timestamp: Date.now() }
}

// ─── Inner controller (needs useEditor inside Tldraw context) ─────────────────

function StrokeListener({
  onStrokeEnd,
  debounceMs,
  onReady,
}: {
  onStrokeEnd?: (snapshot: WhiteboardSnapshot) => void
  debounceMs: number
  onReady: (editor: Editor) => void
}) {
  const editor = useEditor()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Expose the editor to the parent ref
  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  // Listen for user-initiated document changes and debounce the snapshot
  useEffect(() => {
    if (!onStrokeEnd) return

    const stop = editor.store.listen(
      () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(async () => {
          const snapshot = await captureEditorSnapshot(editor)
          if (snapshot) onStrokeEnd(snapshot)
        }, debounceMs)
      },
      { scope: 'document', source: 'user' }
    )

    return () => {
      stop()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [editor, onStrokeEnd, debounceMs])

  return null
}

// ─── Public component ─────────────────────────────────────────────────────────

const TldrawBoard = forwardRef<TldrawBoardHandle, TldrawBoardProps>(
  ({ onStrokeEnd, strokeEndDebounceMs = 3000, className }, ref) => {
    const editorRef = useRef<Editor | null>(null)

    useImperativeHandle(ref, () => ({
      captureSnapshot: () => {
        if (!editorRef.current) return Promise.resolve(null)
        return captureEditorSnapshot(editorRef.current)
      },
      getEditor: () => editorRef.current,
    }))

    const handleReady = useCallback((editor: Editor) => {
      editorRef.current = editor
    }, [])

    return (
      <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
        <Tldraw>
          <StrokeListener
            onStrokeEnd={onStrokeEnd}
            debounceMs={strokeEndDebounceMs}
            onReady={handleReady}
          />
        </Tldraw>
      </div>
    )
  }
)

TldrawBoard.displayName = 'TldrawBoard'
export default TldrawBoard
