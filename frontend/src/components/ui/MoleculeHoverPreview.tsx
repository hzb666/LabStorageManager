import { useState, type ReactNode } from 'react'
import {
  autoUpdate, flip, FloatingPortal, offset, safePolygon, shift, size,
  useDismiss, useFloating, useHover, useInteractions, useRole, useTransitionStyles,
} from '@floating-ui/react'
import { MoleculeStructure, MoleculeSurface } from '@/components/ui/MoleculeStructure'
import { useIsMobile } from '@/hooks/useMobile'
import { isSpecialCasValue } from '@/lib/validationSchemas'

/** 复用分子结构的查询、渲染缓存与悬浮放大，只在需要预览时挂载。 */
export function MoleculeHoverPreview({ casNumber, disabled, children }: Readonly<{
  casNumber: string
  disabled: boolean
  children: ReactNode
}>) {
  const isMobile = useIsMobile()
  const normalizedCas = casNumber.trim()
  if (disabled || isMobile || !normalizedCas || isSpecialCasValue(normalizedCas)) {
    return children
  }
  return <DesktopMoleculeHoverPreview key={normalizedCas} casNumber={normalizedCas}>{children}</DesktopMoleculeHoverPreview>
}

function DesktopMoleculeHoverPreview({ casNumber, children }: Readonly<{
  casNumber: string
  children: ReactNode
}>) {
  const [visible, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open: visible,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 12, fallbackPlacements: ['top-start'] }),
      shift({ padding: 12, crossAxis: true }),
      size({
        padding: 12,
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.max(0, availableWidth)}px`,
            maxHeight: `${Math.max(0, availableHeight)}px`,
          })
        },
      }),
    ],
  })
  const hover = useHover(context, {
    mouseOnly: true,
    delay: { open: 250, close: 0 },
    handleClose: safePolygon({ requireIntent: false }),
  })
  const dismiss = useDismiss(context, { ancestorScroll: true })
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role])
  const { setReference, setFloating } = refs
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 200,
    initial: { opacity: 0, transform: 'none' },
    open: { opacity: 1, transform: 'none' },
    close: { opacity: 0, transform: 'none' },
  })

  return (
    <>
      <div ref={setReference} className="block min-w-0" {...getReferenceProps()}>
        {children}
      </div>
      {isMounted && (
        <FloatingPortal>
          <div
            ref={setFloating}
            style={floatingStyles}
            className="z-50"
            {...getFloatingProps()}
            onClick={(event) => event.stopPropagation()}
          >
            <MoleculeSurface
              style={{ ...transitionStyles, maxWidth: 'inherit', maxHeight: 'inherit', pointerEvents: visible ? 'auto' : 'none' }}
              className="overflow-auto p-2 text-popover-foreground"
            >
              <MoleculeStructure casNumber={casNumber} width={240} height={160} inlineZoom tooltipSideOffset={16} />
            </MoleculeSurface>
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
