import { useState } from 'react'
import { Pin, X, ZoomIn } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { type Announcement } from '@/api/client'
import { Button } from './ui/Button'
import { formatDateTime } from '@/lib/utils'

// 获取完整的图片URL，处理相对路径和绝对路径
const getFullImageUrl = (url: string): string => {
  if (!url) return ''
  // 如果已经是完整URL（以http或https开头），直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  // 获取 API 基础 URL，如果没有设置则默认为开发环境的后端地址
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

  if (!announcement) {
    return null
  }

  // Parse content to handle line breaks
  const formattedContent = announcement.content.split('\n').map((line, index) => (
    <p key={index} className="mb-2">
      {line || <br />}
    </p>
  ))

  // 判断是否有图片，用于动态设置弹窗宽度
  const hasImages = announcement.images && announcement.images.length > 0
  const dialogWidthClass = hasImages ? 'max-w-4xl' : 'max-w-2xl'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogWidthClass} max-h-[80vh] overflow-y-auto`}>
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
          {/* Publication time */}
          <div className="text-muted-foreground">
            发布时间: {formatDateTime(announcement.created_at)}
          </div>

          {/* Content */}
          <div className="prose dark:prose-invert max-w-none">
            <div className="text-base leading-relaxed">{formattedContent}</div>
          </div>

          {/* Images */}
          {announcement.images && announcement.images.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm text-muted-foreground">附件图片</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {announcement.images.map((image, index) => {
                  // 转换为完整URL
                  const fullImageUrl = getFullImageUrl(image)
                  // 调试日志
                  console.log('[AnnouncementDetail] Image URL:', image, 'Full URL:', fullImageUrl, 'Index:', index)
                  return (
                    <div
                      key={index}
                      className="relative aspect-square rounded-lg overflow-hidden border border-border cursor-pointer group"
                      onClick={() => setSelectedImageIndex(index)}
                    >
                      <img
                        src={fullImageUrl}
                        alt={`${announcement.title} - 图片 ${index + 1}`}
                        className="w-full h-full object-cover"
                        onLoad={() => {
                          console.log('[AnnouncementDetail] Image loaded successfully:', fullImageUrl)
                        }}
                        onError={(e) => {
                          // Hide image on error
                          console.error('[AnnouncementDetail] Image failed to load:', fullImageUrl)
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                        }}
                      />
                      {/* Hover overlay with zoom icon */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Image viewer modal */}
      <Dialog 
        open={selectedImageIndex !== null} 
        onOpenChange={(open) => {
          if (!open) setSelectedImageIndex(null)
        }}
      >
        <DialogContent className="bg-transparent border-none p-0 shadow-none max-w-[90vw] max-h-[90vh]">          
          {selectedImageIndex !== null && announcement.images && announcement.images[selectedImageIndex] && (
            <div className="flex items-center justify-center p-4">
              <img
                src={getFullImageUrl(announcement.images[selectedImageIndex])}
                alt={`${announcement.title} - 图片 ${selectedImageIndex + 1}`}
                className="max-w-[85vw] max-h-[85vh] object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
