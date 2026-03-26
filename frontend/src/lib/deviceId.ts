const DEVICE_ID_KEY = 'lab_device_id';
const DEVICE_NAME_KEY = 'lab_device_name';
let fallbackIdCounter = 0;
// 存储不可用时也要保留当前会话级标识，避免审计链路直接失去设备维度。
export function getDeviceId(): string {
  let deviceId: string | null = null;
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    deviceId = null;
  }
  
  if (!deviceId) {
    deviceId = generateUUID();
    try {
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch {
      // 设备 ID 的核心是“能返回一个稳定值”，持久化失败不该让调用方拿不到标识。
    }
  }
  
  return deviceId;
}

// 设备名称只用于展示和审计，首次解析后缓存下来，避免 UA 细节变化导致名称来回跳。
export function getDeviceName(): string {
  let deviceName: string | null = null;
  try {
    deviceName = localStorage.getItem(DEVICE_NAME_KEY);
  } catch {
    deviceName = null;
  }
  
  if (!deviceName) {
    deviceName = parseDeviceName(navigator.userAgent);
    try {
      localStorage.setItem(DEVICE_NAME_KEY, deviceName);
    } catch {
      // 名称缓存失败仍然返回当前解析结果，不阻断登录和审计展示。
    }
  }
  
  return deviceName;
}
// 先按浏览器特征命名，再按系统兜底，尽量维持历史设备名称口径不漂移。
function parseDeviceName(userAgent: string): string {
  if (userAgent.includes('Firefox')) {
    return 'Firefox Browser';
  }
  if (userAgent.includes('Edg')) {
    return 'Microsoft Edge';
  }
  if (userAgent.includes('Chrome')) {
    return 'Chrome Browser';
  }
  if (userAgent.includes('Safari')) {
    return 'Safari Browser';
  }
  
  if (userAgent.includes('Windows')) {
    return 'Windows PC';
  }
  if (userAgent.includes('Mac')) {
    return 'Macintosh';
  }
  if (userAgent.includes('Linux')) {
    return 'Linux PC';
  }
  if (userAgent.includes('Android')) {
    return 'Android Device';
  }
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    return 'iOS Device';
  }
  
  return 'Unknown Device';
}

function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return generateUUIDFromCryptoValues();
  }
  return generateFallbackUUID();
}

// 没有 `randomUUID` 时仍优先走 Web Crypto，继续保持 RFC4122 形态并避开伪随机实现。
function generateUUIDFromCryptoValues(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// 极端环境下退化为可追踪的确定性标识，重点是不断供，而不是继续伪造“随机”语义。
function generateFallbackUUID(): string {
  fallbackIdCounter = (fallbackIdCounter + 1) % 0xffff;
  const timestampHex = Date.now().toString(16).padStart(12, '0');
  const counterHex = fallbackIdCounter.toString(16).padStart(4, '0');
  const raw = `${timestampHex}${counterHex}`.padEnd(32, '0').slice(0, 32).split('');
  raw[12] = '4';
  raw[16] = ((Number.parseInt(raw[16], 16) & 0x3) | 0x8).toString(16);
  const hex = raw.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
// 仅供调试或重置设备身份流程使用，不参与正常业务链路。
export function clearDeviceInfo(): void {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_NAME_KEY);
  } catch {
    // 本地清理失败不需要再抛错，调试入口不该影响页面主流程。
  }
}
