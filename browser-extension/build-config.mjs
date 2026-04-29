import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSION_ROOT = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = path.join(EXTENSION_ROOT, '.env')
const MANIFEST_FILE = path.join(EXTENSION_ROOT, 'manifest.json')
const GENERATED_CONFIG_FILE = path.join(EXTENSION_ROOT, 'shared', 'generated-config.js')

const DEFAULT_CONFIG = {
  systemUrl: 'http://localhost:5173',
  reagentSiteUrl: 'https://reagent.bjmu.edu.cn',
}

function parseEnv(content) {
  const values = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

async function readLocalEnv() {
  try {
    return parseEnv(await readFile(ENV_FILE, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

function normalizeOrigin(value, name) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid http(s) origin`)
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https`)
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`${name} must be an origin only, for example https://inventory.example.com`)
  }

  return parsed.origin
}

function buildManifest({ systemUrl, reagentSiteUrl }) {
  const systemCartImportMatch = `${systemUrl}/cart-import*`
  return {
    manifest_version: 3,
    name: '购物车同步',
    version: '0.5.0',
    description: '将试剂平台的购物车同步到实验室库存管理系统',
    icons: {
      16: 'icons/favicon.png',
      32: 'icons/favicon.png',
      48: 'icons/favicon.png',
      128: 'icons/favicon.png',
    },
    permissions: ['tabs', 'storage', 'scripting', 'webRequest'],
    host_permissions: [`${reagentSiteUrl}/*`, `${systemUrl}/*`],
    background: {
      service_worker: 'background/service-worker.js',
    },
    content_scripts: [
      {
        matches: [`${reagentSiteUrl}/*`],
        js: ['content/script.js'],
        run_at: 'document_idle',
      },
      {
        matches: [systemCartImportMatch],
        js: ['content/import-bridge.js'],
        run_at: 'document_idle',
      },
    ],
    action: {
      default_icon: {
        16: 'icons/favicon.png',
        32: 'icons/favicon.png',
      },
      default_popup: 'popup/popup.html',
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
  }
}

function buildGeneratedConfig(config) {
  return [
    '(function initGeneratedExtensionConfig(root) {',
    '  root.ExtensionEnvConfig = {',
    `    systemUrl: ${JSON.stringify(config.systemUrl)},`,
    `    reagentSiteUrl: ${JSON.stringify(config.reagentSiteUrl)},`,
    '  };',
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);",
    '',
  ].join('\n')
}

async function main() {
  const env = {
    ...await readLocalEnv(),
    ...process.env,
  }

  const config = {
    systemUrl: normalizeOrigin(
      env.BROWSER_EXTENSION_SYSTEM_ORIGIN || DEFAULT_CONFIG.systemUrl,
      'BROWSER_EXTENSION_SYSTEM_ORIGIN'
    ),
    reagentSiteUrl: normalizeOrigin(
      env.BROWSER_EXTENSION_REAGENT_SITE_ORIGIN || DEFAULT_CONFIG.reagentSiteUrl,
      'BROWSER_EXTENSION_REAGENT_SITE_ORIGIN'
    ),
  }

  await writeFile(MANIFEST_FILE, `${JSON.stringify(buildManifest(config), null, 2)}\n`, 'utf8')
  await writeFile(GENERATED_CONFIG_FILE, buildGeneratedConfig(config), 'utf8')

  console.log(`Browser extension config generated for ${config.systemUrl}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
