"""
拼音工具服务 - 用于中文文本转拼音
"""
from pypinyin import lazy_pinyin


def to_pinyin(text: str) -> str:
    """
    将中文文本转换为拼音字符串（无音调）
    
    Args:
        text: 中文文本
        
    Returns:
        拼音字符串（全部小写），如 "乙醇" -> "yichun"
    """
    if not text:
        return ''
    # 使用普通风格（无音调）
    pinyin_list = lazy_pinyin(text, style=0)
    return ''.join(pinyin_list).lower()


def compute_pinyin_fields(name: str = None, category: str = None, 
                          brand: str = None, alias: str = None) -> dict:
    """
    计算多个字段的拼音
    
    Args:
        name: 名称
        category: 类别
        brand: 品牌
        alias: 别名
        
    Returns:
        包含拼音字段的字典
    """
    return {
        'name_pinyin': to_pinyin(name) if name else None,
        'category_pinyin': to_pinyin(category) if category else None,
        'brand_pinyin': to_pinyin(brand) if brand else None,
    }
