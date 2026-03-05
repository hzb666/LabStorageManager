"""
Error Logger Service - 后端错误日志收集服务

用于收集后端Python运行时的错误日志，并提供安全过滤功能
"""
import logging
import re
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timedelta

# 敏感关键词列表（用于日志脱敏）
SENSITIVE_KEYWORDS = [
    "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
    "access_token", "refresh_token", "jwt", "authorization", "auth",
    "private_key", "public_key", "secret_key", "encryption_key",
    "credential", "client_secret", "connection_string", "database_url",
    "smtp_password", "mail_password", "redis_password",
]

# 日志目录
LOG_DIR = Path(__file__).parent.parent.parent / "logs"
LOG_FILE = LOG_DIR / "error.log"

# 确保日志目录存在
LOG_DIR.mkdir(parents=True, exist_ok=True)


def get_error_logger() -> logging.Logger:
    """获取错误日志记录器"""
    logger = logging.getLogger("error_logger")
    
    # 避免重复添加handler
    if logger.handlers:
        return logger
    
    logger.setLevel(logging.ERROR)
    
    # 文件处理器 - 使用RotatingFileHandler限制文件大小
    try:
        from logging.handlers import RotatingFileHandler
        
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=5 * 1024 * 1024,  # 5MB
            encoding="utf-8"
        )
    except Exception:
        # 如果RotatingFileHandler不可用，使用普通FileHandler
        file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    
    file_handler.setLevel(logging.ERROR)
    
    # 设置日志格式
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    file_handler.setFormatter(formatter)
    
    logger.addHandler(file_handler)
    
    return logger


def sanitize_log_content(content: str) -> str:
    """
    对日志内容进行脱敏处理
    
    移除敏感信息如密码、token、密钥等
    """
    sanitized = content
    
    # 替换敏感键值对 - 使用更精确的正则避免误伤
    for keyword in SENSITIVE_KEYWORDS:
        # 匹配 key=value 或 key: value 格式，要求前面有空格或开头
        # 排除常见单词中的关键词（如 password123 中的 pass 不会被替换）
        pattern = rf"(?:^|\s|[\"'])({keyword})(?:[=:]\s*)[^\s,}}]+"
        sanitized = re.sub(
            pattern,
            r"\1***",
            sanitized,
            flags=re.IGNORECASE
        )
        
        # 替换JSON中的敏感字段
        pattern = rf'"{keyword}"\s*:\s*"[^"]+"'
        sanitized = re.sub(
            pattern,
            r'"\1": "***"',
            sanitized,
            flags=re.IGNORECASE
        )
    
    # 替换明显的Base64编码的token（长字符串）
    pattern = r'(eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)'
    sanitized = re.sub(pattern, '***JWT_TOKEN***', sanitized)
    
    return sanitized


def get_recent_error_logs(lines: int = 100) -> List[str]:
    """
    获取最近的错误日志
    
    Args:
        lines: 返回的日志行数
    
    Returns:
        错误日志列表（已脱敏）
    """
    if not LOG_FILE.exists():
        return []
    
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            all_lines = f.readlines()
        
        # 只返回最后N行ERROR级别的日志
        error_lines = [
            line for line in all_lines 
            if "[ERROR]" in line
        ]
        
        recent_lines = error_lines[-lines:] if len(error_lines) > lines else error_lines
        
        # 对每行进行脱敏处理
        sanitized_lines = [sanitize_log_content(line) for line in recent_lines]
        
        return sanitized_lines
        
    except Exception as e:
        logger = get_error_logger()
        logger.error(f"Failed to read error logs: {e}")
        return []


def get_error_logs_since(hours: int = 24) -> List[str]:
    """
    获取指定时间范围内的错误日志
    
    Args:
        hours: 小时数
    
    Returns:
        错误日志列表（已脱敏）
    """
    if not LOG_FILE.exists():
        return []
    
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            all_lines = f.readlines()
        
        # 解析时间并过滤
        cutoff_time = datetime.now() - timedelta(hours=hours)
        recent_errors = []
        
        for line in all_lines:
            if "[ERROR]" not in line:
                continue
            
            try:
                # 提取时间戳 (格式: 2024-01-01 12:00:00)
                time_str = line.split("[")[0].strip()
                log_time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
                
                if log_time >= cutoff_time:
                    recent_errors.append(sanitize_log_content(line))
            except (ValueError, IndexError):
                # 如果无法解析时间，保留该行
                recent_errors.append(sanitize_log_content(line))
        
        return recent_errors
        
    except Exception as e:
        logger = get_error_logger()
        logger.error(f"Failed to read error logs: {e}")
        return []


def log_error(message: str, exc_info: Optional[Exception] = None) -> None:
    """
    记录错误日志
    
    Args:
        message: 错误消息
        exc_info: 异常信息（可选）
    """
    logger = get_error_logger()
    
    if exc_info:
        logger.error(message, exc_info=True)
    else:
        logger.error(message)


def clear_old_logs(days: int = 7) -> int:
    """
    清理旧的日志文件
    
    Args:
        days: 保留天数
    
    Returns:
        删除的日志行数
    """
    if not LOG_FILE.exists():
        return 0
    
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            all_lines = f.readlines()
        
        cutoff_time = datetime.now() - timedelta(days=days)
        remaining_lines = []
        deleted_count = 0
        
        for line in all_lines:
            if "[ERROR]" not in line:
                remaining_lines.append(line)
                continue
            
            try:
                time_str = line.split("[")[0].strip()
                log_time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
                
                if log_time >= cutoff_time:
                    remaining_lines.append(line)
                else:
                    deleted_count += 1
            except (ValueError, IndexError):
                remaining_lines.append(line)
        
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.writelines(remaining_lines)
        
        return deleted_count
        
    except Exception as e:
        logger = get_error_logger()
        logger.error(f"Failed to clear old logs: {e}")
        return 0
