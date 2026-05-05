import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Loader2, Lock, X } from "lucide-react";
import { userAdminAPI, authAPI, searchCompletionAPI } from "@/api/client";
import { BaseForm } from "@/components/BaseForm";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Label } from "@/components/ui/Label";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { useRememberedUser } from "@/hooks/useRememberedUser";
import { UserRoles } from "@/lib/constants";
import { getUserEditFormFields, USER_ROLE_OPTIONS } from "@/lib/formConfigs";
import { clearRememberedUser as clearRememberedUserStorage } from "@/lib/storage/appAuthMetaStorage";
import { toast } from "@/lib/toast";
import { cn, getFullImageUrl } from "@/lib/utils";
import {
  UserUpdateSchema,
  ChangePasswordWithConfirmSchema,
  extractApiErrorDetail,
  getApiErrorMessage,
  normalizeApiErrorMessage,
} from "@/lib/validationSchemas";
import type {
  UserUpdateFormData,
  ChangePasswordFormData,
} from "@/lib/validationSchemas";
import { useAuthStore } from "@/store/useStore";

type UserRole = "admin" | "user" | "public";
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;
type AuthStoreUser = AuthStoreState["user"];
type AuthStoreSetAuth = AuthStoreState["setAuth"];

export interface User {
  id: number;
  username: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  avatar_url?: string;
}

export interface UserEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  mode: "admin" | "profile";
  onSuccess?: () => void;
}

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const AUTH_LOCAL_STORAGE_KEYS = ["auth-storage"];
const MAX_SIZE_MB = 5;
const AVATAR_INPUT_ID = "avatar-upload";
const USER_EDIT_FIELDS = getUserEditFormFields();
const DEFAULT_EDIT_FORM_VALUES: UserUpdateFormData = {
  username: "",
  full_name: "",
  role: "user",
};
const DEFAULT_PASSWORD_FORM_VALUES: ChangePasswordFormData = {
  old_password: "",
  new_password: "",
  confirm_password: "",
};
const OLD_PASSWORD_FIELDS = [
  {
    name: "old_password" as const,
    label: "原密码",
    type: "password" as const,
    required: true,
    placeholder: "请输入原密码",
  },
];
const NEW_PASSWORD_FIELDS = [
  {
    name: "new_password" as const,
    label: "新密码",
    type: "password" as const,
    required: true,
    placeholder: "请输入新密码",
  },
  {
    name: "confirm_password" as const,
    label: "确认新密码",
    type: "password" as const,
    required: true,
    placeholder: "请再次输入新密码",
  },
];

// 将用户头像地址补全为可直接渲染的完整图片 URL。
function getAvatarUrl(user: User | null) {
  return user?.avatar_url ? getFullImageUrl(user.avatar_url) : "";
}

// 在预览地址为 blob URL 时回收对象地址，避免切换头像后泄漏。
function revokeBlobUrlIfNeeded(previewUrl: string) {
  if (previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(previewUrl);
  }
}

// 重置隐藏文件输入框，允许用户重复选择同一张图片。
function resetAvatarInput() {
  const fileInput = document.getElementById(
    AVATAR_INPUT_ID,
  ) as HTMLInputElement | null;
  if (fileInput) {
    fileInput.value = "";
  }
}

// 在上传前校验头像格式和大小，并返回用户可读的错误文案。
function validateAvatarFile(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "仅支持 JPG、PNG、WebP 格式的图片";
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `图片大小不能超过 ${MAX_SIZE_MB}MB`;
  }

  return null;
}

// profile 模式不下发 role，避免个人资料编辑入口顺手改掉角色。
function buildUpdatePayload(
  formData: UserUpdateFormData,
  mode: "admin" | "profile",
) {
  const updatePayload: {
    username?: string;
    full_name?: string;
    role?: UserRole;
  } = {
    username: formData.username,
    full_name: formData.full_name,
  };

  if (mode === "admin") {
    updatePayload.role = formData.role;
  }

  return updatePayload;
}

function getDialogTitle(mode: "admin" | "profile", isEditingPassword: boolean) {
  if (isEditingPassword) {
    return "修改密码";
  }

  return mode === "admin" ? "编辑用户" : "编辑个人信息";
}

// 本人改密和管理员互改管理员密码都要验证旧密码，避免高权限口令被静默覆盖。
function shouldRequireOldPassword(user: User | null, currentUserId?: number) {
  return user?.id === currentUserId || user?.role === UserRoles.ADMIN;
}

function getPasswordErrorMessage(error: unknown) {
  const detail = extractApiErrorDetail(error);
  return normalizeApiErrorMessage(detail, "密码修改失败");
}

// 将密码错误尽量映射到具体字段，无法映射时回退为通用 toast。
function applyPasswordError(
  passwordForm: UseFormReturn<ChangePasswordFormData>,
  errorMessage: string,
) {
  if (errorMessage === "原密码错误") {
    passwordForm.setError("old_password", {
      type: "manual",
      message: "原密码错误",
    });
    return;
  }

  if (errorMessage === "新密码不能与原密码相同") {
    passwordForm.setError("new_password", {
      type: "manual",
      message: "新密码不能与原密码相同",
    });
    return;
  }

  if (
    errorMessage.includes("Password must be at least") ||
    errorMessage.includes("至少")
  ) {
    passwordForm.setError("new_password", {
      type: "manual",
      message: "密码至少6个字符",
    });
    return;
  }

  if (errorMessage.includes("password") && errorMessage.includes("match")) {
    passwordForm.setError("confirm_password", {
      type: "manual",
      message: "两次输入的密码不一致",
    });
    return;
  }

  toast.error(errorMessage);
}

// 先留出 toast 和本地退出清理时间，再跳登录页，避免提示被立刻打断。
function redirectToLogin() {
  setTimeout(() => {
    globalThis.location.href = "/login";
  }, 1500);
}

// 定向清理认证相关本地状态，避免把主题、侧栏等偏好一起抹掉。
function clearAuthLocalStorage() {
  try {
    for (const key of AUTH_LOCAL_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // 忽略本地清理异常，后续仍会走服务端注销与登录页跳转。
  }
  clearRememberedUserStorage();
}

// 处理用户名修改后的退出登录链路，确保本地和服务端会话一起失效。
async function handleUsernameChanged(onClose: () => void) {
  toast.success("用户名已更新，请重新登录");
  onClose();
  clearAuthLocalStorage();

  try {
    await authAPI.logout();
  } catch {
    // 服务端注销失败不阻断强制重新登录，本地身份已清空时页面应退出旧会话。
  }

  redirectToLogin();
}

// 用会话 token 绑定当前密码编辑态，避免弹窗重开或切换用户后沿用旧状态。
function useUserEditForms(open: boolean, user: User | null) {
  const editForm = useForm<UserUpdateFormData>({
    resolver: valibotResolver(UserUpdateSchema),
    defaultValues: DEFAULT_EDIT_FORM_VALUES,
  });
  const passwordForm = useForm<ChangePasswordFormData>({
    resolver: valibotResolver(ChangePasswordWithConfirmSchema),
    defaultValues: DEFAULT_PASSWORD_FORM_VALUES,
  });
  const [passwordEditSession, setPasswordEditSession] = useState<symbol | null>(
    null,
  );
  const currentSessionToken = useMemo(
    () => (open && user ? Symbol("user-edit-session") : null),
    [open, user],
  );

  const isEditingPassword =
    currentSessionToken !== null && passwordEditSession === currentSessionToken;

  // 在弹窗打开或切换目标用户时重置两张表单到当前用户的初始值。
  useEffect(() => {
    if (!open || !user) {
      return;
    }

    editForm.reset({
      username: user.username,
      full_name: user.full_name || "",
      role: user.role,
    });
    passwordForm.reset(DEFAULT_PASSWORD_FORM_VALUES);
  }, [open, user, editForm, passwordForm]);

  // 对外暴露统一重置入口，关闭弹窗或切换流程时一起清空两张表单。
  const resetForms = useCallback(() => {
    setPasswordEditSession(null);
    editForm.reset();
    passwordForm.reset(DEFAULT_PASSWORD_FORM_VALUES);
  }, [editForm, passwordForm]);

  // 进入密码编辑模式时绑定当前会话 token，并清空密码表单。
  const startPasswordEdit = useCallback(() => {
    setPasswordEditSession(currentSessionToken);
    passwordForm.reset(DEFAULT_PASSWORD_FORM_VALUES);
  }, [currentSessionToken, passwordForm]);

  return {
    editForm,
    passwordForm,
    isEditingPassword,
    setIsEditingPassword: setPasswordEditSession,
    resetForms,
    startPasswordEdit,
  };
}

// 集中管理 blob URL 生命周期和 remembered user 同步，避免头像预览泄漏或状态漂移。
function useAvatarState(
  open: boolean,
  user: User | null,
  rememberedUser: ReturnType<typeof useRememberedUser>["rememberedUser"],
  updateRememberedUser: ReturnType<
    typeof useRememberedUser
  >["updateRememberedUser"],
) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [originalAvatarUrl, setOriginalAvatarUrl] = useState("");
  const [avatarImageLoaded, setAvatarImageLoaded] = useState(false);

  // 以“弹窗会话”为边界同步头像状态，避免关闭再打开时沿用上一位用户的本地预览。
  useEffect(() => {
    if (!open || !user) {
      return;
    }

    const avatarUrl = getAvatarUrl(user);
    setAvatarFile(null);
    setAvatarPreview(avatarUrl);
    setOriginalAvatarUrl(avatarUrl);
    setAvatarImageLoaded(false);
  }, [open, user]);

  useEffect(() => {
    return () => {
      revokeBlobUrlIfNeeded(avatarPreview);
    };
  }, [avatarPreview]);

  // 清空头像相关的本地状态，并回收可能存在的 blob 预览地址。
  const clearAvatarState = useCallback(() => {
    setAvatarFile(null);
    revokeBlobUrlIfNeeded(avatarPreview);
    setAvatarPreview("");
    setOriginalAvatarUrl("");
    setAvatarImageLoaded(false);
    resetAvatarInput();
  }, [avatarPreview]);

  // 处理头像本地预览选择，并在校验通过后立即更新预览图。
  const handleAvatarChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const validationMessage = validateAvatarFile(file);
      if (validationMessage) {
        toast.error(validationMessage);
        event.target.value = "";
        return;
      }

      revokeBlobUrlIfNeeded(avatarPreview);
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
      setAvatarImageLoaded(true);
      event.target.value = "";
    },
    [avatarPreview],
  );

  // 删除当前头像预览，并阻止点击事件冒泡回上传触发器。
  const handleAvatarDelete = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setAvatarFile(null);
      setAvatarPreview("");
      resetAvatarInput();
    },
    [],
  );

  const handleAvatarUpdate = useCallback(
    async (targetUser: User) => {
      // 明确区分“删除头像”和“上传新头像”两条链路，避免只看 preview 误判为无需提交。
      const wasAvatarDeleted =
        Boolean(originalAvatarUrl) && !avatarPreview && !avatarFile;

      if (wasAvatarDeleted) {
        try {
          await userAdminAPI.deleteAvatar(targetUser.id);
          return true;
        } catch {
          toast.error("头像删除失败");
          return false;
        }
      }

      if (!avatarFile) {
        return true;
      }

      setAvatarLoading(true);
      try {
        const response = await userAdminAPI.uploadAvatar(
          targetUser.id,
          avatarFile,
        );
        const newAvatarUrl = response.data.avatar_url;
        setAvatarPreview(newAvatarUrl);

        if (rememberedUser?.userId === targetUser.id) {
          updateRememberedUser({ avatar_url: newAvatarUrl });
        }

        return true;
      } catch (error) {
        toast.error(getApiErrorMessage(error, "头像上传失败"));
        return false;
      } finally {
        setAvatarLoading(false);
      }
    },
    [
      avatarFile,
      avatarPreview,
      originalAvatarUrl,
      rememberedUser?.userId,
      updateRememberedUser,
    ],
  );

  return {
    avatarPreview,
    avatarLoading,
    avatarImageLoaded,
    setAvatarImageLoaded,
    clearAvatarState,
    handleAvatarChange,
    handleAvatarDelete,
    handleAvatarUpdate,
  };
}

interface UseSaveHandlerOptions {
  user: User | null;
  mode: "admin" | "profile";
  editForm: UseFormReturn<UserUpdateFormData>;
  currentUser: AuthStoreUser;
  rememberedUser: ReturnType<typeof useRememberedUser>["rememberedUser"];
  updateRememberedUser: ReturnType<
    typeof useRememberedUser
  >["updateRememberedUser"];
  setAuth: AuthStoreSetAuth;
  onSuccess?: () => void;
  onClose: () => void;
  handleAvatarUpdate: (targetUser: User) => Promise<boolean>;
  setEditLoading: Dispatch<SetStateAction<boolean>>;
}

// 保存资料时先处理头像，再提交基础信息；用户名变化触发强制重新登录，防止旧 token 挂着旧身份继续使用。
function useSaveUserHandler({
  user,
  mode,
  editForm,
  currentUser,
  rememberedUser,
  updateRememberedUser,
  setAuth,
  onSuccess,
  onClose,
  handleAvatarUpdate,
  setEditLoading,
}: Readonly<UseSaveHandlerOptions>) {
  return useCallback(async () => {
    const isValid = await editForm.trigger();
    if (!isValid || !user) {
      return;
    }

    const formData = editForm.getValues();
    setEditLoading(true);
    try {
      const avatarUpdated = await handleAvatarUpdate(user);
      if (!avatarUpdated) {
        return;
      }

      const response = await userAdminAPI.update(
        user.id,
        buildUpdatePayload(formData, mode),
      );
      const updatedUser = response.data;

      const usernameChanged = user.username !== formData.username;
      const currentUserEditedSelf = user.id === currentUser?.id;
      if (usernameChanged && currentUserEditedSelf) {
        await handleUsernameChanged(onClose);
        return;
      }

      if (rememberedUser?.userId === user.id) {
        updateRememberedUser({ full_name: formData.full_name });
      }

      if (user.id === currentUser?.id && updatedUser) {
        setAuth(updatedUser);
      }

      onSuccess?.();
      onClose();
      toast.success(mode === "admin" ? "用户更新成功" : "信息更新成功");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "更新失败"));
    } finally {
      setEditLoading(false);
    }
  }, [
    currentUser?.id,
    editForm,
    handleAvatarUpdate,
    mode,
    onClose,
    onSuccess,
    rememberedUser?.userId,
    setAuth,
    setEditLoading,
    updateRememberedUser,
    user,
  ]);
}

interface UsePasswordHandlerOptions {
  user: User | null;
  currentUser: AuthStoreUser;
  passwordForm: UseFormReturn<ChangePasswordFormData>;
  onClose: () => void;
  setIsEditingPasswordSession: Dispatch<SetStateAction<symbol | null>>;
  setChangePasswordLoading: Dispatch<SetStateAction<boolean>>;
}

// 自改密码与管理员重置他人密码走两条链路，表单入口和错误回填共用。
function usePasswordChangeHandler({
  user,
  currentUser,
  passwordForm,
  onClose,
  setIsEditingPasswordSession,
  setChangePasswordLoading,
}: Readonly<UsePasswordHandlerOptions>) {
  return passwordForm.handleSubmit(async (formData) => {
    const oldPassword = String(formData.old_password || "");
    const newPassword = String(formData.new_password || "");
    const isSelf = user?.id === currentUser?.id;
    const isTargetAdmin = user?.role === UserRoles.ADMIN;

    if (shouldRequireOldPassword(user, currentUser?.id) && !oldPassword) {
      passwordForm.setError("old_password", {
        type: "manual",
        message: "请输入原密码",
      });
      return;
    }

    setChangePasswordLoading(true);
    try {
      if (isSelf) {
        await authAPI.changePassword(oldPassword, newPassword);
        onClose();
        toast.success("密码修改成功，请重新登录");
        setTimeout(() => {
          useAuthStore.getState().logout();
          globalThis.location.href = "/login";
        }, 1500);
        return;
      }

      const adminOldPassword = isTargetAdmin ? oldPassword : undefined;
      await userAdminAPI.resetPassword(user!.id, newPassword, adminOldPassword);
      setIsEditingPasswordSession(null);
      passwordForm.reset(DEFAULT_PASSWORD_FORM_VALUES);
      toast.success("密码重置成功");
    } catch (error) {
      applyPasswordError(passwordForm, getPasswordErrorMessage(error));
    } finally {
      setChangePasswordLoading(false);
    }
  });
}

interface AvatarSectionProps {
  user: User | null;
  avatarPreview: string;
  avatarLoading: boolean;
  avatarImageLoaded: boolean;
  onAvatarChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAvatarLoad: () => void;
  onAvatarError: () => void;
}

// 渲染头像上传区域，包含 hover 蒙层、删除按钮和提示文案。
function AvatarSection({
  user,
  avatarPreview,
  avatarLoading,
  avatarImageLoaded,
  onAvatarChange,
  onAvatarDelete,
  onAvatarLoad,
  onAvatarError,
}: Readonly<AvatarSectionProps>) {
  const avatarFallback =
    (avatarLoading || !avatarImageLoaded) && avatarPreview
      ? "..."
      : user?.username?.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-3 mb-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative group">
            <input
              type="file"
              id={AVATAR_INPUT_ID}
              accept={ALLOWED_TYPES.join(",")}
              className="hidden"
              disabled={avatarLoading}
              onChange={onAvatarChange}
            />
            <Label htmlFor={AVATAR_INPUT_ID} className="cursor-pointer block">
              <div className="relative h-20 w-20">
                <Avatar className="h-20 w-20 transition-colors">
                  <AvatarImage
                    src={avatarPreview || undefined}
                    alt={user?.username ?? ""}
                    className="object-cover"
                    onLoad={onAvatarLoad}
                    onError={onAvatarError}
                  />
                  <AvatarFallback className="text-2xl">
                    {avatarFallback}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 bg-gray-600/50 dark:bg-gray-800/60 rounded-full border-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer">
                  {avatarLoading ? (
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  ) : (
                    <span className="text-white text-3xl drop-shadow-md">
                      +
                    </span>
                  )}
                </div>
                {avatarPreview && !avatarLoading && (
                  <button
                    type="button"
                    onClick={onAvatarDelete}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/70"
                  >
                    <X className="size-3.5 stroke-3" />
                  </button>
                )}
              </div>
            </Label>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>点击上传头像</p>
          <p>图片应小于 {MAX_SIZE_MB}MB</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

interface RoleSelectorProps {
  role: UserRole;
  onRoleChange: (value: UserRole) => void;
}

// 渲染角色选择单选组，统一管理端与个人资料端的角色展示。
function RoleSelector({ role, onRoleChange }: Readonly<RoleSelectorProps>) {
  return (
    <div>
      <Label className="text-base">角色</Label>
      <RadioGroup
        value={role}
        onValueChange={(value) => onRoleChange(value as UserRole)}
        className="flex gap-4 mt-2"
      >
        {USER_ROLE_OPTIONS.map((option) => (
          <div key={option.value} className="flex items-center space-x-2">
            <RadioGroupItem
              value={option.value}
              id={`edit_role_${option.value}`}
            />
            <Label
              htmlFor={`edit_role_${option.value}`}
              className="text-base cursor-pointer"
            >
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

interface PasswordSectionProps {
  showOldPassword: boolean;
  passwordForm: UseFormReturn<ChangePasswordFormData>;
  changePasswordLoading: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

// 渲染密码编辑视图，只负责字段和底部操作按钮布局。
function PasswordSection({
  showOldPassword,
  passwordForm,
  changePasswordLoading,
  onBack,
  onSubmit,
}: Readonly<PasswordSectionProps>) {
  return (
    <>
      <div className="grid space-y-4">
        {showOldPassword && (
          <BaseForm
            form={passwordForm}
            fields={OLD_PASSWORD_FIELDS}
            layout="stack"
          />
        )}
        <BaseForm
          form={passwordForm}
          fields={NEW_PASSWORD_FIELDS}
          layout="stack"
        />
      </div>
      <div key="password-actions" className="flex gap-3 mt-8">
        <Button variant="modern" onClick={onBack} size="lg" className="flex-1">
          返回
        </Button>
        <Button
          onClick={onSubmit}
          disabled={changePasswordLoading}
          size="lg"
          className="flex-1"
        >
          {changePasswordLoading ? "处理中..." : "确认修改"}
        </Button>
      </div>
    </>
  );
}

interface ProfileSectionProps {
  user: User | null;
  mode: "admin" | "profile";
  editForm: UseFormReturn<UserUpdateFormData>;
  avatarPreview: string;
  avatarLoading: boolean;
  avatarImageLoaded: boolean;
  editLoading: boolean;
  personalizationEnabled: boolean;
  personalizationLoading: boolean;
  onPersonalizationChange: (checked: boolean) => void;
  onAvatarChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAvatarLoad: () => void;
  onAvatarError: () => void;
  onStartPasswordEdit: () => void;
  onClose: () => void;
  onSave: () => void;
}

// 渲染资料编辑视图，组合头像区、基础字段区与角色区。
function ProfileSection({
  user,
  mode,
  editForm,
  avatarPreview,
  avatarLoading,
  avatarImageLoaded,
  editLoading,
  personalizationEnabled,
  personalizationLoading,
  onPersonalizationChange,
  onAvatarChange,
  onAvatarDelete,
  onAvatarLoad,
  onAvatarError,
  onStartPasswordEdit,
  onClose,
  onSave,
}: Readonly<ProfileSectionProps>) {
  return (
    <>
      <div className="grid gap-4">
        <AvatarSection
          user={user}
          avatarPreview={avatarPreview}
          avatarLoading={avatarLoading}
          avatarImageLoaded={avatarImageLoaded}
          onAvatarChange={onAvatarChange}
          onAvatarDelete={onAvatarDelete}
          onAvatarLoad={onAvatarLoad}
          onAvatarError={onAvatarError}
        />

        <BaseForm form={editForm} fields={USER_EDIT_FIELDS} layout="stack" />

        {mode === "profile" && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="personalization-toggle"
              checked={personalizationEnabled}
              disabled={personalizationLoading}
              onCheckedChange={onPersonalizationChange}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <label
                  htmlFor="personalization-toggle"
                  className="text-base leading-none cursor-pointer select-none"
                >
                  允许收集个性化使用信息
                </label>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64">
                开启后系统会记录你的使用习惯以提供个性化体验，关闭后仅使用全局数据。
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {mode === "admin" && (
          <RoleSelector
            role={(editForm.watch("role") ?? "user") as UserRole}
            onRoleChange={(value) => editForm.setValue("role", value)}
          />
        )}
      </div>

      <div key="edit-actions" className="flex gap-2 mt-6">
        <Button
          variant="modern"
          onClick={onStartPasswordEdit}
          size="lg"
          className="flex-3"
        >
          <Lock className="w-4 h-4 mr-1.5" />
          修改密码
        </Button>
        <Button variant="modern" onClick={onClose} size="lg" className="flex-1">
          取消
        </Button>
        <LoadingButton
          onClick={onSave}
          isLoading={editLoading}
          size="lg"
          className="flex-1"
        >
          保存
        </LoadingButton>
      </div>
    </>
  );
}

// 组合资料编辑视图与密码编辑视图的用户编辑弹窗主入口。
export function UserEditDialog({
  open,
  onOpenChange,
  user,
  mode,
  onSuccess,
}: Readonly<UserEditDialogProps>) {
  const { user: currentUser, setAuth } = useAuthStore();
  const { rememberedUser, updateRememberedUser } = useRememberedUser();
  const {
    editForm,
    passwordForm,
    isEditingPassword,
    setIsEditingPassword,
    resetForms,
    startPasswordEdit,
  } = useUserEditForms(open, user);
  const [editLoading, setEditLoading] = useState(false);
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [personalizationEnabled, setPersonalizationEnabled] = useState(true);
  const [personalizationLoading, setPersonalizationLoading] = useState(false);
  const {
    avatarPreview,
    avatarLoading,
    avatarImageLoaded,
    setAvatarImageLoaded,
    clearAvatarState,
    handleAvatarChange,
    handleAvatarDelete,
    handleAvatarUpdate,
  } = useAvatarState(open, user, rememberedUser, updateRememberedUser);

  useEffect(() => {
    if (!open || mode !== "profile") return
    searchCompletionAPI.getPreferences()
      .then((res) => setPersonalizationEnabled(res.data.personalization_enabled))
      .catch(() => {})
  }, [open, mode])

  const handlePersonalizationChange = useCallback(async (checked: boolean) => {
    setPersonalizationLoading(true)
    try {
      const res = await searchCompletionAPI.updatePreferences({ personalization_enabled: checked })
      setPersonalizationEnabled(res.data.personalization_enabled)
    } catch {
      toast.error("更新搜索预测设置失败")
    } finally {
      setPersonalizationLoading(false)
    }
  }, [])

  // 关闭弹窗时要同时清理表单与头像本地状态，且上传中禁止关闭以避免“UI 关了但请求还在跑”。
  const handleClose = useCallback(() => {
    if (avatarLoading) {
      toast.error("头像上传中，请稍后");
      return;
    }

    onOpenChange(false);
    resetForms();
    clearAvatarState();
  }, [avatarLoading, clearAvatarState, onOpenChange, resetForms]);

  const handleSave = useSaveUserHandler({
    user,
    mode,
    editForm,
    currentUser,
    rememberedUser,
    updateRememberedUser,
    setAuth,
    onSuccess,
    onClose: handleClose,
    handleAvatarUpdate,
    setEditLoading,
  });

  const handleChangePassword = usePasswordChangeHandler({
    user,
    currentUser,
    passwordForm,
    onClose: handleClose,
    setIsEditingPasswordSession: setIsEditingPassword,
    setChangePasswordLoading,
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={cn(!isEditingPassword && "mb-4")}>
            {getDialogTitle(mode, isEditingPassword)}
          </DialogTitle>
        </DialogHeader>

        {isEditingPassword ? (
          <PasswordSection
            showOldPassword={shouldRequireOldPassword(user, currentUser?.id)}
            passwordForm={passwordForm}
            changePasswordLoading={changePasswordLoading}
            onBack={() => setIsEditingPassword(null)}
            onSubmit={handleChangePassword}
          />
        ) : (
          <ProfileSection
            user={user}
            mode={mode}
            editForm={editForm}
            avatarPreview={avatarPreview}
            avatarLoading={avatarLoading}
            avatarImageLoaded={avatarImageLoaded}
            editLoading={editLoading}
            personalizationEnabled={personalizationEnabled}
            personalizationLoading={personalizationLoading}
            onPersonalizationChange={handlePersonalizationChange}
            onAvatarChange={handleAvatarChange}
            onAvatarDelete={handleAvatarDelete}
            onAvatarLoad={() => setAvatarImageLoaded(true)}
            onAvatarError={() => setAvatarImageLoaded(false)}
            onStartPasswordEdit={startPasswordEdit}
            onClose={handleClose}
            onSave={handleSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
