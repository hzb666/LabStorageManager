import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const chrome = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path))

export async function openBrowser() {
  const temporary = await mkdtemp(join(tmpdir(), 'lsm-report-'))
  const browserProcess = spawn(chrome, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe',
    `--user-data-dir=${join(temporary, 'profile')}`, 'about:blank'], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let id = 0, buffer = ''
  const pending = new Map()
  browserProcess.stdio[4].setEncoding('utf8')
  browserProcess.stdio[4].on('data', chunk => {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
      const task = pending.get(message.id)
      if (!task) continue
      pending.delete(message.id)
      clearTimeout(task.timer)
      message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const number = ++id
    const timer = setTimeout(() => { pending.delete(number); reject(new Error(`${method} timed out`)) }, 5000)
    pending.set(number, { resolve, reject, timer })
    browserProcess.stdio[3].write(JSON.stringify({ id: number, method, params, sessionId }) + '\0')
  })
  const close = async () => {
    await send('Browser.close').catch(() => browserProcess.kill())
    if (browserProcess.exitCode === null) await new Promise(resolve => browserProcess.once('exit', resolve))
    for (const task of pending.values()) clearTimeout(task.timer)
    // Only remove the temporary profile created above, never a user's browser profile.
    assert.equal(temporary.startsWith(join(tmpdir(), 'lsm-report-')), true)
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  return { temporary, send, close }
}
