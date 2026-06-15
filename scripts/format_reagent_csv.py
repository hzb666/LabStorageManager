"""
重新格式化 reagent.csv 为试剂订单导入格式
- 规格拆分为 initial_quantity + unit
- 订购人匹配到现有用户
- 订购原因映射到枚举
- 订购日期格式正确
- 价格去除乘号，只保留单价
"""
import pandas as pd
import re
from pathlib import Path

LOCAL_DIR = Path('scripts/local')
REAGENT_CSV = LOCAL_DIR / 'reagent.csv'
REAGENT_FORMATTED_CSV = LOCAL_DIR / 'reagent_formatted_v3.csv'

# 读取原始CSV (GBK编码)
df = pd.read_csv(REAGENT_CSV, encoding='gbk')

# 输出需要的列
df = df[['中文名称', '英文名称', '价格', '规格', 'CAS号', '品牌', '订购人', '订购时间', '订购原因']].copy()

# 用户映射表：中文名 -> username
USER_MAP = {
    '赵心怡': 'zhaoxinyi',
    '王曦': 'wangxi',
    '蒙骏鸿': 'mengjunhong',
    '朱铭辉': 'zhuminghui',
    '徐国峰': 'xuguofeng',
    '张才方': 'zhangcaifang',
    '耿世涵': 'gengshihan',
    '代荣恒': 'dairongheng',
    '霍童雨': 'huotongyu',
    '陈雷': 'chenlei',
    '张红亮': 'zhanghongliang',
    '苏凌宇': 'sulingyu',
    '赵斌治': 'zhaobinzhi',
    '李超': 'lichao',
    '李超 ': 'lichao',  # 处理带空格的情况
    '徐越': 'xuyue',
    '王炳丁': 'wangbingding',
    '程增瑞': 'chengzengrui',
    '王泓野': 'wanghongye',
    '谭慧': 'tanhui',
    '吕斌': 'lvbin',
    '张梓曜': 'zhangziyao',
    '邱旭': 'qiuxu',
    '豆晓东': 'douxiaodong',
    '王琛': 'wangchen',
    '陈莉莉': 'chenlili',
    '王亚冲': 'wangyachong',
    '米景璇': 'mijingxuan',
    '邢一泓': 'xingyihong',
    '孙奕辰': 'sunyichen',
    '胡文姝': 'huwenshu',
    '黄祎磊': 'huangyilei',
    '成泽恺': 'chengzekai',
    '石宏伟': 'shihongwei',
    '彭菁': 'pengjing',
    '唐淑缘': 'tangshuyuan',
    '王铁桥': 'wangtieqiao',
    '杨力诚': 'yanglicheng',
    '胡志斌': 'huzhibin',
    '热合木哈力': 'rehemuhali',
    '彭省': 'pengsheng',
    '鞠翰': 'juhan',
    '黄倩倩': 'huangqianqian',
    '陈奕驰': 'chenyichi',
    '韩帅': 'hanshuai',
    '和钰吉': 'heyuji',
    '梁亦奇': 'liangyiqi',
    '俞亦涵': 'yuyihan',
    '王一涵': 'wangyihan',
    '王超': 'wangchao',
    '王凯旋': 'wangkaixuan',
    '汪洋': 'wangyang',
    '徐瑞麟': 'xuruilin',
    '钟毅': 'zhongyi',
    '翁锦程': 'wengjincheng',
    '王子玫': 'wangzimei',
    '严睿杰': 'yanruijie',
    '赵铭鑫': 'zhaomingxin',
    '陈宇豪': 'chenyuhao',
    # 特殊处理：毕得可能是错误数据，设置一个默认值
    '毕得': 'admin',
}

# 订购原因映射到枚举 - 更全面的映射
REASON_MAP = {
    # 库存用完
    '用完': 'running_out',
    '用完了': 'running_out',
    '快用完': 'running_out',
    '快用完了': 'running_out',
    '用完（供货商取消订单）': 'running_out',
    '已用完': 'running_out',
    '库里用完': 'running_out',
    '库里快用完': 'running_out',
    '库里已用完': 'running_out',
    '库里的用完': 'running_out',
    '库里用完了': 'running_out',
    '基本用完': 'running_out',
    '用完（补）': 'running_out',
    '用完，重下订单': 'running_out',
    '大量用完': 'running_out',
    '快没了': 'running_out',
    '不够用': 'running_out',
    '不够': 'running_out',
    '不多': 'running_out',
    '不多了': 'running_out',
    '量有点少，不太够用': 'running_out',
    '剩一点不够用': 'running_out',
    '库里即将用完': 'running_out',
    '即将用完': 'running_out',
    '快完': 'running_out',
    '所剩不多': 'running_out',
    '量不多了': 'running_out',
    '已用完': 'running_out',
    '之前买的用完': 'running_out',
    '之前买的快用完': 'running_out',
    '上次买的用完': 'running_out',
    '之前用完': 'running_out',
    '上次用完': 'running_out',
    '之前买的快用完': 'running_out',
    '上次无货': 'running_out',
    
    # 库里没有
    '没有': 'not_stocked',
    '库里没找到': 'not_stocked',
    '没有（供货商取消订单）': 'not_stocked',
    '没有了': 'not_stocked',
    '       没有': 'not_stocked',
    '       用完了': 'running_out',
    '没有                 ': 'not_stocked',
    '库里没有': 'not_stocked',
    '库里无': 'not_stocked',
    '库里暂无': 'not_stocked',
    '库中没有': 'not_stocked',
    '库中为偶合且无法找到': 'not_stocked',
    '无库存': 'not_stocked',
    '暂无': 'not_stocked',
    '库里暂无，需补充': 'not_stocked',
    '无': 'none',
    '找不到': 'not_found',
    '没找到': 'not_found',
    '找不到': 'not_found',
    '未找到': 'not_found',
    '库里找不到': 'not_found',
    '库里的找不到': 'not_found',
    '无法找到': 'not_found',
    '有编号但找不到': 'not_found',
    '库里的没找到': 'not_found',
    '库中无': 'not_stocked',
    '库里没了': 'not_stocked',
    '库里无了': 'not_stocked',
    '库里的没了': 'not_stocked',
    '库中没有了': 'not_stocked',
    '库中已无': 'not_stocked',
    
    # 变质/坏了
    '坏了': 'degraded',
    '已坏': 'degraded',
    '已变质': 'degraded',
    '变坏': 'degraded',
    '库里的坏了': 'degraded',
    '库里的性状差': 'degraded',
    '性状差': 'degraded',
    '吸水': 'degraded',
    '库里坏掉': 'degraded',
    '库里坏了': 'degraded',
    '库里太旧': 'degraded',
    '库里太久': 'degraded',
    '库里陈旧': 'degraded',
    '库里时间太长': 'degraded',
    '久置': 'degraded',
    '太旧了': 'degraded',
    '时间太长': 'degraded',
    '放置太久': 'degraded',
    '库里结块': 'degraded',
    '受潮': 'degraded',
    '吸潮': 'degraded',
    '易受潮': 'degraded',
    '易吸水': 'degraded',
    '吸水严重': 'degraded',
    '潮解': 'degraded',
    '库里受潮': 'degraded',
    '库里吸潮': 'degraded',
    '吸潮变质': 'degraded',
    '已处理': 'degraded',
    '性状不良': 'degraded',
    '库里性状不佳': 'degraded',
    '性状不佳': 'degraded',
    '纯度不足': 'degraded',
    '库里纯度低': 'degraded',
    '纯度不够': 'degraded',
    '库里品质差': 'degraded',
    '坏': 'degraded',
    '坏掉': 'degraded',
    '化水': 'degraded',
    '过期': 'degraded',
    '已过期': 'degraded',
    '太老了': 'degraded',
    '堆料': 'degraded',
    '空瓶': 'degraded',
    '有，但品质不行': 'degraded',
    '有但已经吸潮': 'degraded',
    '疑似受潮': 'degraded',
    '易变质': 'degraded',
    '时间久': 'degraded',
    '太久了': 'degraded',
    '很久': 'degraded',
    
    # 公用常用
    '公用': 'common_public',
    '常用': 'common_public',
    '常备': 'common_public',
    '公共试剂': 'common_public',
    '溶剂': 'common_public',  # 溶剂类通常是公用
    '反应溶剂': 'common_public',
    '溶剂用': 'common_public',
    '溶剂快用完': 'running_out',
    'HPLC用': 'common_public',
    '柱层析用': 'common_public',
    '色谱级': 'common_public',
    
    # 大量使用
    '大量使用': 'high_usage',
    '大量需要': 'high_usage',
    '用量大': 'high_usage',
    '需大量': 'high_usage',
    '需要大量': 'high_usage',
    '大量合成': 'high_usage',
    '合成用': 'high_usage',
    '合原料': 'high_usage',
    '原料用': 'high_usage',
    '动物实验': 'high_usage',
    '开反应用': 'high_usage',
    '投反应用': 'high_usage',
    '反应用': 'high_usage',
    '合成原料': 'high_usage',
    '备货': 'high_usage',
    '需要大量备用': 'high_usage',
    '备一瓶新的': 'high_usage',
    '做大量': 'high_usage',
    '放大合成': 'high_usage',
    '大量进货': 'high_usage',
    '需求量较大': 'high_usage',
    '多买一点备用': 'high_usage',
    '多买': 'high_usage',
    '多买一些': 'high_usage',
    
    # 追加订购
    '重新下单': 'reorder',
    '补单': 'reorder',
    '追加订购': 'reorder',
    '再订购': 'reorder',
    '重复实验': 'reorder',
    '重新订购': 'reorder',
    
    # 其他
    '无现货，换厂商': 'not_stocked',
    '需要买一个分子量大的样品': 'not_stocked',
    '库里的编号实际上对应的是溴素': 'not_stocked',
    '药品卡半路了': 'not_stocked',
    '筛条件': 'not_stocked',
    '试反应': 'not_stocked',
    '标准底物': 'common_public',
    '内标': 'common_public',
    '油浴': 'common_public',
    '配置碱缸': 'common_public',
    '高纯度': 'common_public',
    '做标样': 'common_public',
    '测试标样': 'common_public',
    '无水': 'common_public',
    '超干': 'common_public',
    '新反应': 'not_stocked',
    '更换品牌': 'not_stocked',
    '换品牌': 'not_stocked',
    '无货': 'not_stocked',
    '没货': 'not_stocked',
    '取消订单': 'not_stocked',
    '已取消': 'not_stocked',
    '无货，重新下单': 'reorder',
}

def parse_spec(spec_str):
    """解析规格字符串，返回 (初始数量, 单位, 订购数量)"""
    if pd.isna(spec_str) or not spec_str:
        return None, None, 1
    
    spec_str = str(spec_str).strip()
    
    # 预处理：去除多余空格，转小写
    spec_lower = spec_str.lower()
    
    # 模式1: 嵌套格式 2x（10x0.6 mL）
    match_nested = re.match(r'^(\d+)\s*[x*]\s*[\（\(](\d+)\s*[x*]\s*(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)[\）\)]$', spec_lower)
    if match_nested:
        outer_num = int(match_nested.group(1))
        inner_num = int(match_nested.group(2))
        value = float(match_nested.group(3))
        unit = match_nested.group(4)
        quantity = outer_num * inner_num
        return value, unit, quantity
    
    # 模式2: 等号格式 500*2=1000mL
    match_eq = re.match(r'^(\d+\.?\d*)\s*\*\s*(\d+)\s*=\s*(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$', spec_lower)
    if match_eq:
        value = float(match_eq.group(1))
        unit = match_eq.group(4)
        quantity = int(match_eq.group(2))
        return value, unit, quantity
    
    # 模式3: 乘积格式 - 数量在前面 2x500ml, 3*5mL, 1g*3
    # 支持: 数字*数字+单位 或 数字*数字+单位（无空格）
    match_mult_front = re.match(r'^(\d+)\s*[x*]\s*(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$', spec_lower)
    if match_mult_front:
        quantity = int(match_mult_front.group(1))
        value = float(match_mult_front.group(2))
        unit = match_mult_front.group(3)
        return value, unit, quantity
    
    # 模式4: 乘积格式 - 数量在后面 500ml*2, 500 mL X 10, 25g*2
    # 支持有/无空格，大小写x
    match_mult_back = re.match(r'^(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)\s*[x*]\s*(\d+)$', spec_lower)
    if match_mult_back:
        value = float(match_mult_back.group(1))
        unit = match_mult_back.group(2)
        quantity = int(match_mult_back.group(3))
        return value, unit, quantity
    
    # 模式5: 标准格式 500ml, 500 ml
    match = re.match(r'^(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$', spec_lower)
    if match:
        value = float(match.group(1))
        unit = match.group(2)
        # 标准化单位
        unit_map = {
            'ml': 'mL',
            'l': 'L',
            'g': 'g',
            'kg': 'kg',
            'mg': 'mg',
            '个': '个',
            '只': '个',
            '支': '个',
            '瓶': '个',
            '盒': '个',
            '包': '个',
            '套': '个',
        }
        unit = unit_map.get(unit, unit)
        return value, unit, 1
    
    # 无法解析，返回空
    return None, None, 1

def parse_price(price_str):
    """解析价格字符串，去除乘号，返回单价数值"""
    if pd.isna(price_str) or not price_str:
        return None
    
    price_str = str(price_str).strip()
    
    # 去除乘号和 X 符号，取第一个数字
    # 如 "9.5 X 5" -> 9.5, "92.65元" -> 92.65
    price_str = price_str.replace('×', ' ').replace('x', ' ').replace('X', ' ')
    price_str = price_str.replace('元', '').replace('¥', '').replace('$', '')
    
    # 取第一个数值
    match = re.search(r'(\d+(?:\.\d+)?)', price_str)
    if match:
        return float(match.group(1))
    
    return None

def normalize_cas(cas_str):
    """标准化CAS号 - 保留所有有效CAS号"""
    if pd.isna(cas_str) or not cas_str:
        return ''
    
    cas_str = str(cas_str).strip()
    # 去除所有空白字符
    cas_str = cas_str.replace('\t', '').replace('\n', '').replace(' ', '').replace('\r', '')
    
    # 纯数字不符合 CAS 号格式
    if cas_str.isdigit():
        return ''
    # 过滤掉类似日期的格式（如 1979/1/6）
    if '/' in cas_str:
        parts = cas_str.split('/')
        if len(parts) >= 3 and len(parts[0]) == 4:
            try:
                year = int(parts[0])
                if 1990 <= year <= 2030:
                    return ''
            except:
                pass
    
    # 验证CAS号格式：2-7位数字 + 连字符 + 2-3位数字 + 连字符 + 1位校验数字
    # CAS号标准格式：XX-XXX-XX 到 XXXXXXX-XXX-X
    if re.match(r'^\d{2,7}-\d{2,3}-\d$', cas_str):
        return cas_str
    
    return ''

def map_user(name):
    """映射用户名"""
    if pd.isna(name) or not name:
        return 'admin'  # 默认用户
    
    name = str(name).strip()
    return USER_MAP.get(name, 'admin')

def map_reason(reason):
    """映射订购原因到枚举"""
    if pd.isna(reason) or not reason:
        return 'none'
    
    reason = str(reason).strip()
    return REASON_MAP.get(reason, 'none')

def parse_order_time(time_str):
    """解析订购时间"""
    if pd.isna(time_str) or not time_str:
        return ''
    
    time_str = str(time_str).strip()
    
    # 过滤非日期值（如 'F'）
    if not re.match(r'^\d{7,8}$', time_str):
        return ''
    
    # 尝试修复格式
    time_str = time_str.replace('/', '').replace('-', '')
    
    # 8位数字才是有效的 YYYYMMDD
    if len(time_str) == 8 and time_str.isdigit():
        return time_str
    
    return ''

# 处理每一列
print("开始格式化...")

# 1. 处理名称
df['name'] = df['中文名称'].fillna('')
df['english_name'] = df['英文名称'].fillna('')

# 2. 处理价格 - 去除乘号并提取单价
df['price'] = df['价格'].apply(parse_price)

# 3. 处理规格 - 拆分为 初始数量、单位、订购数量
specs = df['规格'].apply(parse_spec)
df['initial_quantity'] = specs.apply(lambda x: x[0])
df['unit'] = specs.apply(lambda x: x[1])
df['quantity'] = specs.apply(lambda x: x[2])
df['specification'] = df['规格'].fillna('')

# 4. 处理CAS号
df['cas_number'] = df['CAS号'].apply(normalize_cas)

# 5. 处理品牌
df['brand'] = df['品牌'].fillna('')

# 6. 处理订购人 - 映射到 username
df['applicant'] = df['订购人'].apply(map_user)

# 7. 处理订购时间
df['order_time'] = df['订购时间'].apply(parse_order_time)

# 8. 处理订购原因 - 映射到枚举
df['order_reason'] = df['订购原因'].apply(map_reason)

# 生成最终CSV - 包含 specification 和 quantity 列以匹配导入脚本
output_df = df[['cas_number', 'name', 'english_name', 'brand', 'specification', 'initial_quantity', 'unit', 'quantity', 'price', 'order_reason', 'applicant', 'order_time']].copy()

# 保存
output_df.to_csv(REAGENT_FORMATTED_CSV, index=False, encoding='utf-8-sig')

print("格式化完成！")
print(f"总行数: {len(output_df)}")

# 统计
print("\n=== 统计信息 ===")
print(f"有效CAS号: {(output_df['cas_number'] != '').sum()}")
print(f"有效时间: {(output_df['order_time'] != '').sum()}")

print("\n=== 订购人分布 ===")
print(output_df['applicant'].value_counts().head(10))

print("\n=== 订购原因分布 ===")
print(output_df['order_reason'].value_counts())

print("\n=== 价格样例 ===")
print(output_df['price'].head(10))

# 读取原始规格来展示
original_specs = pd.read_csv(REAGENT_CSV, encoding='gbk', usecols=['规格'])['规格']
print("\n=== 规格样例 ===")
for i in range(min(10, len(output_df))):
    orig = original_specs.iloc[i] if i < len(original_specs) else ''
    new_qty = output_df['initial_quantity'].iloc[i] if i < len(output_df) else ''
    new_unit = output_df['unit'].iloc[i] if i < len(output_df) else ''
    print(f"{orig} -> {new_qty} {new_unit}")
