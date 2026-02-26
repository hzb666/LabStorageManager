/**
 * 输入验证工具函数
 * 提供统一的验证逻辑和错误提示
 */

/**
 * 验证 CAS 号格式和校验码
 * CAS号格式：三部分组成，第一部分2-6位数字，第二部分2位数字，第三部分1位校验码
 * 校验码计算：将第一二部分的数字从右到左依次乘以1,2,3...，求和后取模10
 * @param casNumber CAS号（如：64-17-5, 7732-18-5）
 * @returns 验证结果对象
 */
export function validateCASNumber(casNumber: string): { 
  isValid: boolean; 
  error?: string;
  normalized?: string;
} {
  // 先去除空格并转大写
  const normalized = casNumber.trim().toUpperCase();
  
  // 基本格式验证：必须是 XXXXXX-XX-X 格式
  const basicFormatRegex = /^\d{2,6}-\d{2}-\d$/;
  if (!basicFormatRegex.test(normalized)) {
    return {
      isValid: false,
      error: 'CAS号格式无效'
    };
  }

  // 分割三部分
  const parts = normalized.split('-');
  const firstPart = parts[0]; // 2-6位
  const secondPart = parts[1]; // 2位
  const thirdPart = parts[2]; // 校验码（1位）
  
  // 合并前两部分作为顺序号
  const sequenceNumber = firstPart + secondPart;
  
  // 计算校验码
  const digits = sequenceNumber.split('').reverse(); // 反转顺序
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    const digit = parseInt(digits[i], 10);
    const multiplier = i + 1; // 1, 2, 3, ...
    sum += digit * multiplier;
  }
  
  const calculatedCheckDigit = sum % 10;
  const actualCheckDigit = parseInt(thirdPart, 10);
  
  if (calculatedCheckDigit !== actualCheckDigit) {
    return {
      isValid: false,
      error: `CAS号校验码错误（期望：${calculatedCheckDigit}）`,
      normalized
    };
  }

  return {
    isValid: true,
    normalized
  };
}

/**
 * 标准化 CAS 号（去除空格、转大写）
 * @param casNumber 原始CAS号
 * @returns 标准化后的CAS号
 */
export function normalizeCASNumber(casNumber: string): string {
  return casNumber.trim().toUpperCase();
}

/**
 * 验证必填字段
 * @param value 要验证的值
 * @param fieldName 字段中文名称（用于错误提示）
 * @returns 验证结果对象
 */
export function validateRequired(value: string | undefined | null, fieldName: string): {
  isValid: boolean;
  error?: string;
} {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return {
      isValid: false,
      error: `${fieldName}不能为空`
    };
  }
  return { isValid: true };
}

/**
 * 验证字符串长度范围
 * @param value 要验证的值
 * @param min 最小长度
 * @param max 最大长度
 * @param fieldName 字段中文名称
验证结果对象
 * @returns  */
export function validateStringLength(
  value: string, 
  min: number, 
  max: number, 
  fieldName: string
): {
  isValid: boolean;
  error?: string;
} {
  if (value.length < min) {
    return {
      isValid: false,
      error: `${fieldName}至少${min}个字符`
    };
  }
  if (value.length > max) {
    return {
      isValid: false,
      error: `${fieldName}最多${max}个字符`
    };
  }
  return { isValid: true };
}

/**
 * 验证正数
 * @param value 要验证的值
 * @param fieldName 字段中文名称
 * @returns 验证结果对象
 */
export function validatePositiveNumber(value: number, fieldName: string): {
  isValid: boolean;
  error?: string;
} {
  if (value <= 0) {
    return {
      isValid: false,
      error: `${fieldName}必须大于0`
    };
  }
  return { isValid: true };
}

/**
 * 验证非负数
 * @param value 要验证的值
 * @param fieldName 字段中文名称
 * @returns 验证结果对象
 */
export function validateNonNegativeNumber(value: number, fieldName: string): {
  isValid: boolean;
  error?: string;
} {
  if (value < 0) {
    return {
      isValid: false,
      error: `${fieldName}不能为负数`
    };
  }
  return { isValid: true };
}

/**
 * 验证用户名格式（字母、数字、下划线）
 * @param username 用户名
 * @returns 验证结果对象
 */
export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (!username.trim()) {
    return { isValid: false, error: '用户名不能为空' };
  }
  if (username.length < 3) {
    return { isValid: false, error: '用户名至少3个字符' };
  }
  if (username.length > 20) {
    return { isValid: false, error: '用户名最多20个字符' };
  }
  // 用户名只能包含字母、数字、下划线
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(username)) {
    return { isValid: false, error: '用户名只能包含字母、数字和下划线' };
  }
  return { isValid: true };
}

/**
 * 验证密码强度
 * @param password 密码
 * @returns 验证结果对象
 */
export function validatePassword(password: string): {
  isValid: boolean;
  error?: string;
  strength?: 'weak' | 'medium' | 'strong';
} {
  if (!password) {
    return { isValid: false, error: '密码不能为空' };
  }
  if (password.length < 6) {
    return { isValid: false, error: '密码至少6个字符', strength: 'weak' };
  }
  if (password.length < 8) {
    return { isValid: true, strength: 'medium' };
  }
  
  // 检查密码复杂度
  const hasLowerCase = /[a-z]/.test(password);
  const hasUpperCase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  const complexityScore = [hasLowerCase, hasUpperCase, hasNumber, hasSpecialChar]
    .filter(Boolean).length;
  
  if (complexityScore >= 3) {
    return { isValid: true, strength: 'strong' };
  }
  
  return { isValid: true, strength: 'medium' };
}

/**
 * 验证规格格式（如：500ml, 1L, 100g, 500 ml, 1.5L）
 * 忽略数字与单位之间的空格，忽略单位大小写
 * 支持单位: ml, L, g, kg, mg, 个, 瓶, 支, 盒, 包, 套
 * @param spec 规格字符串
 * @returns 验证结果对象
 */
export function validateSpecification(spec: string): {
  isValid: boolean;
  error?: string;
} {
  if (!spec.trim()) {
    return { isValid: false, error: '规格不能为空' };
  }
  
  // 去除空格后转小写，然后验证
  const normalizedSpec = spec.trim().toLowerCase();
  
  // 规格格式：数字 + 可选空格 + 单位（ml, L, g, kg, mg, 个, 瓶, 支, 盒, 包, 套）
  // 支持数字有小数点，如 1.5L, 0.5g
  const specRegex = /^\d+(\.\d+)?\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$/i;
  if (!specRegex.test(normalizedSpec)) {
    return {
      isValid: false,
      error: '规格格式无效'
    };
  }
  
  return { isValid: true };
}

/**
 * 验证价格范围
 * @param price 价格
 * @param min 最小值（默认0）
 * @param max 最大值（默认999999）
 * @returns 验证结果对象
 */
export function validatePrice(
  price: number, 
  min: number = 0, 
  max: number = 999999
): {
  isValid: boolean;
  error?: string;
} {
  if (isNaN(price)) {
    return { isValid: false, error: '价格必须是数字' };
  }
  if (price < min) {
    return { isValid: false, error: `价格不能小于${min}` };
  }
  if (price > max) {
    return { isValid: false, error: `价格不能大于${max}` };
  }
  return { isValid: true };
}
