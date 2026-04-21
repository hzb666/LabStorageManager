import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Ketcher } from 'ketcher-core'
import { Editor } from 'ketcher-react'
import type { ButtonsConfig } from 'ketcher-react'
import { StandaloneStructServiceProvider } from 'ketcher-standalone'
import 'ketcher-react/dist/index.css'
import './KetcherEditor.css'

const structServiceProvider = new StandaloneStructServiceProvider()
const KETCHER_IMAGE_UPLOAD_INPUT_ID = 'image-upload'

type KetcherButtonVisibilityConfig = ButtonsConfig & {
  images?: { hidden?: boolean }
}

const DISABLED_IMAGE_UPLOAD_BUTTONS: KetcherButtonVisibilityConfig = {
  images: { hidden: true },
  recognize: { hidden: true },
}

interface KetcherEditorProps {
  onError: (message: string) => void
  onInit: (ketcher: Ketcher) => void
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function isImageFileInput(target: EventTarget | null, root: HTMLDivElement | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement) || target.type !== 'file') return false
  if (target.id === KETCHER_IMAGE_UPLOAD_INPUT_ID) return true
  return Boolean(root?.contains(target) && target.accept.toLowerCase().includes('image/'))
}

function preventEvent(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

function useKetcherImageUploadGuard(rootRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const preventImageInput = (event: Event) => {
      if (!isImageFileInput(event.target, rootRef.current)) return
      event.target.value = ''
      preventEvent(event)
    }

    const preventImageDrop = (event: DragEvent) => {
      const target = event.target
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.some(isImageFile)) return
      preventEvent(event)
    }

    document.addEventListener('input', preventImageInput, true)
    document.addEventListener('change', preventImageInput, true)
    document.addEventListener('drop', preventImageDrop, true)

    return () => {
      document.removeEventListener('input', preventImageInput, true)
      document.removeEventListener('change', preventImageInput, true)
      document.removeEventListener('drop', preventImageDrop, true)
    }
  }, [rootRef])
}

export function KetcherEditor({ onError, onInit }: Readonly<KetcherEditorProps>) {
  const rootRef = useRef<HTMLDivElement>(null)
  useKetcherImageUploadGuard(rootRef)

  return (
    <div ref={rootRef} className="ketcher-no-image-upload h-full w-full">
      <Editor
        staticResourcesUrl="/"
        structServiceProvider={structServiceProvider}
        buttons={DISABLED_IMAGE_UPLOAD_BUTTONS}
        disableMacromoleculesEditor
        errorHandler={onError}
        onInit={onInit}
      />
    </div>
  )
}
