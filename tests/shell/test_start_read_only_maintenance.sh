#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
test_root="$(mktemp -d)"
runner_pid=""
cleanup() {
    if [[ -n "$runner_pid" ]]; then
        kill -TERM "$runner_pid" 2>/dev/null || true
        wait "$runner_pid" 2>/dev/null || true
    fi
    rm -rf -- "$test_root"
}
trap cleanup EXIT
mkdir -p "$test_root/prod" "$test_root/preview"
cp "$repo_root/tests/shell/fixtures/maintenance_python.sh" "$test_root/python"
chmod +x "$test_root/python"
export PROD_ROOT="$test_root/prod" PREVIEW_ROOT="$test_root/preview"
export PYTHON_BIN="$test_root/python" TEST_LOG="$test_root/calls"
export READ_ONLY_SNAPSHOT_PATH="$PROD_ROOT/maintenance/inventory_snapshot.db"
export PREVIEW_DATABASE_PATH="$PREVIEW_ROOT/data/preview.db"

start_group() {
    : >"$TEST_LOG"
    rm -f -- "$TEST_LOG".*
    bash "$repo_root/scripts/start_read_only_maintenance.sh" >"$test_root/output" 2>&1 &
    runner_pid=$!
    for ((attempt = 0; attempt < 100; attempt++)); do
        if [[ -f "$TEST_LOG.app.main:app.pid" && -f "$TEST_LOG.app.read_only.main:app.pid" ]]; then
            return
        fi
        sleep 0.1
    done
    cat "$test_root/output"
    return 1
}
assert_children_stopped() {
    for pid_file in "$TEST_LOG".*.pid; do
        if kill -0 "$(cat "$pid_file")" 2>/dev/null; then
            echo "Child still running: $pid_file" >&2
            return 1
        fi
    done
}

# 首次运行生成快照和测试副本，分别使用两个端口及预览隔离配置。
start_group
grep -q '^snapshot create$' "$TEST_LOG"
grep -q '^snapshot verify$' "$TEST_LOG"
cmp "$READ_ONLY_SNAPSHOT_PATH" "$PREVIEW_DATABASE_PATH"
grep -q "app.main:app|$PREVIEW_ROOT|sqlite:///$PREVIEW_DATABASE_PATH|off|lsm-preview|.*--port 8002" "$TEST_LOG"
grep -q 'app.read_only.main:app|.*--port 8000' "$TEST_LOG"
kill -TERM "$runner_pid"
status=0
wait "$runner_pid" || status=$?
runner_pid=""
[[ "$status" == 143 ]]
assert_children_stopped

# 自动重启保留已编辑的测试数据，不重新创建快照。
printf 'edited-preview' >"$PREVIEW_DATABASE_PATH"
start_group
! grep -q '^snapshot create$' "$TEST_LOG"
[[ "$(cat "$PREVIEW_DATABASE_PATH")" == edited-preview ]]
touch "$TEST_LOG.app.main:app.stop"
status=0
wait "$runner_pid" || status=$?
runner_pid=""
[[ "$status" == 1 ]]
assert_children_stopped

# 快照丢失时补建，不覆盖测试库；非零退出也清理另一个服务。
rm -f -- "$READ_ONLY_SNAPSHOT_PATH"
export SERVICE_EXIT_CODE=17
start_group
grep -q '^snapshot create$' "$TEST_LOG"
[[ "$(cat "$PREVIEW_DATABASE_PATH")" == edited-preview ]]
touch "$TEST_LOG.app.read_only.main:app.stop"
status=0
wait "$runner_pid" || status=$?
runner_pid=""
[[ "$status" == 17 ]]
assert_children_stopped

# 后端拒绝 TERM 时，到达等待上限后强制清理，不能一直占用端口。
export IGNORE_TERM=1 SHUTDOWN_TIMEOUT_SECONDS=2
start_group
kill -TERM "$runner_pid"
status=0
wait "$runner_pid" || status=$?
runner_pid=""
[[ "$status" == 143 ]]
assert_children_stopped
grep -q '停止超时' "$test_root/output"
unset IGNORE_TERM SHUTDOWN_TIMEOUT_SECONDS

# 创建失败不启动任何后端。
rm -f -- "$READ_ONLY_SNAPSHOT_PATH" "$TEST_LOG".*
: >"$TEST_LOG"
status=0
FAIL_CREATE=1 bash "$repo_root/scripts/start_read_only_maintenance.sh" >"$test_root/output" 2>&1 || status=$?
[[ "$status" == 9 ]]
! grep -q 'app.main:app\|app.read_only.main:app' "$TEST_LOG"
echo 'Maintenance launcher lifecycle checks passed.'
