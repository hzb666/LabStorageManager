const assert = require("node:assert/strict");
const test = require("node:test");

const {
  splitConsumableNameAndSpecification,
} = require("./popup/order-type-detection.js");

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
