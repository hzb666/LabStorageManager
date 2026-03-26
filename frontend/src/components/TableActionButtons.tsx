// 表格行会高频重渲染，操作列要尽量稳定，才能让 memo 真正挡住无关刷新。
import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import { UserRoles } from "@/lib/constants";
import { Pencil } from "lucide-react";

export interface ActionButtonConfig<T> {
  id: string;
  label: string;
  variant?: "default" | "modern" | "destructive" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  icon?: React.ReactNode;
  showWhen?: (item: T, isAdmin?: boolean) => boolean;
  disableWhen?: (item: T, isAdmin?: boolean) => boolean;
  onClick: (item: T) => void | Promise<void>;
  confirm?: boolean;
  confirmLabel?: string;
  requiredRole?: typeof UserRoles.ADMIN | typeof UserRoles.USER;
}

interface StatusDisplayConfig {
  value: unknown;
  label: string;
  className?: string;
  title?: string;
}

export interface TableActionButtonsProps<T> {
  item: T;
  actions: ActionButtonConfig<T>[];
  showEdit?: boolean;
  disableEdit?: boolean;
  onEdit?: (item: T) => void;
  isAdmin?: boolean;
  statusField?: keyof T;
  statusDisplay?: StatusDisplayConfig[];
}

interface ActionButtonProps<T> {
  config: ActionButtonConfig<T>;
  item: T;
  isAdmin?: boolean;
}

function canShowActionForRole<T>(
  action: ActionButtonConfig<T>,
  isAdmin: boolean,
): boolean {
  return action.requiredRole !== UserRoles.ADMIN || isAdmin;
}

function resolveStatusDisplay(
  status: unknown,
  statusDisplay?: StatusDisplayConfig[],
): StatusDisplayConfig | undefined {
  return statusDisplay?.find((item) => item.value === status);
}

function getActionDisabled<T>(
  config: ActionButtonConfig<T>,
  item: T,
  isAdmin?: boolean,
): boolean {
  return config.disableWhen ? config.disableWhen(item, isAdmin) : false;
}

// 统一处理无确认按钮的点击边界，保持阻止冒泡与业务触发时序一致。
function runAction<T>(
  event: React.MouseEvent,
  config: ActionButtonConfig<T>,
  item: T,
) {
  event.stopPropagation();
  config.onClick(item);
}

export function TableActionButtons<T>({
  item,
  actions,
  showEdit = true,
  disableEdit = false,
  onEdit,
  isAdmin = false,
  statusField,
  statusDisplay,
}: Readonly<TableActionButtonsProps<T>>) {
  const status = statusField ? (item[statusField] as string) : undefined;

  // 拦截编辑按钮点击，避免触发行展开等父级事件。
  const handleEditClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onEdit?.(item);
    },
    [item, onEdit],
  );

  if (statusDisplay && status) {
    const matchedStatus = resolveStatusDisplay(status, statusDisplay);
    if (matchedStatus) {
      // 状态展示命中后直接替代动作区，避免同一列同时出现状态文案和可操作按钮。
      return (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span className={matchedStatus.className} title={matchedStatus.title}>
            {matchedStatus.label}
          </span>
        </div>
      );
    }
  }

  const visibleActions = actions.filter((action) => {
    if (!canShowActionForRole(action, isAdmin)) return false;
    if (action.showWhen) return action.showWhen(item, isAdmin);
    return true;
  });

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {showEdit && onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="modern"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={disableEdit}
              onClick={handleEditClick}
            >
              <Pencil className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>编辑</p>
          </TooltipContent>
        </Tooltip>
      )}

      {visibleActions.map((action) => (
        <ActionButton<T>
          key={action.id}
          config={action}
          item={item}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}

// 把二次确认状态机收口到一个 hook，保证图标/文字按钮的确认时序和退回条件一致。
function useConfirmAction<T>(
  config: ActionButtonConfig<T>,
  item: T,
  isDisabled: boolean,
) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 二次点击时真正执行危险操作，首次点击仅进入确认态。
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoading || isDisabled) return;

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    setIsLoading(true);
    try {
      await config.onClick(item);
      setIsConfirming(false);
    } catch {
      setIsConfirming(false);
    } finally {
      setIsLoading(false);
    }
  };

  // 失焦后退出确认态，避免危险按钮长时间停留在确认状态。
  const handleBlur = () => {
    if (isConfirming && !isLoading) setIsConfirming(false);
  };

  const displayLabel = isConfirming
    ? config.confirmLabel || "确认"
    : config.label;

  return { isConfirming, isLoading, handleClick, handleBlur, displayLabel };
}

// 图标 + 确认 按钮
function IconConfirmButton<T>({
  config,
  item,
  isAdmin,
}: Readonly<ActionButtonProps<T>>) {
  const isDisabled = getActionDisabled(config, item, isAdmin);
  const { isConfirming, isLoading, handleClick, handleBlur, displayLabel } =
    useConfirmAction(config, item, isDisabled);

  const isApprove = config.id === "approve";
  const confirmStateClass = isApprove
    ? "bg-green-600 text-white [&_svg]:text-white hover:bg-green-600/70 dark:bg-green-600 dark:hover:bg-green-600/70"
    : "bg-destructive text-white [&_svg]:text-white hover:bg-destructive/70 dark:bg-destructive dark:hover:bg-destructive/70";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <LoadingButton
          size="sm"
          disabled={isDisabled}
          variant="modern"
          className={cn(
            config.className,
            "h-8 w-8 p-0",
            isConfirming
              ? cn(
                  "transition-none [&_svg]:transition-none",
                  confirmStateClass,
                  isLoading && "opacity-100 cursor-wait",
                )
              : "",
          )}
          onClick={handleClick}
          onBlur={handleBlur}
          isLoading={isLoading}
        >
          {config.icon}
        </LoadingButton>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{displayLabel}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// 文字确认按钮（无图标）
function ConfirmButton<T>({
  config,
  item,
  isAdmin,
}: Readonly<ActionButtonProps<T>>) {
  const isDisabled = getActionDisabled(config, item, isAdmin);
  const { isConfirming, isLoading, handleClick, handleBlur, displayLabel } =
    useConfirmAction(config, item, isDisabled);

  // 只在进入确认阶段后切危险态，避免普通态就向用户暗示这一步已经不可逆。
  const confirmClassName = (() => {
    if (!isConfirming) return "";
    if (isLoading)
      return "text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none";
    return "bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none";
  })();

  return (
    <LoadingButton
      size="sm"
      disabled={isDisabled}
      className={cn(
        config.className,
        "h-8 text-sm leading-4",
        confirmClassName,
      )}
      onClick={handleClick}
      onBlur={handleBlur}
      isLoading={isLoading}
    >
      {displayLabel}
    </LoadingButton>
  );
}

// 纯图标按钮（无确认）
function IconButton<T>({
  config,
  item,
  isAdmin,
}: Readonly<ActionButtonProps<T>>) {
  const isDisabled = getActionDisabled(config, item, isAdmin);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={config.variant || "modern"}
          size="sm"
          className={cn("h-8 w-8 p-0", config.className)}
          disabled={isDisabled}
          onClick={(event) => runAction(event, config, item)}
        >
          {config.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{config.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// 纯文字按钮（无图标、无确认）
function SimpleButton<T>({
  config,
  item,
  isAdmin,
}: Readonly<ActionButtonProps<T>>) {
  const isDisabled = getActionDisabled(config, item, isAdmin);

  return (
    <Button
      variant={config.variant || "default"}
      size="sm"
      className={cn("h-7 text-sm px-2", config.className)}
      disabled={isDisabled}
      onClick={(event) => runAction(event, config, item)}
    >
      {config.label}
    </Button>
  );
}

function ActionButton<T>(props: Readonly<ActionButtonProps<T>>) {
  const { config } = props;

  if (config.icon && config.confirm) return <IconConfirmButton {...props} />;
  if (config.confirm) return <ConfirmButton {...props} />;
  if (config.icon) return <IconButton {...props} />;
  return <SimpleButton {...props} />;
}

// 通过浅比较配置和条目字段，避免操作列在无关更新时重复渲染。
export const TableActionButtonsMemo = React.memo(
  TableActionButtons,
  (prevProps, nextProps) => {
    if (
      prevProps.isAdmin !== nextProps.isAdmin ||
      prevProps.showEdit !== nextProps.showEdit ||
      prevProps.disableEdit !== nextProps.disableEdit ||
      prevProps.onEdit !== nextProps.onEdit ||
      prevProps.actions !== nextProps.actions ||
      prevProps.statusDisplay !== nextProps.statusDisplay
    ) {
      return false;
    }

    const prevItem = prevProps.item as Record<string, unknown>;
    const nextItem = nextProps.item as Record<string, unknown>;

    if (prevItem === nextItem) return true;
    const prevKeys = Object.keys(prevItem);
    const nextKeys = Object.keys(nextItem);
    if (prevKeys.length !== nextKeys.length) return false;
    return prevKeys.every((key) => prevItem[key] === nextItem[key]);
  },
) as typeof TableActionButtons;
