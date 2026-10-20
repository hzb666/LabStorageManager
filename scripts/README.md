# scripts 说明

本目录用于一次性数据修复、迁移导入、结构体检和运维辅助脚本。  

## 统一约定

1. 订单/库存状态、试剂订单原因：统一使用后端 `enum.value`（小写）写入数据库。
2. 当前订单表名：`reagent_order`、`consumable_order`（不是旧表名 `reagentorder`、`consumableorder`）。
3. 拼音字段：优先同时维护全拼和首字母字段（如 `name_pinyin` + `name_pinyin_initials`）。

## 保留脚本（建议继续维护）

| 脚本 | 何时使用 | 说明 |
|---|---|---|
| `check_db_health.py` | 发布前/迁移后自检 | 检查字段、索引、拼音、CAS 等健康状态。 |
| `check_db_schema_consistency.py` | 排查 schema 漂移 | 对比 SQLModel 与 SQLite 实际结构。 |
| `check_index.py` | 快速仅索引核对 | 轻量索引一致性检查。 |
| `release_version.py` | 发布前同步/检查版本 | 统一维护后端、CLI、前端、应用配置和浏览器扩展版本。 |
| `backfill_common_shelf_groups.py` | 常用货架组补齐 | 显式补齐历史库缺失的 `common_shelf_group` 记录，默认 dry-run。 |
| `migrate_legacy_tables_with_copy.py` | 从旧表名升级 | 把 `reagentorder/consumableorder` 数据迁移到新表名。 |
| `rebuild_inventory_tables_if_missing_source_order_fk.py` | 旧库存表缺外键 | 仅在 `inventory.source_order_id` 外键缺失时重建库存相关表。 |
| `normalize_legacy_enum_storage.py` | 历史枚举值纠偏 | 将旧 `enum.name` 转为当前 `enum.value`（小写）。 |
| `normalize_legacy_enums.py` | 同上（便捷入口） | 调用 `normalize_legacy_enum_storage.py`。 |
| `regenerate_internal_codes.py` | 内部编码重排 | 重新生成 `internal_code`（支持 dry-run / apply）。 |
| `upgrade_internal_code_width.py` | 历史编码宽度升级 | 把旧宽度编码升级到新格式。 |
| `migration/import_users.py` | 首次导入用户 | 从 `user_mapping.csv` 导入用户并补拼音字段。 |
| `migration/import_reagent_orders.py` | 导入试剂订单 | 使用新表名、小写枚举值、补拼音全拼+首字母。 |
| `migration/import_consumable_orders.py` | 导入耗材订单 | 使用新表名、小写枚举值、补拼音全拼+首字母。 |
| `migration/import_inventory.py` | 导入库存 | 使用当前 `inventory` 字段结构，补拼音全拼+首字母。 |
| `migration/rebuild_pinyin.py` | 历史数据补拼音 | 按表批量重建拼音字段（支持 all/单表）。 |
| `rebuild_order_pinyin.py` | 兼容旧用法 | 兼容入口，内部转调 `migration/rebuild_pinyin.py`。 |

## 一次性/历史脚本（建议归档，不建议日常使用）

| 脚本 | 原用途 | 当前建议 |
|---|---|---|
| `migrate_null_values.py` | 早期 NULL 迁移并重建旧索引 | 不建议再用（索引策略已变化）。 |
| `fix_cas_numbers.py` | 对特定历史库做 CAS 批量修正 | 仅针对当时数据，日常不用。 |
| `verify_cas_numbers.py` | 联网核查 CAS | 依赖旧路径/外部服务，建议按需重写。 |
| `xlsx_fix_cas_numbers.py` | XLSX 内 CAS 批量替换 | 仅做离线清洗，按需使用。 |
| `format_reagent_csv.py` | 旧 CSV 格式转换 | 旧导入链路专用。 |
| `format_consumable_csv.py` | 旧 CSV 格式转换 | 旧导入链路专用。 |
| `scrape_old_system.py` | 旧系统抓取 | 仅迁移阶段可用。 |
| `sse_demo_server.py` / `test_sse_demo.py` | SSE 本地演示 | 功能演示用途，非生产迁移。 |
| `test_legacy_enum_storage.py` | 早期枚举迁移测试 | 与当前主流程耦合弱，按需维护。 |

## 常用命令

### 同时启动正式站只读服务和预览后端（Linux）

停止正式后端并暂停其自动重启后运行：

```bash
bash scripts/start_read_only_maintenance.sh
```

默认正式目录为 `/www/wwwroot/LabStorageManager`，预览目录为 `/www/wwwroot/LabStorageManager-preview`，两个目录必须已部署代码。脚本使用正式虚拟环境创建快照，优先使用预览目录的虚拟环境运行预览后端；预览环境没有虚拟环境时共用正式 Python。可用 `PYTHON_BIN` 和 `PREVIEW_PYTHON_BIN` 指定 Python 的绝对路径。

正式站的 `/api/` 和 `/health` 转发到只读服务 `127.0.0.1:8000`；`preview.lab.thejiaogroup.cn` 的 `/api/` 和 `/health` 转发到预览后端 `127.0.0.1:8002`，`proxy_pass` 保留原路径。预览前端使用 `VITE_API_URL=/api` 构建。端口可用 `READ_ONLY_PORT` 和 `PREVIEW_PORT` 覆盖。

预览后端读取预览目录的 `.env`，脚本强制使用独立预览数据库、`MAINTENANCE_MODE=off`、预览日志/结构索引路径和 `REDIS_KEY_PREFIX=lsm-preview`（可通过 `PREVIEW_REDIS_KEY_PREFIX` 覆盖）。预览 `.env` 仍需配置可用的 Redis 和生产 JWT 密钥。

测试库不存在时生成新快照并复制测试库；测试库存在但快照丢失时只补建快照；两者均存在时校验并复用，保留测试数据。开启下一轮维护前，先停止整组服务，再备份并移走旧测试库。主库迁移期间如快照丢失，应先恢复原快照再启动，避免从迁移中的主库补建。

脚本在前台管理两个后端，使用普通 `wait` 和每秒一次的进程检查，兼容不支持 `wait -n` 的旧版 Bash。任一后端退出会停止另一个并返回非零状态，便于进程管理器重启；收到停止信号时同时关闭两者。日志输出到进程管理器控制台。启动前检查端口，正式服务占用 `8000` 时会明确报错。

生命周期验证：`bash tests/shell/test_start_read_only_maintenance.sh`。

宝塔进程守护管理器只需添加一个维护进程：运行目录填正式目录，启动命令填 `/bin/bash /www/wwwroot/LabStorageManager/scripts/start_read_only_maintenance.sh`，进程数量设为 1，启动用户沿用后端运行用户（需能读写预览库和读取 JWT 密钥）。启用异常自动重启；进入维护时手动启动，恢复正式服务前先停止维护进程，避免两个任务争用 `8000`。在该任务的 Supervisor 配置中补充：

```ini
autorestart=unexpected
exitcodes=0
stopsignal=TERM
stopwaitsecs=60
stopasgroup=true
killasgroup=true
```

`stopasgroup`/`killasgroup` 确保强制停止时也能清理子进程。参考：[宝塔 Supervisor 教程](https://www.bt.cn/bbs/forum.php?mod=viewthread&tid=34611)、[Supervisor 配置说明](https://supervisord.org/configuration.html)。

Linux 上脚本优先通过 `setsid` 为两个后端分别建立进程组；停止时向两个组发送 TERM，默认最多等待 25 秒，再 KILL 清理残留（可通过 `SHUTDOWN_TIMEOUT_SECONDS` 设置）。Supervisor 的 `stopwaitsecs` 应大于该等待时间。未找到 `setsid` 时退回直接清理后端 PID。已经遗留的进程不属于新脚本，不会自动清理；需先用 `ss -ltnp 'sport = :8002'` 确认进程及其守护任务，再停止对应任务或明确的残留 PID。

### 其他命令

```powershell
# 创建、校验独立库存只读服务使用的 SQLite 一致性快照
python -m app.read_only.snapshot create
python -m app.read_only.snapshot verify

# 统一更新发布版本（PowerShell）
.\scripts\bump-version.ps1 0.6.1

# 跨平台等价命令与发布标签检查
python scripts/release_version.py set 0.6.1
python scripts/release_version.py check v0.6.1

# 结构健康检查
python scripts/check_db_health.py

# 枚举值修复（name -> value）
python scripts/normalize_legacy_enums.py

# 从旧表名迁移到新表名
python scripts/migrate_legacy_tables_with_copy.py

# 导入（示例）
python scripts/migration/import_users.py
python scripts/migration/import_reagent_orders.py <xlsx>
python scripts/migration/import_consumable_orders.py <xlsx>
python scripts/migration/import_inventory.py <xlsx>

# 拼音重建
python scripts/migration/rebuild_pinyin.py all

# 常用货架组补齐
python scripts/backfill_common_shelf_groups.py
python scripts/backfill_common_shelf_groups.py --apply
```
