import { useCallback } from "react";
import { CheckCircle, List, Loader2, Trash2, X } from "lucide-react";

import { BaseForm } from "@/components/BaseForm";
import { CartImportLoadingScreen } from "@/components/CartImportLoadingScreen";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { ReagentCasDuplicateWarning } from "@/components/ReagentCasDuplicateWarning";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { getConsumableOrderFormFields } from "@/lib/formConfigs";
import { cn } from "@/lib/utils";
import {
  getReagentOrderStatusLabel,
  useCartImportActions,
  useCartImportBatchController,
  useCartImportFormController,
} from "./cartimport/cartImportControllers";
import type { ImportItem, OrderType } from "./cartimport/cartImportModel";

function CartImportItemList(
  props: Readonly<{
    items: ImportItem[];
    currentIndex: number;
    submittedIds: Set<number>;
    onSelect: (index: number) => void;
  }>,
) {
  const { items, currentIndex, submittedIds, onSelect } = props;

  return (
    <>
      {items.map((item, index) => {
        const isCurrent = index === currentIndex;
        const isSubmitted = submittedIds.has(item.id);
        const itemMeta =
          item.order_type === "reagent"
            ? `CAS: ${item.cas_number || "无CAS"}`
            : `规格: ${item.specification || "未提供"}`;
        const itemTypeClassName =
          item.order_type === "consumable"
            ? "bg-blue-50/50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"
            : "bg-green-50/50 text-green-700 border-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800";

        return (
          <Card
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                onSelect(index);
              }
            }}
            className={cn(
              "cursor-pointer transition-all hover:bg-accent text-card-foreground py-4 mb-2",
              isCurrent ? "border bg-accent/80 dark:border-primary" : "",
              isSubmitted ? "opacity-50" : "",
            )}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-2 px-4 py pb-2">
              <CardTitle
                className={cn(
                  "font-normal leading-tight line-clamp-2",
                  isCurrent ? "text-primary" : "",
                )}
              >
                {item.name || "待填写名称"}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 flex flex-row items-center justify-between text-muted-foreground">
              {itemMeta}
              {isSubmitted ? (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
              ) : (
                <span
                  className={cn(
                    "shrink-0 text-sm rounded-sm border px-1.5 py-0.5",
                    itemTypeClassName,
                  )}
                >
                  {item.order_type === "consumable" ? "耗材" : "试剂"}
                </span>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}

function CartImportMobileSidebar(
  props: Readonly<{
    mobileListOpen: boolean;
    items: ImportItem[];
    currentIndex: number;
    submittedIds: Set<number>;
    onClose: () => void;
    onSelect: (index: number) => void;
  }>,
) {
  const {
    mobileListOpen,
    items,
    currentIndex,
    submittedIds,
    onClose,
    onSelect,
  } = props;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden transition-opacity duration-200",
        mobileListOpen ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      onClick={onClose}
    >
      <aside
        className={cn(
          "fixed inset-y-0 left-0 w-80 bg-card transition-transform duration-200 flex flex-col pointer-events-auto",
          mobileListOpen ? "translate-x-0" : "-translate-x-full",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 shrink-0">
          <h3 className="font-bold text-lg">待导入列表</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5 opacity-60" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <CartImportItemList
            items={items}
            currentIndex={currentIndex}
            submittedIds={submittedIds}
            onSelect={onSelect}
          />
        </div>
      </aside>
    </div>
  );
}

function CartImportDesktopSidebar(
  props: Readonly<{
    items: ImportItem[];
    currentIndex: number;
    submittedIds: Set<number>;
    onSelect: (index: number) => void;
  }>,
) {
  const { items, currentIndex, submittedIds, onSelect } = props;

  return (
    <div className="hidden lg:flex flex-col w-75 shrink-0 p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-lg">待导入</h3>
        <span className="text-sm text-muted-foreground">
          已提交 {submittedIds.size}/{items.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-2 -mr-2 pb-2">
        <CartImportItemList
          items={items}
          currentIndex={currentIndex}
          submittedIds={submittedIds}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function CartImportFormPanel(
  props: Readonly<{
    batch: ReturnType<typeof useCartImportBatchController>;
    formState: ReturnType<typeof useCartImportFormController>;
    actions: ReturnType<typeof useCartImportActions>;
  }>,
) {
  const { batch, formState, actions } = props;
  const { currentItem, items, submittedIds, setMobileListOpen } = batch;
  const {
    orderType,
    reagentForm,
    consumableForm,
    reagentFormFields,
    casWarning,
    casLoading,
    handleTypeSwitch,
  } = formState;
  const {
    submitting,
    handleDeleteCurrent,
    handleSubmitCurrent,
    navigateToCasSearch,
  } = actions;
  const isCurrentSubmitted = currentItem
    ? submittedIds.has(currentItem.id)
    : false;

  return (
    <div className="flex flex-1 min-w-0 flex-col overflow-hidden px-4 pt-4 sm:px-6 md:pl-6 md:pr-8 md:pt-6 md:pb-2">
      <div className="mb-6 flex shrink-0 items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-lg flex items-center min-w-0">
            <Button
              variant="modern"
              size="icon"
              className="lg:hidden mr-3 shrink-0"
              onClick={() => setMobileListOpen(true)}
            >
              <List className="w-4 h-4" />
            </Button>
            <span className="shrink-0">完善订单</span>
            <span className="text-sm text-muted-foreground pt-1 lg:hidden ml-3 shrink-0 font-normal">
              已提交 {submittedIds.size}/{items.length}
            </span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="pr-2 text-muted-foreground">表单类型</span>
          <RadioGroup
            value={orderType}
            onValueChange={(value) => handleTypeSwitch(value as OrderType)}
            className="flex items-center gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="reagent" id="r-reagent" />
              <Label htmlFor="r-reagent" className="cursor-pointer text-base">
                试剂
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="consumable" id="r-consumable" />
              <Label
                htmlFor="r-consumable"
                className="cursor-pointer text-base"
              >
                耗材
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {orderType === "reagent" ? (
          <BaseForm
            key="reagent"
            form={reagentForm}
            fields={reagentFormFields}
          />
        ) : (
          <BaseForm
            key="consumable"
            form={consumableForm}
            fields={getConsumableOrderFormFields()}
          />
        )}
      </div>

      <div className="mt-auto shrink-0 pt-3">
        {orderType === "reagent" ? (
          <ReagentCasDuplicateWarning
            casWarning={casWarning}
            className="mb-4 rounded-md bg-orange-50 p-3 dark:bg-orange-950"
            onOpenOrders={() => navigateToCasSearch("/reagents", "cas_number")}
            onOpenInventory={() =>
              navigateToCasSearch("/inventory", "cas_number")
            }
            getOrderStatusLabel={getReagentOrderStatusLabel}
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 order-1">
            <ConfirmDeleteButton
              variant="destructive"
              size="lg"
              type="button"
              onConfirm={handleDeleteCurrent}
              disabled={submitting || !currentItem}
              icon={<Trash2 className="w-4 h-4 mr-1.5" />}
              resetKey={currentItem?.id}
            />
          </div>
          <div className="flex items-center gap-2 order-2">
            {casLoading && orderType === "reagent" && (
              <span className="text-sm text-muted-foreground flex items-center">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                检查CAS号中
              </span>
            )}
            <LoadingButton
              type="button"
              size="lg"
              onClick={handleSubmitCurrent}
              isLoading={submitting}
              disabled={submitting || !currentItem || isCurrentSubmitted}
            >
              提交当前项
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CartImportPage() {
  const batchController = useCartImportBatchController();
  const formController = useCartImportFormController(
    batchController.currentItem,
    batchController.currentIndex,
    batchController.setItems,
  );
  const actionController = useCartImportActions({
    items: batchController.items,
    setItems: batchController.setItems,
    currentIndex: batchController.currentIndex,
    setCurrentIndex: batchController.setCurrentIndex,
    submittedIds: batchController.submittedIds,
    setSubmittedIds: batchController.setSubmittedIds,
    currentItem: batchController.currentItem,
    navigate: batchController.navigate,
    orderType: formController.orderType,
    casWarningCasNumber: formController.casWarning?.cas_number,
    reagentForm: formController.reagentForm,
    consumableForm: formController.consumableForm,
  });
  const {
    currentUser,
    items,
    currentIndex,
    submittedIds,
    mobileListOpen,
    setCurrentIndex,
    setMobileListOpen,
  } = batchController;

  const handleSelectItem = useCallback(
    (index: number) => {
      // 先落草稿再切卡，保证左右两侧切换不吞掉未提交编辑。
      formController.persistCurrentDraft();
      setCurrentIndex(index);
      setMobileListOpen(false);
    },
    [formController, setCurrentIndex, setMobileListOpen],
  );

  if (batchController.loading) {
    return <CartImportLoadingScreen />;
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center px-4 pb-4">
      <div className="absolute inset-0 -z-10 [background-image:radial-gradient(circle_at_center,#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(closest-side_at_50%_50%,#000_70%,transparent_100%)] dark:[background-image:radial-gradient(circle_at_center,#1f2937_1px,transparent_1px)] dark:[mask-image:radial-gradient(closest-side_at_50%_50%,#000_70%,transparent_100%)]" />
      <div className="flex h-[min(calc(100svh-clamp(3rem,11svh,7rem)),48rem)] w-full items-start justify-center md:h-[min(calc(100svh-clamp(4rem,12svh,9rem)),48rem)]">
        <Card className="flex max-h-full w-full flex-col overflow-hidden md:w-auto md:min-w-md">
          <CardHeader className="shrink-0 pb-4 border-b border-muted">
            <CardTitle className="text-2xl">
              购物车导入{" "}
              <span className="text-base font-normal ml-4">当前用户: </span>
              <span className="text-base font-normal">
                {currentUser?.full_name || currentUser?.username || "未知用户"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative flex min-h-0 max-h-[calc(100svh-9rem)] p-0 md:max-h-[calc(100svh-11rem)]">
            <CartImportMobileSidebar
              mobileListOpen={mobileListOpen}
              items={items}
              currentIndex={currentIndex}
              submittedIds={submittedIds}
              onClose={() => setMobileListOpen(false)}
              onSelect={handleSelectItem}
            />
            <CartImportDesktopSidebar
              items={items}
              currentIndex={currentIndex}
              submittedIds={submittedIds}
              onSelect={handleSelectItem}
            />
            <CartImportFormPanel
              batch={batchController}
              formState={formController}
              actions={actionController}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
