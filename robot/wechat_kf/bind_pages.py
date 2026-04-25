"""Static bind pages for WeChat customer service account linking."""

from __future__ import annotations

import html
from typing import Any

from app.core.constants import PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH


def bind_form_html(state: str, error: str) -> str:
    safe_state = html.escape(state, quote=True)
    error_html = _error_notice(error)
    return _page_html(
        title="绑定 LabStorageManager",
        body=f"""
          <div class="card-header">
            <div class="title-wrap">
              <h1>实验室库存管理系统</h1>
              <p>绑定微信客服账号</p>
            </div>
          </div>
          <div class="card-content">
            {error_html}
            <form method="post" action="/wechat/kf/bind/{safe_state}" class="form">
              <div class="field">
                <label for="username">用户名</label>
                <input id="username" name="username" autocomplete="username" maxlength="{USERNAME_MAX_LENGTH}" required>
              </div>
              <div class="field">
                <label for="password">密码</label>
                <input id="password" name="password" type="password" autocomplete="current-password" maxlength="{PASSWORD_MAX_LENGTH}" required>
              </div>
              <button type="submit">绑定账号</button>
            </form>
          </div>""",
    )


def bind_success_html(user: dict[str, Any], username: str) -> str:
    display = html.escape(str(user.get("full_name") or user.get("username") or username))
    return _page_html(
        title="绑定成功",
        body=f"""
          <div class="card-header">
            <div class="title-wrap">
              <h1>绑定成功</h1>
              <p>当前已绑定：{display}</p>
            </div>
          </div>
          <div class="card-content">
            <p class="helper-text">请回到微信客服继续查询、借用或归还。</p>
          </div>""",
    )


def _error_notice(error: str) -> str:
    if not error:
        return ""
    return f'<p class="error" role="alert">{html.escape(error)}</p>'


def _page_html(*, title: str, body: str) -> str:
    safe_title = html.escape(title)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <style>{_PAGE_CSS}</style>
</head>
<body>
  <main class="login-shell">
    <div class="login-pattern" aria-hidden="true"></div>
    <section class="login-card" aria-label="{safe_title}">
{body}
    </section>
  </main>
</body>
</html>"""


_PAGE_CSS = """
    :root {
      --background: #f7f7f7;
      --foreground: #111827;
      --card: #ffffff;
      --card-foreground: #111827;
      --primary: #1f2937;
      --primary-foreground: #f8fafc;
      --muted-foreground: #6b7280;
      --destructive: #dc2626;
      --destructive-bg: #fee2e2;
      --border: #e5e7eb;
      --input: #e5e7eb;
      --ring: #9ca3af;
    }

    @supports (color: oklch(1 0 0)) {
      :root {
        --background: oklch(0.97 0 0);
        --foreground: oklch(0.129 0.042 264.695);
        --card: oklch(1 0 0);
        --card-foreground: oklch(0.129 0.042 264.695);
        --primary: oklch(0.208 0.042 265.755);
        --primary-foreground: oklch(0.984 0.003 247.858);
        --muted-foreground: oklch(0.554 0.046 257.417);
        --destructive: oklch(0.577 0.245 27.325);
        --destructive-bg: color-mix(in oklch, var(--destructive) 10%, transparent);
        --border: oklch(0.922 0.016 264.531);
        --input: oklch(0.922 0.016 264.531);
        --ring: oklch(0.704 0.04 256.788);
      }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --background: #24242a;
        --foreground: #e5e7eb;
        --card: #303036;
        --card-foreground: #e5e7eb;
        --primary: #e5e7eb;
        --primary-foreground: #1f2937;
        --muted-foreground: #a1a1aa;
        --destructive: #f87171;
        --destructive-bg: #3f1f24;
        --border: #4b5563;
        --input: #4b5563;
        --ring: #e5e7eb;
      }

      @supports (color: oklch(1 0 0)) {
        :root {
          --background: oklch(0.15 0.015 285.823);
          --foreground: oklch(0.92 0 0);
          --card: oklch(0.20 0.008 285.823);
          --card-foreground: oklch(0.92 0 0);
          --primary: oklch(0.92 0 0);
          --primary-foreground: oklch(0.208 0.042 265.755);
          --muted-foreground: oklch(0.65 0.015 285.823);
          --destructive: oklch(0.7022 0.1892 22.23);
          --border: oklch(0.3 0.015 285.823);
          --input: oklch(0.3 0.015 285.823);
          --ring: oklch(0.92 0 0);
        }
      }
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      min-height: 100%;
      margin: 0;
    }

    body {
      background: var(--background);
      color: var(--foreground);
      font-family: Arial, "Helvetica Neue", "Microsoft YaHei", "PingFang SC", sans-serif;
      -webkit-tap-highlight-color: transparent;
    }

    .login-shell {
      position: relative;
      display: flex;
      min-height: 100svh;
      width: 100%;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      overflow: hidden;
    }

    .login-pattern {
      position: absolute;
      inset: 0;
      z-index: -1;
      background-image: radial-gradient(circle at center, var(--border) 1px, transparent 1px);
      background-size: 16px 16px;
      mask-image: radial-gradient(closest-side at 50% 50%, #000 70%, transparent 100%);
    }

    .login-card {
      width: min(100%, 24rem);
      display: flex;
      flex-direction: column;
      padding: 1.5rem 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--card);
      color: var(--card-foreground);
    }

    .card-header {
      display: grid;
      gap: 0.375rem;
      padding: 0 1.5rem;
    }

    .title-wrap {
      padding: 0.25rem;
      text-align: left;
    }

    h1 {
      margin: 0;
      font-size: 1.5rem;
      line-height: 1.15;
      font-weight: 700;
    }

    .title-wrap p,
    .helper-text {
      margin: 0.375rem 0 0;
      color: var(--muted-foreground);
      font-size: 0.875rem;
      line-height: 1.5;
    }

    .card-content {
      padding: 1rem 1.5rem 0;
    }

    .form {
      display: grid;
      gap: 1rem;
      margin-top: 1rem;
    }

    .field {
      display: grid;
      gap: 0.375rem;
    }

    label {
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.25rem;
    }

    input {
      width: 100%;
      height: 2.5rem;
      border: 1px solid var(--input);
      border-radius: 6px;
      background: transparent;
      color: inherit;
      padding: 0 0.75rem;
      font: inherit;
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }

    input:focus {
      border-color: var(--ring);
      box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.35);
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 35%, transparent);
    }

    button {
      display: inline-flex;
      width: 100%;
      height: 2.5rem;
      align-items: center;
      justify-content: center;
      margin-top: 0.5rem;
      border: 1px solid transparent;
      border-radius: 6px;
      background: var(--primary);
      color: var(--primary-foreground);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 150ms ease;
    }

    button:hover {
      opacity: 0.86;
    }

    .error {
      margin: 1rem 0 0;
      padding: 0.75rem;
      border-radius: 6px;
      background: var(--destructive-bg);
      color: var(--destructive);
      font-size: 0.875rem;
      line-height: 1.5;
    }
    """
