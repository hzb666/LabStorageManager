import React, { useState, useCallback, useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Label } from '@/components/ui/Label'
import { Textarea } from '@/components/ui/Textarea'
import { LABEL_STYLES, INPUT_STYLES } from '@/lib/constants'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { announcementAPI, type Announcement } from '@/api/client'
import { toast } from '@/lib/toast'
import { getApiErrorMessage } from '@/lib/validationSchemas'
import { formatDate, cn, getFullImageUrl } from '@/lib/utils'
import useDialogState from '@/hooks/useDialogState'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip'
import {
  Megaphone,
  Loader2,
  Trash2,
  Edit,
  Pin,
  PinOff,
  Eye,
  EyeOff,
  Plus,
  X,
  Upload,
  Image as ImageIcon,
  HardDrive,
} from 'lucide-react'

type AnnouncementDialogMode = 'create' | 'edit' | 'delete'
// `all` 表示不过滤，`visible / hidden` 分别映射 `is_visible` 的两种状态。
type VisibilityFilter = 'all' | 'visible' | 'hidden'
// `all` 表示不过滤，`pinned / unpinned` 分别映射 `is_pinned` 的两种状态。
type PinnedFilter = 'all' | 'pinned' | 'unpinned'

// 创建和编辑共用这份本地表单草稿，也是 `create / update` 提交时使用的数据形状。
interface AnnouncementFormState {
  title: string
  content: string
  images: string[]
  is_pinned: boolean
  is_visible: boolean
}

type AnnouncementStorageInfo = {
  usage_percent?: number
  used_mb?: number
  max_mb?: number
}

interface AnnouncementImageUploadProps {
  uploading: boolean
  isDragging: boolean
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  onDragEnter: (event: React.DragEvent) => void
  onDragLeave: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => Promise<void>
}

// 列表 controller 只依赖编辑和删除入口，查询和表格逻辑不直接感知弹窗状态。
type AnnouncementListControllerParams = {
  onEdit: (announcement: Announcement) => void
  onDelete: (announcement: Announcement) => void
}

type AnnouncementDialogActionsParams = {
  formData: AnnouncementFormState
  editingId: number | null
  deleteId: number | null
  setFormData: React.Dispatch<React.SetStateAction<AnnouncementFormState>>
  setFormErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setFormLoading: React.Dispatch<React.SetStateAction<boolean>>
  setDeleteLoading: React.Dispatch<React.SetStateAction<boolean>>
  setUploading: React.Dispatch<React.SetStateAction<boolean>>
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>
  setDialogState: (value: AnnouncementDialogMode | null) => void
  setDeleteId: React.Dispatch<React.SetStateAction<number | null>>
  resetForm: () => void
  refetchAnnouncements: () => void
}

const columnHelper = createColumnHelper<Announcement>()

function getEmptyAnnouncementFormState(): AnnouncementFormState {
  return {
    title: '',
    content: '',
    images: [],
    is_pinned: false,
    is_visible: true,
  }
}

function validateAnnouncementForm(formData: AnnouncementFormState) {
  const errors: Record<string, string> = {}

  if (!formData.title.trim()) {
    errors.title = '请输入公告标题'
  } else if (formData.title.length > 200) {
    errors.title = '标题不能超过200字符'
  }

  if (!formData.content.trim()) {
    errors.content = '请输入公告内容'
  } else if (formData.content.length > 10000) {
    errors.content = '内容不能超过10000字符'
  }

  return errors
}

function filterAnnouncements(
  announcements: Announcement[],
  visibilityFilter: VisibilityFilter,
  pinnedFilter: PinnedFilter
) {
  return announcements.filter((announcement) => {
    if (visibilityFilter === 'visible' && !announcement.is_visible) {
      return false
    }

    if (visibilityFilter === 'hidden' && announcement.is_visible) {
      return false
    }

    if (pinnedFilter === 'pinned' && !announcement.is_pinned) {
      return false
    }

    if (pinnedFilter === 'unpinned' && announcement.is_pinned) {
      return false
    }

    return true
  })
}

// 上传校验只接受 `image/*` 且不超过 5MB；点击上传和拖拽上传共用这套规则。
function validateAnnouncementImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    return '请选择图片文件'
  }

  if (file.size > 5 * 1024 * 1024) {
    return '图片大小不能超过 5MB'
  }

  return null
}

// `create / edit` 分别映射到对应标题，删除确认不走这套标题逻辑。
function getAnnouncementDialogTitle(dialogState: AnnouncementDialogMode | null) {
  if (dialogState === 'create') {
    return '创建公告'
  }

  if (dialogState === 'edit') {
    return '编辑公告'
  }

  return ''
}

// 提交按钮文案按 `create / edit` 模式切换，`formLoading` 决定是否展示进行中文案。
function getAnnouncementSubmitLabel(dialogState: AnnouncementDialogMode | null, formLoading: boolean) {
  if (dialogState === 'create') {
    return formLoading ? '创建中...' : '创建'
  }

  if (dialogState === 'edit') {
    return formLoading ? '保存中...' : '保存'
  }

  return ''
}

function AnnouncementStorageBar({
  storageInfo,
}: {
  storageInfo: AnnouncementStorageInfo | undefined
}) {
  return (
    <div className="relative flex-1 h-10 rounded-md border border-input bg-card overflow-hidden flex items-center">
      <div
        className="absolute inset-y-0 left-0 bg-muted transition-all duration-500 ease-in-out"
        style={{ width: `${Math.min(storageInfo?.usage_percent ?? 0, 100)}%` }}
      />
      <div className="relative z-10 flex items-center justify-between w-full px-3 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-base text-foreground truncate">
            存储: <span>{storageInfo?.used_mb ?? 0}</span> / {storageInfo?.max_mb ?? 50} MB
          </span>
        </div>
      </div>
    </div>
  )
}

function AnnouncementActionsCell({
  announcement,
  onTogglePin,
  onToggleVisibility,
  onEdit,
  onDelete,
}: {
  announcement: Announcement
  onTogglePin: (id: number) => Promise<void>
  onToggleVisibility: (id: number) => Promise<void>
  onEdit: (announcement: Announcement) => void
  onDelete: (announcement: Announcement) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="modern"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(event) => {
              event.stopPropagation()
              void onTogglePin(announcement.id)
            }}
          >
            {announcement.is_pinned ? (
              <PinOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500" />
            ) : (
              <Pin className="w-3.5 h-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{announcement.is_pinned ? '取消置顶' : '置顶'}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="modern"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(event) => {
              event.stopPropagation()
              void onToggleVisibility(announcement.id)
            }}
          >
            {announcement.is_visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{announcement.is_visible ? '隐藏' : '显示'}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="modern"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(event) => {
              event.stopPropagation()
              onEdit(announcement)
            }}
          >
            <Edit className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>编辑</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="modern"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(announcement)
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>删除</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function buildAnnouncementColumns(params: {
  onTogglePin: (id: number) => Promise<void>
  onToggleVisibility: (id: number) => Promise<void>
  onEdit: (announcement: Announcement) => void
  onDelete: (announcement: Announcement) => void
}) {
  return [
    columnHelper.accessor('title', {
      header: '标题',
      size: 200,
      cell: (info) => {
        const isPinned = info.row.original.is_pinned
        const isVisible = info.row.original.is_visible
        const title = info.getValue()

        return (
          <div className="flex items-center gap-2 min-w-0">
            {isPinned && <Pin className="size-4 text-amber-600 dark:text-amber-500 shrink-0" />}
            <span className={cn('truncate', !isVisible && 'text-muted-foreground')} title={title}>
              {title}
            </span>
            {!isVisible && <span className="text-sm text-muted-foreground shrink-0">(已隐藏)</span>}
          </div>
        )
      },
    }),
    columnHelper.accessor('content', {
      header: '内容',
      size: 300,
      cell: (info) => (
        <div className="truncate" title={info.getValue()}>
          {info.getValue()}
        </div>
      ),
    }),
    columnHelper.accessor('images', {
      header: '图片',
      size: 80,
      cell: (info) => {
        const images = info.getValue()
        if (!images || images.length === 0) {
          return '-'
        }

        return (
          <div className="flex items-center gap-1">
            <ImageIcon className="w-4 h-4" />
            <span>{images.length}</span>
          </div>
        )
      },
    }),
    columnHelper.accessor('created_at', {
      header: '创建时间',
      size: 150,
      cell: (info) => formatDate(info.getValue()),
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 180,
      cell: (info) => (
        <AnnouncementActionsCell
          announcement={info.row.original}
          onTogglePin={params.onTogglePin}
          onToggleVisibility={params.onToggleVisibility}
          onEdit={params.onEdit}
          onDelete={params.onDelete}
        />
      ),
    }),
  ]
}

function AnnouncementFiltersBar({
  listController,
}: {
  listController: ReturnType<typeof useAnnouncementListController>
}) {
  return (
    <div className="flex items-center gap-3">
      <AnnouncementStorageBar storageInfo={listController.storageInfo} />
      <Select
        value={listController.visibilityFilter}
        onValueChange={(value) => listController.setVisibilityFilter(value as VisibilityFilter)}
      >
        <SelectTrigger className="w-30 min-h-10">
          <SelectValue placeholder="显示状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="visible">显示</SelectItem>
          <SelectItem value="hidden">隐藏</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={listController.pinnedFilter}
        onValueChange={(value) => listController.setPinnedFilter(value as PinnedFilter)}
      >
        <SelectTrigger className="w-30 min-h-10">
          <SelectValue placeholder="置顶状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="pinned">置顶</SelectItem>
          <SelectItem value="unpinned">未置顶</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function AnnouncementTableContent({
  isLoading,
  rowCount,
  table,
}: {
  isLoading: boolean
  rowCount: number
  table: ReturnType<typeof useReactTable<Announcement>>
}) {
  if (isLoading && rowCount === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (rowCount === 0) {
    return <div className="text-center py-8 text-muted-foreground">暂无公告数据</div>
  }

  return (
    <div className="px-6 rounded-md overflow-auto">
      <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b-2 border-border">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-11 px-3 font-bold text-foreground text-left align-middle text-base"
                  style={{ width: header.getSize() }}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-border hover:bg-muted/30">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="p-3 align-middle text-base"
                  style={{ width: cell.column.getSize() }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AnnouncementTableCard({
  listController,
}: {
  listController: ReturnType<typeof useAnnouncementListController>
}) {
  const announcementCount = listController.filteredAnnouncements.length

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
          <Megaphone className="w-5 h-5" />
          公告列表 <span className="text-muted-foreground font-normal">(&thinsp;{announcementCount}&thinsp;)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <AnnouncementTableContent
          isLoading={listController.isLoading}
          rowCount={announcementCount}
          table={listController.table}
        />
      </CardContent>
    </Card>
  )
}

function AnnouncementImageList({
  images,
  onRemoveImage,
}: {
  images: string[]
  onRemoveImage: (url: string) => Promise<void>
}) {
  if (images.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((url, index) => (
        <div key={url} className="relative group">
          <img
            src={getFullImageUrl(url)}
            alt={`图片 ${index + 1}`}
            className="w-20 h-20 object-cover rounded-md border border-input"
          />
          <button
            type="button"
            onClick={() => void onRemoveImage(url)}
            className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <X className="size-3.5 stroke-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

function AnnouncementImageUploader({
  uploading,
  isDragging,
  onUpload,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: AnnouncementImageUploadProps) {
  const uploadIcon = uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />
  const uploadLabel = uploading ? '上传中...' : '点击或拖拽上传图片'

  return (
    <label
      className={cn(
        'flex items-center justify-center w-full h-20 border-2 border-dashed rounded-md cursor-pointer transition-colors',
        isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={(event) => void onDrop(event)}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {uploadIcon}
        <span>{uploadLabel}</span>
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => void onUpload(event)}
        disabled={uploading}
        className="hidden"
      />
    </label>
  )
}

function AnnouncementFormFields({
  dialogStateModel,
  dialogActions,
  upload,
}: {
  dialogStateModel: ReturnType<typeof useAnnouncementDialogStateModel>
  dialogActions: ReturnType<typeof useAnnouncementDialogActions>
  upload: AnnouncementImageUploadProps
}) {
  return (
    <div className="grid gap-4">
      <div>
        <Label htmlFor="announcement_title" className={LABEL_STYLES.base}>
          标题 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="announcement_title"
          value={dialogStateModel.formData.title}
          onChange={(event) => dialogStateModel.handleFormFieldChange('title', event.target.value)}
          placeholder="请输入公告标题"
          className={cn(INPUT_STYLES.lg, dialogStateModel.formErrors.title && 'border-destructive')}
        />
        {dialogStateModel.formErrors.title && <p className="text-sm text-destructive mt-1">{dialogStateModel.formErrors.title}</p>}
      </div>

      <div>
        <Label htmlFor="announcement_content" className={LABEL_STYLES.base}>
          内容 <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="announcement_content"
          value={dialogStateModel.formData.content}
          onChange={(event) => dialogStateModel.handleFormFieldChange('content', event.target.value)}
          placeholder="请输入公告内容"
          rows={5}
          className={cn(dialogStateModel.formErrors.content && 'border-destructive')}
        />
        {dialogStateModel.formErrors.content && <p className="text-sm text-destructive mt-1">{dialogStateModel.formErrors.content}</p>}
      </div>

      <div>
        <Label className={LABEL_STYLES.base}>图片</Label>
        <div className="mt-2 space-y-2">
          <AnnouncementImageList
            images={dialogStateModel.formData.images}
            onRemoveImage={dialogActions.handleRemoveImage}
          />
          <AnnouncementImageUploader
            {...upload}
          />
          <p className="text-sm text-muted-foreground">支持 jpg, png, gif, webp 格式，最大 5MB</p>
        </div>
      </div>
    </div>
  )
}

function AnnouncementFormDialog({
  dialogStateModel,
  dialogActions,
  upload,
}: {
  dialogStateModel: ReturnType<typeof useAnnouncementDialogStateModel>
  dialogActions: ReturnType<typeof useAnnouncementDialogActions>
  upload: AnnouncementImageUploadProps
}) {
  const isOpen =
    dialogStateModel.dialogState === 'create' || dialogStateModel.dialogState === 'edit'
  const dialogTitle = getAnnouncementDialogTitle(dialogStateModel.dialogState)
  const submitLabel = getAnnouncementSubmitLabel(
    dialogStateModel.dialogState,
    dialogStateModel.formLoading
  )

  return (
    <Dialog open={isOpen} onOpenChange={dialogStateModel.handleDialogChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <AnnouncementFormFields
          dialogStateModel={dialogStateModel}
          dialogActions={dialogActions}
          upload={upload}
        />
        <div className="flex gap-3 mt-6">
          <Button variant="modern" onClick={() => dialogStateModel.handleDialogChange(false)} size="lg" className="flex-1">
            取消
          </Button>
          <Button onClick={dialogActions.handleSubmit} disabled={dialogStateModel.formLoading} size="lg" className="flex-1">
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AnnouncementDeleteDialog({
  dialogStateModel,
  dialogActions,
}: {
  dialogStateModel: ReturnType<typeof useAnnouncementDialogStateModel>
  dialogActions: ReturnType<typeof useAnnouncementDialogActions>
}) {
  return (
    <Dialog
      open={dialogStateModel.dialogState === 'delete'}
      onOpenChange={dialogStateModel.handleDeleteDialogChange}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认删除公告</DialogTitle>
        </DialogHeader>
        <div>
          <p>确定要删除这条公告吗？</p>
          <p className="text-sm text-muted-foreground mt-1">此操作不可恢复，关联的图片也将被删除。</p>
        </div>
        <div className="flex gap-3 mt-8">
          <Button variant="destructive" onClick={dialogActions.handleDelete} disabled={dialogStateModel.deleteLoading} size="lg" className="flex-1">
            {dialogStateModel.deleteLoading ? '处理中...' : '确认删除'}
          </Button>
          <Button variant="modern" onClick={() => dialogStateModel.handleDeleteDialogChange(false)} size="lg" className="flex-1">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 列表 controller 负责查询、筛选、表格装配和刷新，不直接管理弹窗本地状态。
function useAnnouncementListController({ onEdit, onDelete }: AnnouncementListControllerParams) {
  const queryClient = useQueryClient()
  const [sorting] = useState<SortingState>([])
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all')
  const [pinnedFilter, setPinnedFilter] = useState<PinnedFilter>('all')

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const response = await announcementAPI.list()
      return response.data || []
    },
    placeholderData: keepPreviousData,
  })

  const { data: storageInfo } = useQuery({
    queryKey: ['announcementStorageInfo'],
    queryFn: async () => {
      const response = await announcementAPI.getStorageInfo()
      return response.data
    },
  })

  const refetchAnnouncements = useCallback(() => {
    // 列表和存储占用条来自不同 query，刷新时必须一起失效，避免 UI 显示不同步。
    queryClient.invalidateQueries({ queryKey: ['announcements'] })
    queryClient.invalidateQueries({ queryKey: ['announcementStorageInfo'] })
  }, [queryClient])

  const handleTogglePin = useCallback(async (id: number) => {
    try {
      await announcementAPI.togglePin(id)
      refetchAnnouncements()
      toast.success('置顶状态已更新')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '操作失败'))
    }
  }, [refetchAnnouncements])

  const handleToggleVisibility = useCallback(async (id: number) => {
    try {
      await announcementAPI.toggleVisibility(id)
      refetchAnnouncements()
      toast.success('显示状态已更新')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '操作失败'))
    }
  }, [refetchAnnouncements])

  const filteredAnnouncements = useMemo(
    // 先在内存里按双筛选条件过滤，再交给表格做排序与渲染，避免重复请求后端。
    () => filterAnnouncements(announcements, visibilityFilter, pinnedFilter),
    [announcements, visibilityFilter, pinnedFilter]
  )

  const columns = useMemo(
    () =>
      buildAnnouncementColumns({
        onTogglePin: handleTogglePin,
        onToggleVisibility: handleToggleVisibility,
        onEdit,
        onDelete,
      }),
    [handleTogglePin, handleToggleVisibility, onDelete, onEdit]
  )

  // table 实例只在当前 hook 内使用，这里定点忽略编译器告警。
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredAnnouncements,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
  })

  return {
    visibilityFilter,
    pinnedFilter,
    storageInfo,
    filteredAnnouncements,
    isLoading,
    table,
    setVisibilityFilter,
    setPinnedFilter,
    refetchAnnouncements,
  }
}

// 弹窗 state model 只维护本地表单、删除目标和开关状态，不承载副作用提交。
function useAnnouncementDialogStateModel() {
  const [dialogState, setDialogState] = useDialogState<AnnouncementDialogMode>()
  const [formData, setFormData] = useState<AnnouncementFormState>(() => getEmptyAnnouncementFormState())
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [formLoading, setFormLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const resetForm = useCallback(() => {
    setFormData(getEmptyAnnouncementFormState())
    setFormErrors({})
    setEditingId(null)
  }, [])

  const openEditModal = useCallback((announcement: Announcement) => {
    setEditingId(announcement.id)
    setFormData({
      title: announcement.title,
      content: announcement.content,
      images: [...announcement.images],
      is_pinned: announcement.is_pinned,
      is_visible: announcement.is_visible,
    })
    setFormErrors({})
    setDialogState('edit')
  }, [setDialogState])

  const openDeleteModal = useCallback((announcement: Announcement) => {
    setDeleteId(announcement.id)
    setDialogState('delete')
  }, [setDialogState])

  const handleFormFieldChange = useCallback(<K extends keyof AnnouncementFormState>(
    field: K,
    value: AnnouncementFormState[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleDialogChange = useCallback((open: boolean) => {
    if (!open) {
      // create/edit 关闭时重置草稿，防止上次未提交内容污染下一次打开。
      setDialogState(null)
      resetForm()
    }
  }, [resetForm, setDialogState])

  const handleDeleteDialogChange = useCallback((open: boolean) => {
    setDialogState(open ? 'delete' : null)
    if (!open) {
      setDeleteId(null)
    }
  }, [setDialogState])

  return {
    dialogState,
    formData,
    formErrors,
    formLoading,
    editingId,
    deleteId,
    deleteLoading,
    uploading,
    isDragging,
    setDialogState,
    setFormData,
    setFormErrors,
    setFormLoading,
    setDeleteLoading,
    setUploading,
    setIsDragging,
    setDeleteId,
    resetForm,
    openEditModal,
    openDeleteModal,
    handleFormFieldChange,
    handleDialogChange,
    handleDeleteDialogChange,
  }
}

// dialog actions 负责提交、删除、上传和拖拽等副作用；仅提交与删除成功后刷新列表，图片相关操作不触发表格刷新。
function useAnnouncementDialogActions({
  formData,
  editingId,
  deleteId,
  setFormData,
  setFormErrors,
  setFormLoading,
  setDeleteLoading,
  setUploading,
  setIsDragging,
  setDialogState,
  setDeleteId,
  resetForm,
  refetchAnnouncements,
}: AnnouncementDialogActionsParams) {
  const handleSubmit = useCallback(async () => {
    const errors = validateAnnouncementForm(formData)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    setFormLoading(true)
    try {
      if (editingId) {
        await announcementAPI.update(editingId, formData)
        toast.success('公告更新成功')
      } else {
        await announcementAPI.create(formData)
        toast.success('公告创建成功')
      }

      setDialogState(null)
      resetForm()
      refetchAnnouncements()
    } catch (error) {
      toast.error(getApiErrorMessage(error, '操作失败'))
    } finally {
      setFormLoading(false)
    }
  }, [editingId, formData, refetchAnnouncements, resetForm, setDialogState, setFormErrors, setFormLoading])

  const handleDelete = useCallback(async () => {
    if (!deleteId) {
      return
    }

    setDeleteLoading(true)
    try {
      await announcementAPI.delete(deleteId)
      setDialogState(null)
      setDeleteId(null)
      refetchAnnouncements()
      toast.success('公告删除成功')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '删除失败'))
    } finally {
      setDeleteLoading(false)
    }
  }, [deleteId, refetchAnnouncements, setDeleteId, setDeleteLoading, setDialogState])

  const appendUploadedImage = useCallback((url: string) => {
    setFormData((prev) => ({
      ...prev,
      images: [...prev.images, url],
    }))
  }, [setFormData])

  const uploadSingleImage = useCallback(async (file: File, skipValidation = false) => {
    if (!skipValidation) {
      const validationMessage = validateAnnouncementImageFile(file)
      if (validationMessage) {
        toast.error(validationMessage)
        return
      }
    }

    setUploading(true)
    try {
      const url = await announcementAPI.uploadImage(file)
      appendUploadedImage(url)
      toast.success('图片上传成功')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '图片上传失败'))
    } finally {
      setUploading(false)
    }
  }, [appendUploadedImage, setUploading])

  const handleUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const validationMessage = validateAnnouncementImageFile(file)
    if (validationMessage) {
      toast.error(validationMessage)
      return
    }

    await uploadSingleImage(file, true)
    event.target.value = ''
  }, [uploadSingleImage])

  const handleRemoveImage = useCallback(async (url: string) => {
    try {
      const filename = url.split('/').pop()
      if (filename) {
        await announcementAPI.deleteImage(filename)
      }
      setFormData((prev) => ({
        ...prev,
        images: prev.images.filter((imageUrl) => imageUrl !== url),
      }))
      toast.success('图片已移除')
    } catch (error) {
      toast.error(getApiErrorMessage(error, '图片移除失败'))
    }
  }, [setFormData])

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }, [setIsDragging])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }, [setIsDragging])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    for (const file of files) {
      await uploadSingleImage(file)
    }
  }, [setIsDragging, uploadSingleImage])

  return {
    handleSubmit,
    handleDelete,
    handleUpload,
    handleRemoveImage,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  }
}

export function AnnouncementManagement() {
  const dialogStateModel = useAnnouncementDialogStateModel()
  const listController = useAnnouncementListController({
    onEdit: dialogStateModel.openEditModal,
    onDelete: dialogStateModel.openDeleteModal,
  })
  const dialogActions = useAnnouncementDialogActions({
    formData: dialogStateModel.formData,
    editingId: dialogStateModel.editingId,
    deleteId: dialogStateModel.deleteId,
    setFormData: dialogStateModel.setFormData,
    setFormErrors: dialogStateModel.setFormErrors,
    setFormLoading: dialogStateModel.setFormLoading,
    setDeleteLoading: dialogStateModel.setDeleteLoading,
    setUploading: dialogStateModel.setUploading,
    setIsDragging: dialogStateModel.setIsDragging,
    setDialogState: dialogStateModel.setDialogState,
    setDeleteId: dialogStateModel.setDeleteId,
    resetForm: dialogStateModel.resetForm,
    refetchAnnouncements: listController.refetchAnnouncements,
  })
  const formUploadProps: AnnouncementImageUploadProps = {
    uploading: dialogStateModel.uploading,
    isDragging: dialogStateModel.isDragging,
    onUpload: dialogActions.handleUpload,
    onDragEnter: dialogActions.handleDragEnter,
    onDragLeave: dialogActions.handleDragLeave,
    onDragOver: dialogActions.handleDragOver,
    onDrop: dialogActions.handleDrop,
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">公告管理</h1>
        <Button onClick={() => dialogStateModel.setDialogState('create')} size="lg">
          <Plus className="w-4 h-4 mr-1.5" />
          创建公告
        </Button>
      </div>

      <AnnouncementFiltersBar listController={listController} />

      <AnnouncementTableCard listController={listController} />

      <AnnouncementFormDialog
        dialogStateModel={dialogStateModel}
        dialogActions={dialogActions}
        upload={formUploadProps}
      />

      <AnnouncementDeleteDialog dialogStateModel={dialogStateModel} dialogActions={dialogActions} />
    </div>
  )
}
