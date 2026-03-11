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
import { normalizeApiErrorMessage } from '@/lib/validationSchemas'
import { formatDate, cn, getFullImageUrl } from '@/lib/utils'
import useDialogState from '@/hooks/useDialogState'
import { AxiosError } from 'axios'
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
  HardDrive
} from 'lucide-react'

const columnHelper = createColumnHelper<Announcement>()

export function AnnouncementManagement() {
  const queryClient = useQueryClient()
  const [sorting] = useState<SortingState>([])
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all')
  const [pinnedFilter, setPinnedFilter] = useState<'all' | 'pinned' | 'unpinned'>('all')

  // Dialog state - 使用 useDialogState 管理 create/edit/delete 对话框
  const [dialogState, setDialogState] = useDialogState<"create" | "edit" | "delete">()

  // 状态管理
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    images: [] as string[],
    is_pinned: false,
    is_visible: true,
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [formLoading, setFormLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // 使用 React Query 获取公告列表
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const response = await announcementAPI.list()
      return response.data || []
    },
    placeholderData: keepPreviousData,
  })

  // 使用 React Query 获取存储信息
  const { data: storageInfo } = useQuery({
    queryKey: ['announcementStorageInfo'],
    queryFn: async () => {
      const response = await announcementAPI.getStorageInfo()
      return response.data
    },
  })

  // 刷新数据函数
  const refetchAnnouncements = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['announcements'] })
    queryClient.invalidateQueries({ queryKey: ['announcementStorageInfo'] })
  }, [queryClient])

  // 处理置顶切换
  const handleTogglePin = async (id: number) => {
    try {
      await announcementAPI.togglePin(id)
      refetchAnnouncements()
      toast.success('置顶状态已更新')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '操作失败'))
    }
  }

  // 处理显示/隐藏切换
  const handleToggleVisibility = async (id: number) => {
    try {
      await announcementAPI.toggleVisibility(id)
      refetchAnnouncements()
      toast.success('显示状态已更新')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '操作失败'))
    }
  }

  // 打开编辑弹窗
  const openEditModal = (announcement: Announcement) => {
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
  }

  // 打开删除弹窗
  const openDeleteModal = (announcement: Announcement) => {
    setDeleteId(announcement.id)
    setDialogState('delete')
  }

  // 重置表单
  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      images: [],
      is_pinned: false,
      is_visible: true,
    })
    setFormErrors({})
    setEditingId(null)
  }

  // 表格列定义
  const columns = useMemo(() => [
    columnHelper.accessor('title', {
      header: '标题',
      size: 200,
      cell: info => {
        const isPinned = info.row.original.is_pinned
        const isVisible = info.row.original.is_visible
        const title = info.getValue()
        return (
          <div className="flex items-center gap-2 min-w-0">
            {isPinned && <Pin className="size-4 text-amber-600 dark:text-amber-500 shrink-0" />}
            <span className={cn("truncate", !isVisible && "text-muted-foreground")} title={title}>
              {title}
            </span>
            {!isVisible && (
              <span className="text-sm text-muted-foreground shrink-0">(已隐藏)</span>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor('content', {
      header: '内容',
      size: 300,
      cell: info => {
        return (
          <div className="truncate" title={info.getValue()}>
            {info.getValue()}
          </div>
        );
      },
    }),
    columnHelper.accessor('images', {
      header: '图片',
      size: 80,
      cell: info => {
        const images = info.getValue()
        return images && images.length > 0 ? (
          <div className="flex items-center gap-1">
            <ImageIcon className="w-4 h-4" />
            <span>{images.length}</span>
          </div>
        ) : '-'
      },
    }),
    columnHelper.accessor('created_at', {
      header: '创建时间',
      size: 150,
      cell: info => formatDate(info.getValue()),
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      size: 180,
      cell: info => {
        const announcement = info.row.original

        return (
          <div className="flex items-center gap-1">
            {/* 置顶按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="morden"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleTogglePin(announcement.id)
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
                <p>{announcement.is_pinned ? "取消置顶" : "置顶"}</p>
              </TooltipContent>
            </Tooltip>

            {/* 显示/隐藏按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="morden"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleVisibility(announcement.id)
                  }}
                >
                  {announcement.is_visible ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{announcement.is_visible ? "隐藏" : "显示"}</p>
              </TooltipContent>
            </Tooltip>

            {/* 编辑按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="morden"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEditModal(announcement)
                  }}
                >
                  <Edit className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>编辑</p>
              </TooltipContent>
            </Tooltip>

            {/* 删除按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="morden"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation()
                    openDeleteModal(announcement)
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
      },
    }),
  ], [])

  // 筛选后的公告数据（必须在 table 定义之前）
  const filteredAnnouncements = useMemo(() => {
    return announcements.filter(announcement => {
      // 显示状态筛选
      if (visibilityFilter === 'visible' && !announcement.is_visible) return false
      if (visibilityFilter === 'hidden' && announcement.is_visible) return false
      // 置顶状态筛选
      if (pinnedFilter === 'pinned' && !announcement.is_pinned) return false
      if (pinnedFilter === 'unpinned' && announcement.is_pinned) return false
      return true
    })
  }, [announcements, visibilityFilter, pinnedFilter])

  // Table definition
  const table = useReactTable({
    data: filteredAnnouncements,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
  })

  const validateForm = useCallback((): boolean => {
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

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData])

  // 处理创建/更新提交
  const handleSubmit = async () => {
    if (!validateForm()) return

    setFormLoading(true)
    try {
      if (editingId) {
        await announcementAPI.update(editingId, {
          title: formData.title,
          content: formData.content,
          images: formData.images,
          is_pinned: formData.is_pinned,
          is_visible: formData.is_visible,
        })
        toast.success('公告更新成功')
      } else {
        await announcementAPI.create({
          title: formData.title,
          content: formData.content,
          images: formData.images,
          is_pinned: formData.is_pinned,
          is_visible: formData.is_visible,
        })
        toast.success('公告创建成功')
      }

      setDialogState(null)
      resetForm()
      refetchAnnouncements()
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '操作失败'))
    } finally {
      setFormLoading(false)
    }
  }

  // 处理删除
  const handleDelete = async () => {
    if (!deleteId) return

    setDeleteLoading(true)
    try {
      await announcementAPI.delete(deleteId)
      setDialogState(null)
      setDeleteId(null)
      refetchAnnouncements()
      toast.success('公告删除成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      toast.error(normalizeApiErrorMessage(axiosError.response?.data?.detail, '删除失败'))
    } finally {
      setDeleteLoading(false)
    }
  }

  // 关闭弹窗时清空表单
  const handleModalClose = (open: boolean) => {
    if (!open) {
      setDialogState(null)
      resetForm()
    }
  }

  // 处理图片上传
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }

    // 验证文件大小 (最大 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片大小不能超过 5MB')
      return
    }

    setUploading(true)
    try {
      const url = await announcementAPI.uploadImage(file)
      setFormData(prev => ({
        ...prev,
        images: [...prev.images, url]
      }))
      toast.success('图片上传成功')
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>
      const errorMsg = axiosError.response?.data?.detail || '图片上传失败'
      // 将英文错误消息转换为中文
      if (errorMsg.includes('Invalid image type')) {
        toast.error('不支持该图像格式')
      } else if (errorMsg.includes('Image size exceeds')) {
        toast.error('图片大小超过限制')
      } else {
        toast.error(errorMsg)
      }
    } finally {
      setUploading(false)
      // 清空 input 值，允许重复选择同一文件
      e.target.value = ''
    }
  }

  // 处理移除图片
  const handleRemoveImage = async (url: string) => {
    try {
      // 提取文件名
      const filename = url.split('/').pop()
      if (filename) {
        await announcementAPI.deleteImage(filename)
      }
      setFormData(prev => ({
        ...prev,
        images: prev.images.filter(img => img !== url)
      }))
      toast.success('图片已移除')
    } catch {
      // 即使删除远程文件失败，也从表单中移除
      setFormData(prev => ({
        ...prev,
        images: prev.images.filter(img => img !== url)
      }))
    }
  }

  // 处理拖拽事件
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // 处理拖拽释放
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    // 处理每个拖拽的文件
    for (const file of files) {
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        toast.error('请选择图片文件')
        continue
      }

      // 验证文件大小 (最大 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error('图片大小不能超过 5MB')
        continue
      }

      setUploading(true)
      try {
        const url = await announcementAPI.uploadImage(file)
        setFormData(prev => ({
          ...prev,
          images: [...prev.images, url]
        }))
        toast.success('图片上传成功')
      } catch (error) {
        const axiosError = error as AxiosError<{ detail?: string }>
        const errorMsg = axiosError.response?.data?.detail || '图片上传失败'
        // 将英文错误消息转换为中文
        if (errorMsg.includes('Invalid image type')) {
          toast.error('不支持该图像格式')
        } else if (errorMsg.includes('Image size exceeds')) {
          toast.error('图片大小超过限制')
        } else {
          toast.error(errorMsg)
        }
      } finally {
        setUploading(false)
      }
    }
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">公告管理</h1>
        <Button onClick={() => setDialogState('create')} size="lg">
          <Plus className="w-4 h-4 mr-1.5" />
          创建公告
        </Button>
      </div>

      {/* Storage Info and Filters */}
      <div className="flex items-center gap-3">
        
        {/* Storage Info - 背景融合进度条风格 (高度严格保持 h-10) */}
        {/* 始终显示存储信息，使用默认值0，数据加载后平滑过渡 */}
        <div className="relative flex-1 h-10 rounded-md border border-input bg-card overflow-hidden flex items-center">
          {/* 底层：动态推进的背景色 (充当进度条) */}
          <div
            className="absolute inset-y-0 left-0 bg-muted transition-all duration-500 ease-in-out"
            style={{ width: `${Math.min(storageInfo?.usage_percent ?? 0, 100)}%` }}
          />

          {/* 上层内容：Relative + z-10 确保文字始终在色块上方 */}
          <div className="relative z-10 flex items-center justify-between w-full px-3 gap-3">
            {/* 左侧：图标 + 容量信息 */}
            <div className="flex items-center gap-2.5 min-w-0">
              <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-base text-foreground truncate">
                存储: <span>{storageInfo?.used_mb ?? 0}</span> / {storageInfo?.max_mb ?? 50} MB
              </span>
            </div>
          </div>
        </div>

        {/* Filter Selects - 将 min-h-10 改为 h-10 确保完美对齐 */}
        <Select value={visibilityFilter} onValueChange={(value: 'all' | 'visible' | 'hidden') => setVisibilityFilter(value)}>
          <SelectTrigger className="w-30 min-h-10">
            <SelectValue placeholder="显示状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="visible">显示</SelectItem>
            <SelectItem value="hidden">隐藏</SelectItem>
          </SelectContent>
        </Select>

        <Select value={pinnedFilter} onValueChange={(value: 'all' | 'pinned' | 'unpinned') => setPinnedFilter(value)}>
          <SelectTrigger className="w-30 min-h-10">
            <SelectValue placeholder="置顶状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="pinned">置顶</SelectItem>
            <SelectItem value="unpinned">未置顶</SelectItem>
          </SelectContent>
        </Select>
        
      </div>

      {/* Announcements Table */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg card-title-placeholder">
            <Megaphone className="w-5 h-5" />
            公告列表 <span className="text-muted-foreground font-normal">(&thinsp;{filteredAnnouncements.length}&thinsp;)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && filteredAnnouncements.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAnnouncements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无公告数据
            </div>
          ) : (
            <div className="px-6 rounded-md overflow-auto">
              <table className="w-full min-w-max" style={{ tableLayout: 'fixed' }}>
                <thead>
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className="border-b-2 border-border">
                      {headerGroup.headers.map(header => (
                        <th
                          key={header.id}
                          className="h-11 px-3 font-bold text-foreground text-left align-middle text-base"
                          style={{ width: header.getSize() }}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map(row => (
                    <tr key={row.id} className="border-b border-border hover:bg-muted/30">
                      {row.getVisibleCells().map(cell => (
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
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Announcement Modal */}
      <Dialog open={dialogState === 'create' || dialogState === 'edit'} onOpenChange={handleModalClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogState === 'create' ? '创建公告' : '编辑公告'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="announcement_title" className={LABEL_STYLES.base}>
                标题 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="announcement_title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="请输入公告标题"
                className={cn(INPUT_STYLES.lg, formErrors.title && 'border-destructive')}
              />
              {formErrors.title && (
                <p className="text-sm text-destructive mt-1">{formErrors.title}</p>
              )}
            </div>
            <div>
              <Label htmlFor="announcement_content" className={LABEL_STYLES.base}>
                内容 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="announcement_content"
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="请输入公告内容"
                rows={5}
                className={cn(formErrors.content && 'border-destructive')}
              />
              {formErrors.content && (
                <p className="text-sm text-destructive mt-1">{formErrors.content}</p>
              )}
            </div>
            <div>
              <Label className={LABEL_STYLES.base}>图片</Label>
              <div className="mt-2 space-y-2">
                {/* 已上传的图片预览 */}
                {formData.images.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.images.map((url, index) => (
                      <div key={url} className="relative group">
                        <img
                          src={getFullImageUrl(url)}
                          alt={`图片 ${index + 1}`}
                          className="w-20 h-20 object-cover rounded-md border border-input"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(url)}
                          className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="size-3.5 stroke-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* 上传按钮 - 支持点击和拖拽 */}
                <label
                  className={cn(
                    "flex items-center justify-center w-full h-20 border-2 border-dashed rounded-md cursor-pointer transition-colors",
                    isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/50"
                  )}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {uploading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Upload className="w-5 h-5" />
                    )}
                    <span>{uploading ? '上传中...' : '点击或拖拽上传图片'}</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
                <p className="text-sm text-muted-foreground">支持 jpg, png, gif, webp 格式，最大 5MB</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="morden" onClick={() => handleModalClose(false)} size="lg" className="flex-1">
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={formLoading} size="lg" className="flex-1">
              {formLoading ? (dialogState === 'create' ? '创建中...' : '保存中...') : (dialogState === 'create' ? '创建' : '保存')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={dialogState === 'delete'} onOpenChange={(open) => setDialogState(open ? 'delete' : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除公告</DialogTitle>
          </DialogHeader>
          <div>
            <p>确定要删除这条公告吗？</p>
            <p className="text-sm text-muted-foreground mt-1">此操作不可恢复，关联的图片也将被删除。</p>
          </div>
          <div className="flex gap-3 mt-8">
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading} size="lg" className="flex-1">
              {deleteLoading ? '处理中...' : '确认删除'}
            </Button>
            <Button variant="morden" onClick={() => setDialogState(null)} size="lg" className="flex-1">
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
