# 购物车同步插件

Chrome 浏览器插件用于采集试剂管理平台购物车数据，并把导入批次桥接到实验室库存管理系统的 `/cart-import` 页面。

## 功能特点

- **只识别已提交订单** - 只同步已提交的订单，未提交的不识别
- **详情页获取完整信息** - 从产品详情页获取名称、规格、品牌、CAS号等
- **购物车获取数量** - 从购物车获取订购数量
- **先预览后导入** - 显示商品列表，用户可勾选确认
- **支持两种订单类型** - 耗材订单和试剂订单

## 安装方法

### 1. 打开Chrome扩展程序页面

在Chrome浏览器地址栏输入：

```
chrome://extensions/
```

### 2. 开启开发者模式

点击右上角的「开发者模式」开关，使其变为开启状态。

### 3. 加载插件

1. 点击左上角的「加载已解压的扩展程序」
2. 选择项目中的 `browser-extension` 文件夹
3. 点击确定

### 4. 安装完成

插件图标将出现在Chrome右上角。

## 使用方法

### 准备工作

1. 在Chrome中打开 **试剂管理平台**：https://reagent.bjmu.edu.cn
2. 登录账号，进入 **购物车页面**
3. 在Chrome新标签页中打开 **实验室管理系统**

### 同步操作

1. 点击Chrome右上角的插件图标
2. 选择订单类型（耗材订单/试剂订单）
3. 点击「获取购物车」按钮
4. **预览界面** - 查看商品列表，勾选要导入的商品
5. 点击「导入选中」完成同步

## 数据获取流程

```
1. 购物车页面 → 提取已提交订单的产品ID和数量
            ↓
2. 详情页面（公开） → 获取完整产品信息
   - 产品名称
   - 英文名称
   - 品牌
   - 包装规格/纯度
   - CAS号
   - 单价
            ↓
3. 合并数据 → 数量从购物车获取，其他信息从详情页获取
```

## 识别规则

- **只识别已提交的订单**：购物车中显示"已提交"的订单才会被提取
- **未提交的订单不识别**：仍在购物车中未提交的商品不会被同步
- **数量从购物车获取**：使用购物车中设置的数量
- **其他信息从详情页获取**：产品名称、规格、品牌等从公开的详情页获取

## 文件结构

```
browser-extension/
├── manifest.json          # 扩展配置文件
├── .env.example           # 构建期域名配置模板
├── build-config.mjs       # 从 env 生成 manifest 和运行配置
├── background/
│   └── service-worker.js # 后台服务脚本（获取详情页数据）
├── content/
│   └── script.js         # 内容脚本（提取购物车产品ID和数量）
├── popup/
│   ├── popup.html        # 弹出窗口
│   └── popup.js          # 弹出窗口逻辑
├── shared/
│   ├── generated-config.js # 构建期生成的运行配置
│   └── site-config.js      # 站点配置读取逻辑
└── icons/                # 图标文件
```

## API接口

扩展负责采集和桥接，不直接写数据库。`/cart-import` 页面提交导入条目时调用标准订单接口。

| 接口                      | 方法 | 说明                     |
| ------------------------- | ---- | ------------------------ |
| `/api/cart-sync`        | POST | 匹配分析购物车条目与现有订单 |
| `/api/reagent-orders`   | POST | 创建试剂订单 |
| `/api/consumable-orders` | POST | 创建耗材订单 |

请求格式：

```json
{
  "items": [
    {
      "name": "产品名称",
      "specification": "规格",
      "quantity": 1,
      "price": 100.0,
      "brand": "品牌",
      "cas_number": "CAS号",
      "english_name": "英文名"
    }
  ],
  "order_type": "consumable"  // 或 "reagent"
}
```

## 匹配逻辑

同步时会自动匹配现有订单：

1. **精确匹配** - 名称完全相同
2. **模糊匹配** - 名称相似度 ≥ 50%
3. **CAS号匹配** - CAS号相同
4. **无匹配** - 作为新品导入

## 注意事项

1. **保持购物车页面打开**：同步时请确保购物车页面处于打开状态
2. **登录状态**：购物车页面需要已登录，系统页面也需要已登录
3. **订单类型**：请根据导入目标选择正确的订单类型
4. **预览确认**：获取数据后会显示预览，请勾选要导入的商品后再提交
5. **只识别已提交**：只有已提交的订单才会被识别，未提交的不会同步

## 常见问题

### 提示“请先打开购物车页面”

请确保购物车页面（URL 包含 `page=gwc`）已在 Chrome 其他标签页中打开。

### 获取到的商品数量为 0

请确认购物车中有已提交的订单，未提交的订单不会被识别。

### 获取失败

请检查：

- 购物车页面是否已登录
- 控制台是否有错误信息

## 开发说明

如需修改或扩展功能：

1. 修改 `browser-extension/.env` 后运行 `npm run build:extension`
2. 修改 `content/script.js` 调整购物车数据提取逻辑
3. 修改 `background/service-worker.js` 调整详情页解析逻辑
4. 修改 `popup/popup.js` 和 `popup/popup.html` 调整界面
5. 重新加载插件即可生效

## 部署说明

- 复制 `browser-extension/.env.example` 为 `browser-extension/.env`。
- 设置 `BROWSER_EXTENSION_SYSTEM_ORIGIN` 为实验室管理系统域名，例如 `https://inventory.example.com`。
- 设置 `BROWSER_EXTENSION_REAGENT_SITE_ORIGIN` 为试剂平台域名，例如 `https://reagent.bjmu.edu.cn`。
- 运行 `npm run build:extension` 生成 `manifest.json` 和 `shared/generated-config.js`。
- 生产域名不会在插件弹窗里修改；Chrome 扩展权限必须由构建期 env 写入 manifest。
- 修改后需要在 `chrome://extensions/` 重新加载扩展。
