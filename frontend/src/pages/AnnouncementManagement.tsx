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

/**
 * 定义公告弹窗当前处于创建、编辑或删除确认哪一种模式。
 * 这个类型存在是为了统一弹窗状态取值，避免在组件之间传递不受约束的字符串。
 */
type AnnouncementDialogMode = 'create' | 'edit' | 'delete'
/**
 * 定义公告“显示状态”筛选器可选值（全部、显示、隐藏）。
 * 这个类型存在是为了让筛选逻辑与下拉选择保持同一套受限枚举，减少状态分支错误。
 */
type VisibilityFilter = 'all' | 'visible' | 'hidden'
/**
 * 定义公告“置顶状态”筛选器可选值（全部、置顶、未置顶）。
 * 这个类型存在是为了让置顶筛选条件在状态、UI 和过滤函数之间保持一致语义。
 */
type PinnedFilter = 'all' | 'pinned' | 'unpinned'

/**
 * 定义公告表单在创建/编辑时需要维护的字段状态。
 * 这个接口存在是为了集中约束表单数据结构，便于校验、重置与提交复用同一数据模型。
 */
interface AnnouncementFormState {
  title: string
  content: string
  images: string[]
  is_pinned: boolean
  is_visible: boolean
}

/**
 * 定义公告管理展示层组件所需的全部数据与回调入参。
 * 这个接口存在是为了把页面状态和交互契约显式化，降低壳层组件与子组件之间的耦合和传参歧义。
 */
interface AnnouncementManagementContentProps {
  visibilityFilter: VisibilityFilter
  pinnedFilter: PinnedFilter
  storageInfo: { usage_percent?: number; used_mb?: number; max_mb?: number } | undefined
  filteredAnnouncements: Announcement[]
  isLoading: boolean
  table: ReturnType<typeof useReactTable<Announcement>>
  dialogState: AnnouncementDialogMode | null
  formData: AnnouncementFormState
  formErrors: Record<string, string>
  formLoading: boolean
  deleteLoading: boolean
  uploading: boolean
  isDragging: boolean
  onSetDialogState: (value: AnnouncementDialogMode | null) => void
  onVisibilityFilterChange: (value: VisibilityFilter) => void
  onPinnedFilterChange: (value: PinnedFilter) => void
  onFormFieldChange: <K extends keyof AnnouncementFormState>(field: K, value: AnnouncementFormState[K]) => void
  onDialogChange: (open: boolean) => void
  onDeleteDialogChange: (open: boolean) => void
  onSubmit: () => Promise<void>
  onDelete: () => Promise<void>
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  onRemoveImage: (url: string) => Promise<void>
  onDragEnter: (event: React.DragEvent) => void
  onDragLeave: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => Promise<void>
}

/**
 * 定义公告列表控制器的外部回调参数（编辑与删除入口）。
 * 这个接口存在是为了让列表逻辑只依赖最小行为注入，保持查询/表格控制器与弹窗状态模型解耦。
 */
interface AnnouncementListControllerParams {
  onEdit: (announcement: Announcement) => void
  onDelete: (announcement: Announcement) => void
}

/**
 * 定义公告弹窗动作控制器所需的状态读写与刷新能力。
 * 这个接口存在是为了集中声明副作用动作依赖，避免提交、删除、上传逻辑直接耦合页面内部实现细节。
 */
interface AnnouncementDialogActionsParams {
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

/**
 * 创建公告表格列辅助器，用于按 Announcement 类型安全地构建列定义。
 * 这个常量存在是为了复用列构建入口并获得字段级类型推断，减少列配置时的手写错误。
 */
const columnHelper = createColumnHelper<Announcement>()

/**
 * 返回公告表单的空状态。
 * 这个函数存在是为了让创建、编辑关闭和重置都共享同一份初始数据。
 */
function getEmptyAnnouncementFormState(): AnnouncementFormState {
  return {
    title: '',
    content: '',
    images: [],
    is_pinned: false,
    is_visible: true,
  }
}

/**
 * 校验公告表单输入，保持原有字段提示文案不变。
 * 这个函数存在是为了把表单校验规则从页面组件中拆出，降低主组件复杂度。
 */
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

/**
 * 按当前筛选条件过滤公告列表，保持显示/隐藏和置顶筛选行为不变。
 * 这个函数存在是为了把筛选逻辑从页面主体中拆出，减少主函数分支数量。
 */
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

/**
 * 校验公告图片文件是否合法，保持原有错误提示文案不变。
 * 这个函数存在是为了复用上传校验规则，避免点击上传和拖拽上传重复逻辑。
 */
function validateAnnouncementImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    return '请选择图片文件'
  }

  if (file.size > 5 * 1024 * 1024) {
    return '图片大小不能超过 5MB'
  }

  return null
}

/**
 * 获取公告弹窗标题。
 * 这个函数存在是为了移除弹窗标题中的条件表达式，让 JSX 更稳定可读。
 */
function getAnnouncementDialogTitle(dialogState: AnnouncementDialogMode | null) {
  if (dialogState === 'create') {
    return '创建公告'
  }

  if (dialogState === 'edit') {
    return '编辑公告'
  }

  return ''
}

/**
 * 获取公告提交按钮文案。
 * 这个函数存在是为了移除按钮区域的嵌套条件表达式，降低 JSX 复杂度。
 */
function getAnnouncementSubmitLabel(dialogState: AnnouncementDialogMode | null, formLoading: boolean) {
  if (dialogState === 'create') {
    return formLoading ? '创建中...' : '创建'
  }

  if (dialogState === 'edit') {
    return formLoading ? '保存中...' : '保存'
  }

  return ''
}

/**
 * 渲染存储信息条。
 * 这个函数存在是为了把存储展示区从页面主体中拆出，减少组合层噪音。
 */
function AnnouncementStorageBar({
  storageInfo,
}: {
  storageInfo: { usage_percent?: number; used_mb?: number; max_mb?: number } | undefined
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

/**
 * 渲染公告表格中的操作按钮。
 * 这个函数存在是为了把操作区从列定义中拆出，降低列配置复杂度。
 */
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

/**
 * 构建公告表格列定义。
 * 这个函数存在是为了把列装配从主页面中拆出，降低页面主函数和 useMemo 复杂度。
 */
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

/**
 * 渲染公告筛选条。
 * 这个函数存在是为了把筛选控件与存储条从页面壳层中拆开，降低主体 JSX 密度。
 */
function AnnouncementFiltersBar({
  visibilityFilter,
  pinnedFilter,
  storageInfo,
  onVisibilityFilterChange,
  onPinnedFilterChange,
}: Pick<
  AnnouncementManagementContentProps,
  'visibilityFilter' | 'pinnedFilter' | 'storageInfo' | 'onVisibilityFilterChange' | 'onPinnedFilterChange'
>) {
  return (
    <div className="flex items-center gap-3">
      <AnnouncementStorageBar storageInfo={storageInfo} />
      <Select value={visibilityFilter} onValueChange={onVisibilityFilterChange}>
        <SelectTrigger className="w-30 min-h-10">
          <SelectValue placeholder="显示状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="visible">显示</SelectItem>
          <SelectItem value="hidden">隐藏</SelectItem>
        </SelectContent>
      </Select>

      <Select value={pinnedFilter} onValueChange={onPinnedFilterChange}>
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

/**
 * 渲染公告表格主体内容。
 * 这个函数存在是为了用提前返回替代嵌套三元，并把表格行渲染从卡片外壳中拆开。
 */
function AnnouncementTableContent({
  isLoading,
  filteredAnnouncements,
  table,
}: Pick<AnnouncementManagementContentProps, 'isLoading' | 'filteredAnnouncements' | 'table'>) {
  if (isLoading && filteredAnnouncements.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (filteredAnnouncements.length === 0) {
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

/**
 * 渲染公告列表卡片。
 * 这个函数存在是为了把卡片外壳、标题与表格主体拆分，压缩页面内容组件行数。
 */
function AnnouncementTableCard({
  filteredAnnouncements,
  isLoading,
  table,
}: Pick<AnnouncementManagementContentProps, 'filteredAnnouncements' | 'isLoading' | 'table'>) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
          <Megaphone className="w-5 h-5" />
          公告列表 <span className="text-muted-foreground font-normal">(&thinsp;{filteredAnnouncements.length}&thinsp;)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <AnnouncementTableContent
          filteredAnnouncements={filteredAnnouncements}
          isLoading={isLoading}
          table={table}
        />
      </CardContent>
    </Card>
  )
}

/**
 * 渲染公告图片列表。
 * 这个函数存在是为了把图片预览与删除按钮从表单弹窗中拆出，降低弹窗主体复杂度。
 */
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

/**
 * 渲染公告图片上传区。
 * 这个函数存在是为了把拖拽与点击上传 UI 从表单区块中拆开，保留原有上传交互和提示。
 */
function AnnouncementImageUploader({
  uploading,
  isDragging,
  onUpload,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: Pick<
  AnnouncementManagementContentProps,
  'uploading' | 'isDragging' | 'onUpload' | 'onDragEnter' | 'onDragLeave' | 'onDragOver' | 'onDrop'
>) {
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

/**
 * 渲染公告编辑表单内容区。
 * 这个函数存在是为了把标题、内容、图片区分组，从弹窗壳层中抽出独立结构。
 */
function AnnouncementFormFields({
  formData,
  formErrors,
  uploading,
  isDragging,
  onFormFieldChange,
  onUpload,
  onRemoveImage,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: Pick<
  AnnouncementManagementContentProps,
  | 'formData'
  | 'formErrors'
  | 'uploading'
  | 'isDragging'
  | 'onFormFieldChange'
  | 'onUpload'
  | 'onRemoveImage'
  | 'onDragEnter'
  | 'onDragLeave'
  | 'onDragOver'
  | 'onDrop'
>) {
  return (
    <div className="grid gap-4">
      <div>
        <Label htmlFor="announcement_title" className={LABEL_STYLES.base}>
          标题 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="announcement_title"
          value={formData.title}
          onChange={(event) => onFormFieldChange('title', event.target.value)}
          placeholder="请输入公告标题"
          className={cn(INPUT_STYLES.lg, formErrors.title && 'border-destructive')}
        />
        {formErrors.title && <p className="text-sm text-destructive mt-1">{formErrors.title}</p>}
      </div>

      <div>
        <Label htmlFor="announcement_content" className={LABEL_STYLES.base}>
          内容 <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="announcement_content"
          value={formData.content}
          onChange={(event) => onFormFieldChange('content', event.target.value)}
          placeholder="请输入公告内容"
          rows={5}
          className={cn(formErrors.content && 'border-destructive')}
        />
        {formErrors.content && <p className="text-sm text-destructive mt-1">{formErrors.content}</p>}
      </div>

      <div>
        <Label className={LABEL_STYLES.base}>图片</Label>
        <div className="mt-2 space-y-2">
          <AnnouncementImageList images={formData.images} onRemoveImage={onRemoveImage} />
          <AnnouncementImageUploader
            uploading={uploading}
            isDragging={isDragging}
            onUpload={onUpload}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
          <p className="text-sm text-muted-foreground">支持 jpg, png, gif, webp 格式，最大 5MB</p>
        </div>
      </div>
    </div>
  )
}

/**
 * 渲染公告创建/编辑弹窗。
 * 这个函数存在是为了把弹窗壳层与表单字段分离，收缩内容组件和页面主函数体积。
 */
function AnnouncementFormDialog({
  dialogState,
  formData,
  formErrors,
  formLoading,
  uploading,
  isDragging,
  onFormFieldChange,
  onDialogChange,
  onSubmit,
  onUpload,
  onRemoveImage,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: Pick<
  AnnouncementManagementContentProps,
  | 'dialogState'
  | 'formData'
  | 'formErrors'
  | 'formLoading'
  | 'uploading'
  | 'isDragging'
  | 'onFormFieldChange'
  | 'onDialogChange'
  | 'onSubmit'
  | 'onUpload'
  | 'onRemoveImage'
  | 'onDragEnter'
  | 'onDragLeave'
  | 'onDragOver'
  | 'onDrop'
>) {
  const isOpen = dialogState === 'create' || dialogState === 'edit'
  const dialogTitle = getAnnouncementDialogTitle(dialogState)
  const submitLabel = getAnnouncementSubmitLabel(dialogState, formLoading)

  return (
    <Dialog open={isOpen} onOpenChange={onDialogChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <AnnouncementFormFields
          formData={formData}
          formErrors={formErrors}
          uploading={uploading}
          isDragging={isDragging}
          onFormFieldChange={onFormFieldChange}
          onUpload={onUpload}
          onRemoveImage={onRemoveImage}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
        <div className="flex gap-3 mt-6">
          <Button variant="modern" onClick={() => onDialogChange(false)} size="lg" className="flex-1">
            取消
          </Button>
          <Button onClick={onSubmit} disabled={formLoading} size="lg" className="flex-1">
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 渲染公告删除确认弹窗。
 * 这个函数存在是为了让删除确认结构独立于页面内容和编辑弹窗，方便压缩内容组件长度。
 */
function AnnouncementDeleteDialog({
  dialogState,
  deleteLoading,
  onDeleteDialogChange,
  onDelete,
}: Pick<AnnouncementManagementContentProps, 'dialogState' | 'deleteLoading' | 'onDeleteDialogChange' | 'onDelete'>) {
  return (
    <Dialog open={dialogState === 'delete'} onOpenChange={onDeleteDialogChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认删除公告</DialogTitle>
        </DialogHeader>
        <div>
          <p>确定要删除这条公告吗？</p>
          <p className="text-sm text-muted-foreground mt-1">此操作不可恢复，关联的图片也将被删除。</p>
        </div>
        <div className="flex gap-3 mt-8">
          <Button variant="destructive" onClick={onDelete} disabled={deleteLoading} size="lg" className="flex-1">
            {deleteLoading ? '处理中...' : '确认删除'}
          </Button>
          <Button variant="modern" onClick={() => onDeleteDialogChange(false)} size="lg" className="flex-1">
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 渲染公告管理页主体结构。
 * 这个函数存在是为了把展示层收缩成页面壳层，只负责组合已拆分的区块组件。
 */
function AnnouncementManagementContent({
  onSetDialogState,
  ...props
}: AnnouncementManagementContentProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">公告管理</h1>
        <Button onClick={() => onSetDialogState('create')} size="lg">
          <Plus className="w-4 h-4 mr-1.5" />
          创建公告
        </Button>
      </div>

      <AnnouncementFiltersBar
        visibilityFilter={props.visibilityFilter}
        pinnedFilter={props.pinnedFilter}
        storageInfo={props.storageInfo}
        onVisibilityFilterChange={props.onVisibilityFilterChange}
        onPinnedFilterChange={props.onPinnedFilterChange}
      />
      <AnnouncementTableCard
        filteredAnnouncements={props.filteredAnnouncements}
        isLoading={props.isLoading}
        table={props.table}
      />
      <AnnouncementFormDialog
        dialogState={props.dialogState}
        formData={props.formData}
        formErrors={props.formErrors}
        formLoading={props.formLoading}
        uploading={props.uploading}
        isDragging={props.isDragging}
        onFormFieldChange={props.onFormFieldChange}
        onDialogChange={props.onDialogChange}
        onSubmit={props.onSubmit}
        onUpload={props.onUpload}
        onRemoveImage={props.onRemoveImage}
        onDragEnter={props.onDragEnter}
        onDragLeave={props.onDragLeave}
        onDragOver={props.onDragOver}
        onDrop={props.onDrop}
      />
      <AnnouncementDeleteDialog
        dialogState={props.dialogState}
        deleteLoading={props.deleteLoading}
        onDeleteDialogChange={props.onDeleteDialogChange}
        onDelete={props.onDelete}
      />
    </div>
  )
}

/**
 * 管理公告列表查询、筛选与表格装配。
 * 这个函数存在是为了把列表侧的查询和表格逻辑从页面主函数拆出，减少主函数语句数。
 */
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

/**
 * 管理公告弹窗的基础状态与开关动作。
 * 这个函数存在是为了把表单状态、删除状态和弹窗开关从页面主函数中抽离。
 */
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

/**
 * 管理公告提交、删除、上传与拖拽动作。
 * 这个函数存在是为了把有副作用的表单动作从页面主函数中独立出来，同时保持原有交互语义。
 */
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
    } catch {
      setFormData((prev) => ({
        ...prev,
        images: prev.images.filter((imageUrl) => imageUrl !== url),
      }))
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

/**
 * 公告管理页负责公告列表、筛选、上传和弹窗编排。
 * 这个函数存在是为了在不扩散接口和提示文案的前提下，收缩页面结构复杂度。
 */
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

  return (
    <AnnouncementManagementContent
      visibilityFilter={listController.visibilityFilter}
      pinnedFilter={listController.pinnedFilter}
      storageInfo={listController.storageInfo}
      filteredAnnouncements={listController.filteredAnnouncements}
      isLoading={listController.isLoading}
      table={listController.table}
      dialogState={dialogStateModel.dialogState}
      formData={dialogStateModel.formData}
      formErrors={dialogStateModel.formErrors}
      formLoading={dialogStateModel.formLoading}
      deleteLoading={dialogStateModel.deleteLoading}
      uploading={dialogStateModel.uploading}
      isDragging={dialogStateModel.isDragging}
      onSetDialogState={dialogStateModel.setDialogState}
      onVisibilityFilterChange={listController.setVisibilityFilter}
      onPinnedFilterChange={listController.setPinnedFilter}
      onFormFieldChange={dialogStateModel.handleFormFieldChange}
      onDialogChange={dialogStateModel.handleDialogChange}
      onDeleteDialogChange={dialogStateModel.handleDeleteDialogChange}
      onSubmit={dialogActions.handleSubmit}
      onDelete={dialogActions.handleDelete}
      onUpload={dialogActions.handleUpload}
      onRemoveImage={dialogActions.handleRemoveImage}
      onDragEnter={dialogActions.handleDragEnter}
      onDragLeave={dialogActions.handleDragLeave}
      onDragOver={dialogActions.handleDragOver}
      onDrop={dialogActions.handleDrop}
    />
  )
}
