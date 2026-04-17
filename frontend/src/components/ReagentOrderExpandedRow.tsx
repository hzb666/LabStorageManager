// Dashboard 和 ReagentOrders 共用这块展开信息，两处的 CAS 概览口径必须保持一致。
import React, { useEffect, useState } from "react";

import MoleculeStructure from "@/components/ui/MoleculeStructure";
import { reagentOrderAPI, type CASOverviewResponse } from "@/api/client";
import { REAGENT_STATUS_MAP } from "@/lib/constants";
import { formatDate, getInventoryBorrowLabel } from "@/lib/utils";
import { isSpecialCasValue } from "@/lib/validationSchemas";

export interface ReagentOrderExpandedRowProps {
  id?: number;
  cas_number: string;
  english_name?: string | null;
  alias?: string | null;
  purity?: string | null;
  notes?: string | null;
}

const CAS_OVERVIEW_GRID_CLASS_NAME = "col-span-2 md:col-span-3";

// 生成订单匹配数的展示文案。
const getOrderCountLabel = (
  loadingOverview: boolean,
  casOverview: CASOverviewResponse | null,
): string =>
  loadingOverview
    ? "查询中..."
    : `匹配 ${casOverview?.orders.total_count ?? 0} 条`;

// 生成库存匹配数的展示文案。
const getInventoryCountLabel = (
  loadingOverview: boolean,
  casOverview: CASOverviewResponse | null,
): string =>
  loadingOverview
    ? "查询中..."
    : `匹配 ${casOverview?.inventory.total_count ?? 0} 条`;

// 组装最近一条订单记录的摘要文本。
const getLatestOrderText = (
  latestOrder: CASOverviewResponse["orders"]["latest"],
): string => {
  if (!latestOrder) {
    return "-";
  }

  return `${latestOrder.applicant_name || "未知订购人"}，${REAGENT_STATUS_MAP[latestOrder.status] || latestOrder.status}，${latestOrder.specification}，${formatDate(latestOrder.created_at)}订购`;
};

// 组装最近一条库存记录的数量摘要。
const getInventoryQuantityText = (
  inventoryLatest: CASOverviewResponse["inventory"]["latest"],
): string =>
  inventoryLatest
    ? `${inventoryLatest.remaining_quantity ?? "-"} / ${inventoryLatest.specification}`
    : "-";

// 组装最近一条库存记录的位置与借用状态摘要。
const getInventoryLocationText = (
  inventoryLatest: CASOverviewResponse["inventory"]["latest"],
): string =>
  inventoryLatest
    ? `${inventoryLatest.storage_location || "未填写"} ，借用状态： ${getInventoryBorrowLabel(inventoryLatest.status, inventoryLatest.borrower_name)}`
    : "-";

// 特殊 CAS 不发请求，避免无意义查询和误导性的“查重中/查重失败”提示。
function useCasOverview({
  casNumber,
  id,
  isSpecialCas,
}: Readonly<{
  casNumber: string;
  id?: number;
  isSpecialCas: boolean;
}>) {
  const [casOverview, setCasOverview] = useState<CASOverviewResponse | null>(
    null,
  );
  const [loadingOverview, setLoadingOverview] = useState(false);

  useEffect(() => {
    if (isSpecialCas) {
      setCasOverview(null);
      setLoadingOverview(false);
      return;
    }

    let cancelled = false;

    const loadOverview = async () => {
      setLoadingOverview(true);
      try {
        const response = await reagentOrderAPI.getCASOverview(
          casNumber,
          id ? { exclude_order_id: id } : undefined,
        );
        if (!cancelled) {
          setCasOverview(response.data);
        }
      } catch {
        if (!cancelled) {
          setCasOverview(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingOverview(false);
        }
      }
    };

    void loadOverview();

    return () => {
      // CAS 切换后丢弃旧请求结果，避免后返回的旧响应覆盖新状态。
      cancelled = true;
    };
  }, [casNumber, id, isSpecialCas]);

  return { casOverview, loadingOverview };
}

interface CasOverviewDetailsProps {
  casOverview: CASOverviewResponse | null;
  isSpecialCas: boolean;
  loadingOverview: boolean;
}

// 渲染 CAS 概览详情区，并统一处理特殊 CAS 的展示文案。
function CasOverviewDetails({
  casOverview,
  isSpecialCas,
  loadingOverview,
}: Readonly<CasOverviewDetailsProps>) {
  if (isSpecialCas) {
    return (
      <div className={CAS_OVERVIEW_GRID_CLASS_NAME}>
        CAS查重：生物试剂不适用
      </div>
    );
  }

  const inventoryLatest = casOverview?.inventory.latest;
  const latestOrder = casOverview?.orders.latest;

  return (
    <div className={CAS_OVERVIEW_GRID_CLASS_NAME}>
      <span>库存：{getInventoryCountLabel(loadingOverview, casOverview)}</span>
      <span>，最近库存剩余量：{getInventoryQuantityText(inventoryLatest ?? null)}</span>
      <span>，库存位置：{getInventoryLocationText(inventoryLatest ?? null)}</span>
      <span>；订单：{getOrderCountLabel(loadingOverview, casOverview)}</span>
      <span>，最近订单：{getLatestOrderText(latestOrder ?? null)}</span>
    </div>
  );
}

// 展示试剂订单展开行的附加信息与 CAS 概览。
export const ReagentOrderExpandedRow = React.memo(
  function ReagentOrderExpandedRow({
    item,
  }: Readonly<{ item: ReagentOrderExpandedRowProps }>) {
    const isSpecialCas = isSpecialCasValue(item.cas_number);
    const { casOverview, loadingOverview } = useCasOverview({
      casNumber: item.cas_number,
      id: item.id,
      isSpecialCas,
    });

    return (
      <div className="p-3 flex flex-col md:flex-row gap-4 border-b border-border">
        <div className="hidden md:block shrink-0">
          <MoleculeStructure
            casNumber={item.cas_number}
            width={150}
            height={100}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 md:m-2 gap-x-6 gap-y-2 flex-1">
          <div className="col-span-2">英文名称：{item.english_name || "-"}</div>
          <div>别名：{item.alias || "-"}</div>
          <div className="col-span-2">备注：{item.notes || "-"}</div>
          <div>纯度：{item.purity || "-"}</div>
          <CasOverviewDetails
            casOverview={casOverview}
            isSpecialCas={isSpecialCas}
            loadingOverview={loadingOverview}
          />
        </div>
      </div>
    );
  },
);
