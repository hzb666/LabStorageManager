/**
 * Device ID Management
 * 生成并管理客户端设备唯一标识符
 */
const DEVICE_ID_KEY = 'lab_device_id';
const DEVICE_NAME_KEY = 'lab_device_name';
let fallbackIdCounter = 0;
/**
 * 获取或生成设备 ID
 * 优先复用 localStorage 中的持久值；若存储不可用则退化为当前会话可用值
 */
export function getDeviceId(): string {
  let deviceId: string | null = null;
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    deviceId = null;
  }
  
  if (!deviceId) {
    // 生成 UUID v4
    deviceId = generateUUID();
    try {
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch {
      // 忽略 localStorage 失败，保证设备 ID 仍可用
    }
  }
  
  return deviceId;
}
/**
 * 获取设备名称
 * 从 User-Agent 解析设备信息
 */
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
      // 忽略 localStorage 失败，保证设备名称仍可返回
    }
  }
  
  return deviceName;
}
/**
 * 解析 User-Agent 获取设备名称
 * 先按浏览器特征命名，未命中时再按操作系统兜底，保持历史口径稳定
 */
function parseDeviceName(userAgent: string): string {
  // 浏览器检测
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
  
  // 操作系统检测
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
/**
 * 生成 UUID v4
 */
function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return generateUUIDFromCryptoValues();
  }
  return generateFallbackUUID();
}
/**
 * 使用 Web Crypto 随机字节生成 UUID v4
 * 目的：消除伪随机告警并保持 RFC4122 格式
 */
function generateUUIDFromCryptoValues(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
/**
 * 在极端无 crypto 环境下生成可追踪 UUID
 * 目的：保留唯一标识能力，避免依赖伪随机数
 */
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
/**
 * 清除设备信息（用于调试）
 */
export function clearDeviceInfo(): void {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_NAME_KEY);
  } catch {
    // 忽略 localStorage 失败
  }
}
