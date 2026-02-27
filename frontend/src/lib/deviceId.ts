/**
 * Device ID Management
 * 生成并管理客户端设备唯一标识符
 */
const DEVICE_ID_KEY = 'lab_device_id';
const DEVICE_NAME_KEY = 'lab_device_name';
/**
 * 获取或生成设备 ID
 * 设备 ID 存储在 localStorage 中，永久有效
 */
export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  
  if (!deviceId) {
    // 生成 UUID v4
    deviceId = generateUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  
  return deviceId;
}
/**
 * 获取设备名称
 * 从 User-Agent 解析设备信息
 */
export function getDeviceName(): string {
  let deviceName = localStorage.getItem(DEVICE_NAME_KEY);
  
  if (!deviceName) {
    deviceName = parseDeviceName(navigator.userAgent);
    localStorage.setItem(DEVICE_NAME_KEY, deviceName);
  }
  
  return deviceName;
}
/**
 * 解析 User-Agent 获取设备名称
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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
/**
 * 清除设备信息（用于调试）
 */
export function clearDeviceInfo(): void {
  localStorage.removeItem(DEVICE_ID_KEY);
  localStorage.removeItem(DEVICE_NAME_KEY);
}