'use client'

import { Tldraw, Editor, createShapeId } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { useCallback, useRef, forwardRef, useImperativeHandle } from 'react'

export interface TldrawBoardHandle {
  captureSnapshot: () => Promise<{ base64: string } | null>
  pointTo: (x: number, y: number) => void
}

interface TldrawBoardProps {
  onStrokeEnd?: (snapshot: { base64: string }) => void
  strokeEndDebounceMs?: number
}

const TldrawBoard = forwardRef<TldrawBoardHandle, TldrawBoardProps>(({ 
  onStrokeEnd, 
  strokeEndDebounceMs = 3000 
}, ref) => {
  const editorRef = useRef<Editor | null>(null)
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)

  const captureSnapshot = useCallback(async () => {
    if (!editorRef.current) return null
    
    // We get the SVG element for the current page
    const shapeIds = Array.from(editorRef.current.getCurrentPageShapeIds())
    if (shapeIds.length === 0) return null

    const result = await editorRef.current.getSvgElement(shapeIds)
    if (!result) return null

    const { svg } = result

    // Convert SVG to data URL
    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    
    return new Promise<{ base64: string } | null>((resolve) => {
      img.onload = () => {
        canvas.width = img.width
        canvas.height = img.height
        ctx?.drawImage(img, 0, 0)
        const base64 = canvas.toDataURL('image/png')
        resolve({ base64 })
      }
      img.onerror = () => resolve(null)
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
    })
  }, [])

  // pointTo: disabled — this tldraw version's cursor schema doesn't support x/y coords
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const pointTo = useCallback((_x: number, _y: number) => {
    // no-op: would crash with "Unexpected property" on cursor.x in this tldraw build
  }, [])

  useImperativeHandle(ref, () => ({
    captureSnapshot,
    pointTo
  }))

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    
    // Listen for changes to trigger the debounce
    editor.on('change', () => {
      if (!onStrokeEnd) return
      
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      
      debounceTimer.current = setTimeout(async () => {
        const snapshot = await captureSnapshot()
        if (snapshot) onStrokeEnd(snapshot)
      }, strokeEndDebounceMs)
    })
  }, [onStrokeEnd, strokeEndDebounceMs, captureSnapshot])

  return (
    <div className="w-full h-full border border-[#E0D5C5] rounded-none overflow-hidden shadow-inner bg-[#FAF6EF]">
      <Tldraw 
        onMount={handleMount} 
        inferDarkMode={false}
        hideUi={false}
        components={{
          ZoomMenu: null,
        }}
      />
    </div>
  )
})

TldrawBoard.displayName = 'TldrawBoard'

export default TldrawBoard
