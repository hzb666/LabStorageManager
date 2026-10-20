const assert = require("node:assert/strict");
const test = require("node:test");

const {
  detectOrderClassification,
  splitConsumableNameAndSpecification,
} = require("./popup/order-type-detection.js");

test("未获取到详情且没有合法 CAS 时保留待定类型", () => {
  for (const item of [{}, { cas_number: "invalid" }, { cas_number: "64-17-6" },
    ...["pending", "timeout", "error", "http_error", "missing_url", "no_details", "fallback"]
      .map((status) => ({ name: "购物车基础名称", detail_fetch_status: status }))]) {
    const result = detectOrderClassification(item);
    assert.equal(result.order_type, "pending");
    assert.equal(result.suggested_order_type, "pending");
  }
});

test("详情识别成功但没有合法 CAS 时归为耗材", () => {
  for (const cas_number of ["", "invalid", "64-17-6"]) {
    const result = detectOrderClassification({ detail_fetch_status: "success", cas_number });
    assert.equal(result.order_type, "consumable");
    assert.equal(result.suggested_order_type, "consumable");
  }
});

test("合法 CAS 仍识别为试剂", () => {
  assert.equal(detectOrderClassification({ cas_number: "64-17-5" }).order_type, "reagent");
  assert.equal(detectOrderClassification({ detail_fetch_status: "success", cas_number: "64-17-5" }).order_type, "reagent");
});

test("耗材名称优先按第一个英文逗号拆分", () => {
  assert.deepStrictEqual(
    splitConsumableNameAndSpecification("离心管, 15 mL, 无菌", "备用规格"),
    { name: "离心管", specification: "15 mL, 无菌" },
  );
});

test("耗材名称支持中文逗号并丢弃两侧空格", () => {
  assert.deepStrictEqual(
    splitConsumableNameAndSpecification("离心管 ， 15 mL", "备用规格"),
    { name: "离心管", specification: "15 mL" },
  );
});

test("没有逗号时按第一段连续空白拆分", () => {
  assert.deepStrictEqual(
    splitConsumableNameAndSpecification("离心管   15 mL 无菌", "备用规格"),
    { name: "离心管", specification: "15 mL 无菌" },
  );
});

test("没有分隔符时保留名称并使用详情规格", () => {
  assert.deepStrictEqual(
    splitConsumableNameAndSpecification("离心管", " 15 mL "),
    { name: "离心管", specification: "15 mL" },
  );
});

test("名称包含空格但随后存在逗号时仍优先按逗号拆分", () => {
  assert.deepStrictEqual(
    splitConsumableNameAndSpecification("PCR Tube, 0.2 mL", "备用规格"),
    { name: "PCR Tube", specification: "0.2 mL" },
  );
});
