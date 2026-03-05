import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Announcement } from '@/api/client'

interface AnnouncementDetailProps {
  announcement: Announcement | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AnnouncementDetail({ announcement, open, onOpenChange }: AnnouncementDetailProps) {
  if (!announcement) {
    return null
  }

  // Parse content to handle line breaks
  const formattedContent = announcement.content.split('\n').map((line, index) => (
    <p key={index} className="mb-2">
      {line || <br />}
    </p>
  ))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {announcement.is_pinned && (
              <span className="text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded">
                置顶
              </span>
            )}
            {announcement.title}
          </DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 p-1 rounded-md hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Publication time */}
          <div className="text-sm text-muted-foreground">
            发布时间:{' '}
            {new Date(announcement.created_at).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>

          {/* Content */}
          <div className="prose dark:prose-invert max-w-none">
            <div className="text-base leading-relaxed">{formattedContent}</div>
          </div>

          {/* Images */}
          {announcement.images && announcement.images.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">附件图片</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {announcement.images.map((image, index) => (
                  <div
                    key={index}
                    className="relative aspect-square rounded-lg overflow-hidden border border-border"
                  >
                    <img
                      src={image}
                      alt={`${announcement.title} - 图片 ${index + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // Hide image on error
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
