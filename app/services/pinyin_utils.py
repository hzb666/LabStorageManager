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
                          brand: str = None, alias: str = None,
                          storage_location: str = None,
                          full_name: str = None,
                          max_length: int = 200) -> dict:
    """
    计算多个字段的拼音

    Args:
        name: 名称
        category: 类别
        brand: 品牌
        alias: 别名
        storage_location: 位置
        full_name: 姓名（用于用户排序）
        max_length: 拼音字段的最大长度，超出部分会被截断

    Returns:
        包含拼音字段的字典
    """
    def truncate(text: str) -> str:
        """截断超长文本"""
        return text[:max_length] if len(text) > max_length else text

    result = {
        'name_pinyin': truncate(to_pinyin(name)) if name else None,
        'category_pinyin': truncate(to_pinyin(category)) if category else None,
        'brand_pinyin': truncate(to_pinyin(brand)) if brand else None,
        'storage_location_pinyin': truncate(to_pinyin(storage_location)) if storage_location else None,
    }

    # 添加 full_name_pinyin（用于用户排序）
    if full_name:
        result['full_name_pinyin'] = truncate(to_pinyin(full_name))

    return result
