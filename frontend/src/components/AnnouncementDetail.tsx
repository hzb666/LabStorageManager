import { useState } from 'react'
import { Pin, X, ZoomIn } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { type Announcement } from '@/api/client'
import { Button } from './ui/Button'
import { formatDateTime } from '@/lib/utils'

const getFullImageUrl = (url: string): string => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  return `${API_BASE_URL}${url}`
}

interface AnnouncementDetailProps {
  announcement: Announcement | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AnnouncementDetail({ announcement, open, onOpenChange }: AnnouncementDetailProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null)

  const hasImages = Boolean(announcement?.images && announcement.images.length > 0)
  
  const formattedContent = (announcement?.content || '').split('\n').map((line, index) => (
    <p key={index} className="mb-2">
      {line || <br />}
    </p>
  ))

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent 
          className={`!max-w-none w-[90vw] max-h-[80vh] overflow-y-scroll transition-none ${
            hasImages ? 'sm:!w-[700px]' : 'sm:!w-auto'
          }`}
        >
          {announcement && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-8 mb-4 break-words">
                  {announcement.is_pinned && <Pin className="size-4 text-amber-600 dark:text-amber-500 shrink-0" />}
                  <span className="break-words">{announcement.title}</span>
                </DialogTitle>
                <Button
                  variant="ghost"
                  className="absolute right-4 top-4 p-1 size-8"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </DialogHeader>

              <div className="space-y-4 mt-2">
                <div className="text-muted-foreground">
                  发布时间: {formatDateTime(announcement.created_at)}
                </div>

                <div className="prose dark:prose-invert max-w-none">
                  <div className="text-base leading-relaxed">{formattedContent}</div>
                </div>

                {hasImages && announcement.images && (
                  <div className="space-y-2">
                    <h4 className="text-sm text-muted-foreground">附件图片</h4>
                    {/* 给外层 grid 彻底写死 100% 宽度 */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 min-h-[100px] w-full">
                      {announcement.images.map((image, index) => {
                        const fullImageUrl = getFullImageUrl(image)
                        return (
                          <div
                            key={index}
                            className="relative aspect-square w-full rounded-lg overflow-hidden border border-border cursor-pointer group bg-muted animate-pulse"
                            onClick={() => setSelectedImageIndex(index)}
                          >
                            <img
                              src={fullImageUrl}
                              alt={`${announcement.title} - 图片 ${index + 1}`}
                              className="absolute inset-0 w-full h-full object-cover"
                              onLoad={(e) => {
                                const target = e.target as HTMLImageElement
                                target.parentElement?.classList.remove('animate-pulse', 'bg-muted')
                              }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement
                                target.style.display = 'none'
                              }}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center z-10">
                              <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 图片放大预览弹窗 */}
      <Dialog 
        open={selectedImageIndex !== null} 
        onOpenChange={(val) => {
          if (!val) setSelectedImageIndex(null)
        }}
      >
        <DialogContent className="!max-w-none w-auto bg-transparent border-none p-0 shadow-none max-h-[90vh] flex items-center justify-center">
          {selectedImageIndex !== null && announcement?.images && announcement.images[selectedImageIndex] && (
            <img
              src={getFullImageUrl(announcement.images[selectedImageIndex])}
              alt={`${announcement.title} - 图片 ${selectedImageIndex + 1}`}
              className="max-w-[90vw] max-h-[90vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}