# 业务流程

## 试剂主流程

```mermaid
flowchart LR
    Create["提交试剂订单"] --> Pending["pending"]
    Pending --> Approved["approved"]
    Approved --> Arrived["confirm-arrival"]
    Arrived --> StockIn["stock-in"]
    StockIn --> Inventory["生成库存记录"]
    Inventory --> Borrow["借用"]
    Borrow --> Return["归还"]
```

说明：

- 试剂订单支持后续入库和库存追踪
- 入库后才会生成库存记录
- 借用和归还会写入借用日志

## 耗材主流程

```mermaid
flowchart LR
    Create["提交耗材订单"] --> Pending["pending"]
    Pending --> Approved["approved"]
    Approved --> Completed["completed"]
```

说明：

- 耗材当前实现不进入试剂库存那套瓶级流转

## 浏览器扩展导入流程

```mermaid
flowchart LR
    Cart["试剂平台购物车"] --> Popup["扩展 popup"]
    Popup --> Storage["chrome.storage.local"]
    Storage --> Bridge["import-bridge.js"]
    Bridge --> PageCache["cart_import_batch_latest"]
    PageCache --> Import["/cart-import 页面"]
```

## 参考代码

- `app/api/reagent_orders_workflow.py`
- `app/models/reagent_order.py:107`
- `app/models/consumable_order.py:17`
- `app/api/cart_sync.py:169`
- `browser-extension/content/import-bridge.js:48`
