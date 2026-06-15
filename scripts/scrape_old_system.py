#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
旧系统(njiao.cn)库存数据爬虫
用于将旧系统的试剂库存数据爬取并转换为新系统导入格式
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
import re
import time
import argparse
from urllib.parse import urljoin
from datetime import datetime

# 旧系统配置
OLD_SYSTEM_BASE_URL = "http://njiao.cn/reagent/admin"
LOGIN_URL = f"{OLD_SYSTEM_BASE_URL}/default.asp"
INVENTORY_URL = f"{OLD_SYSTEM_BASE_URL}/admin_product.asp"

# 登录凭证
USERNAME = "hzb"
PASSWORD = "123456"

# 登录表单字段名
LOGIN_USERNAME_FIELD = "admin_name"
LOGIN_PASSWORD_FIELD = "admin_pass"

# 新系统导入模板字段
NEW_SYSTEM_COLUMNS = [
    'cas_number',      # CAS号
    'name',            # 中文名称
    'english_name',    # 英文名称
    'alias',           # 别名
    'category',        # 分类
    'brand',           # 供货商 -> 品牌/厂商
    'specification',   # 规格
    'initial_quantity', # 初始数量（从规格解析）
    'location',        # 试剂编号 -> 存放位置
    'is_hazardous',   # 是否危险品
    'price',           # 单价（留空）
    'notes',           # 备注(临时保管)
    'created_at',      # 登记时间
]

# 旧系统字段到新系统的映射
FIELD_MAPPING = {
    'CAS号': 'cas_number',
    '中文名称': 'name',
    '英文名称': 'english_name',
    '试剂编号': 'location',  # 你说这个对应到新系统的location
    '规格': 'specification',
    '供货商': 'brand',
    '分类': 'category',
    '登记时间': 'created_at',
    '备注(临时保管)': 'notes',
}


# 重试配置
MAX_RETRIES = 3  # 最大重试次数
RETRY_DELAYS = [1, 2, 4]  # 指数退避延迟（秒）
REQUEST_INTERVAL = 0.1  # 请求间隔（秒）


class OldSystemSpider:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        })
        self.is_logged_in = False
        self.page_record_counts = {}  # 记录每页获取的记录数
        
    def login(self) -> bool:
        """登录旧系统"""
        print(f"正在登录旧系统: {LOGIN_URL}")
        
        try:
            # 获取登录页面
            response = self.session.get(LOGIN_URL, timeout=30)
            response.encoding = 'gbk'  # 旧系统通常使用GBK编码
            
            # 解析登录表单
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 构建登录数据
            login_data = {
                LOGIN_USERNAME_FIELD: USERNAME,
                LOGIN_PASSWORD_FIELD: PASSWORD,
            }
            
            # 尝试找到表单并提交
            form = soup.find('form')
            if form:
                # 获取表单中的其他隐藏字段
                for input_tag in form.find_all('input'):
                    if input_tag.get('type') == 'hidden':
                        login_data[input_tag.get('name', '')] = input_tag.get('value', '')
                
                action = form.get('action', '')
                if action:
                    login_url = urljoin(LOGIN_URL, action)
                else:
                    login_url = LOGIN_URL
            else:
                login_url = LOGIN_URL
            
            # 提交登录
            response = self.session.post(login_url, data=login_data, timeout=30)
            
            # 检查是否登录成功（通过是否跳转或返回内容判断）
            if 'admin' in response.url or 'manage' in response.url:
                self.is_logged_in = True
                print("✓ 登录成功")
                return True
            else:
                # 再次尝试直接访问管理页面
                response = self.session.get(INVENTORY_URL, timeout=30)
                if response.status_code == 200:
                    self.is_logged_in = True
                    print("✓ 登录成功（通过直接访问验证）")
                    return True
                    
            print("✗ 登录失败")
            return False
            
        except Exception as e:
            print(f"✗ 登录异常: {e}")
            return False
    
    def get_total_pages(self) -> int:
        """获取总页数"""
        try:
            response = self.session.get(INVENTORY_URL, timeout=30)
            response.encoding = 'gbk'
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 查找分页信息，如 "共有试剂 8793 个, 页次: 1/440"
            text = soup.get_text()
            match = re.search(r'页次:\s*(\d+)/(\d+)', text)
            if match:
                total = int(match.group(2))
                print(f"总页数: {total}")
                return total
            
            return 1
        except Exception as e:
            print(f"获取总页数失败: {e}")
            return 1
    
    def parse_page(self, page: int) -> list:
        """解析单页数据（带重试机制）"""
        url = f"{INVENTORY_URL}?gjc=&s_name=&fenlei=&page={page}"
        
        last_error = None
        for retry in range(MAX_RETRIES):
            try:
                response = self.session.get(url, timeout=30)
                response.encoding = 'gbk'
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # 查找表格 - 旧系统有多个表格，数据在第4个表格(索引3)
                tables = soup.find_all('table')
                if len(tables) < 4:
                    if retry < MAX_RETRIES - 1:
                        wait_time = RETRY_DELAYS[retry] if retry < len(RETRY_DELAYS) else RETRY_DELAYS[-1]
                        print(f"  页{page}: 表格数量不足，重试... ({retry + 1}/{MAX_RETRIES})")
                        time.sleep(wait_time)
                        continue
                    return []
                
                table = tables[3]  # 数据表格
                rows = table.find_all('tr')
                if len(rows) < 2:
                    if retry < MAX_RETRIES - 1:
                        wait_time = RETRY_DELAYS[retry] if retry < len(RETRY_DELAYS) else RETRY_DELAYS[-1]
                        print(f"  页{page}: 无数据行，重试... ({retry + 1}/{MAX_RETRIES})")
                        time.sleep(wait_time)
                        continue
                    return []
                
                # 第一行是表头
                headers = []
                header_row = rows[0]
                for th in header_row.find_all(['th', 'td']):
                    headers.append(th.get_text(strip=True))
                
                print(f"  页{page}: 找到表头 - {headers[:5]}...")
                
                # 解析数据行
                data_rows = rows[1:]
                page_data = []
                
                for row in data_rows:
                    cells = row.find_all(['td', 'th'])
                    if len(cells) < 2:
                        continue
                    
                    # 提取单元格文本
                    row_data = {}
                    for i, cell in enumerate(cells):
                        if i < len(headers):
                            header = headers[i]
                            if header in FIELD_MAPPING:
                                field = FIELD_MAPPING[header]
                                value = cell.get_text(strip=True)
                                row_data[field] = value
                    
                    if row_data.get('cas_number') or row_data.get('name'):
                        page_data.append(row_data)
                
                return page_data
                
            except requests.exceptions.Timeout:
                last_error = "请求超时"
                if retry < MAX_RETRIES - 1:
                    wait_time = RETRY_DELAYS[retry] if retry < len(RETRY_DELAYS) else RETRY_DELAYS[-1]
                    print(f"  页{page}: 请求超时，重试... ({retry + 1}/{MAX_RETRIES})")
                    time.sleep(wait_time)
                continue
            except requests.exceptions.ConnectionError as e:
                last_error = f"连接错误: {e}"
                if retry < MAX_RETRIES - 1:
                    wait_time = RETRY_DELAYS[retry] if retry < len(RETRY_DELAYS) else RETRY_DELAYS[-1]
                    print(f"  页{page}: 连接错误，重试... ({retry + 1}/{MAX_RETRIES})")
                    time.sleep(wait_time)
                continue
            except Exception as e:
                last_error = str(e)
                if retry < MAX_RETRIES - 1:
                    wait_time = RETRY_DELAYS[retry] if retry < len(RETRY_DELAYS) else RETRY_DELAYS[-1]
                    print(f"  页{page} 解析失败: {e}, 重试... ({retry + 1}/{MAX_RETRIES})")
                    time.sleep(wait_time)
                continue
        
        # 所有重试都失败
        print(f"  页{page} 解析失败，已重试{MAX_RETRIES}次: {last_error}")
        return []
    
    def parse_specification(self, spec: str) -> tuple:
        """
        解析规格字符串，返回 (数值, 单位)
        如: "100ml" -> (100, "ml")
             "5g" -> (5, "g")
             "25mL" -> (25, "mL")
        """
        if not spec:
            return (1, "个")  # 默认值
        
        # 匹配数字和单位
        match = re.match(r'([\d.]+)\s*([a-zA-Z]+)', spec.strip())
        if match:
            try:
                value = float(match.group(1))
                unit = match.group(2).lower()
                # 标准化单位
                unit_map = {
                    'ml': 'ml', 'l': 'L', 'dl': 'dL',
                    'g': 'g', 'kg': 'kg', 'mg': 'mg',
                    '个': '个', '只': '只', '支': '支',
                }
                return (value, unit_map.get(unit, unit))
            except Exception:
                pass
        
        return (1, "个")
    
    def normalize_date(self, date_str: str) -> str:
        """
        标准化日期格式为 YYYY-MM-DD
        支持格式: 2026/2/23, 20260223, 2026.02.23, 2026-02-23
        """
        if not date_str:
            return ""
        
        date_str = date_str.strip()
        
        # 移除常见分隔符，统一为-
        for sep in ['/', '.']:
            date_str = date_str.replace(sep, '-')
        
        # 处理 YYYYMMDD 格式
        if re.match(r'^\d{8}$', date_str):
            return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
        
        # 处理 YYMMDD 格式
        if re.match(r'^\d{6}$', date_str):
            return f"20{date_str[:2]}-{date_str[2:4]}-{date_str[4:6]}"
        
        # 处理 YYYY-M-D 格式
        parts = date_str.split('-')
        if len(parts) == 3:
            year = parts[0]
            month = parts[1].zfill(2)
            day = parts[2].zfill(2)
            return f"{year}-{month}-{day}"
        
        return date_str
    
    def transform_to_new_format(self, old_data: list) -> pd.DataFrame:
        """将旧系统数据转换为新系统导入格式"""
        new_data = []
        
        for item in old_data:
            # 解析规格
            spec = item.get('specification', '')
            quantity, unit = self.parse_specification(spec)
            
            # 构建新格式
            new_item = {
                'cas_number': item.get('cas_number', '').strip(),
                'name': item.get('name', '').strip(),
                'english_name': item.get('english_name', '').strip(),
                'alias': '',  # 旧系统无此字段
                'category': item.get('category', '').strip(),
                'brand': item.get('brand', '').strip(),
                'specification': spec.strip(),
                'initial_quantity': quantity,
                'location': item.get('location', '').strip(),  # 试剂编号
                'is_hazardous': '',  # 旧系统无此字段
                'price': '',  # 旧系统无此字段
                'notes': item.get('notes', '').strip(),
                'created_at': self.normalize_date(item.get('created_at', '')),
            }
            new_data.append(new_item)
        
        return pd.DataFrame(new_data)
    
    def crawl(self, max_pages: int = None) -> pd.DataFrame:
        """爬取所有数据"""
        if not self.is_logged_in:
            if not self.login():
                return pd.DataFrame()
        
        # 获取总页数
        total_pages = self.get_total_pages() if max_pages is None else max_pages
        
        print(f"\n开始爬取数据，共 {total_pages} 页...")
        all_data = []
        self.page_record_counts = {}  # 重置记录数统计
        
        for page in range(1, total_pages + 1):
            print(f"爬取第 {page}/{total_pages} 页...", end=" ")
            page_data = self.parse_page(page)
            all_data.extend(page_data)
            self.page_record_counts[page] = len(page_data)  # 记录每页的记录数
            print(f"✓ 获取 {len(page_data)} 条记录")
            
            # 避免请求过快
            time.sleep(REQUEST_INTERVAL)
        
        print(f"\n共获取 {len(all_data)} 条原始数据")
        
        # 输出记录为0的页数
        failed_pages = [page for page, count in self.page_record_counts.items() if count == 0]
        if failed_pages:
            print(f"\n⚠ 警告: 以下 {len(failed_pages)} 页获取0条记录:")
            # 分批显示，每行10个页码
            for i in range(0, len(failed_pages), 10):
                batch = failed_pages[i:i+10]
                print(f"  {batch}")
        else:
            print("\n✓ 所有页面均成功获取数据")
        
        # 转换为新系统格式
        df = self.transform_to_new_format(all_data)
        print(f"转换后 {len(df)} 条数据")
        
        return df
    
    def save_to_excel(self, df: pd.DataFrame, filename: str = None):
        """保存为Excel文件"""
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"inventory_import_{timestamp}.xlsx"
        
        # 重新排列列顺序
        column_order = NEW_SYSTEM_COLUMNS
        df = df[column_order]
        
        # 保存Excel
        df.to_excel(filename, index=False, engine='openpyxl')
        print(f"\n✓ 数据已保存到: {filename}")
        return filename


def main():
    """主函数"""
    # 解析命令行参数
    parser = argparse.ArgumentParser(
        description="旧系统(njiao.cn)库存数据爬虫"
    )
    parser.add_argument(
        '-p', '--pages',
        type=int,
        default=None,
        help='抓取前多少页，不指定则抓取全部页面'
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("旧系统(njiao.cn)库存数据爬虫")
    if args.pages:
        print(f"抓取页数限制: 前 {args.pages} 页")
    else:
        print("抓取页数限制: 全部")
    print("=" * 60)
    
    spider = OldSystemSpider()
    
    # 爬取数据，传递 max_pages 参数
    df = spider.crawl(max_pages=args.pages)
    
    if df.empty:
        print("未获取到数据")
        return
    
    # 预览数据
    print("\n数据预览 (前5条):")
    print(df.head().to_string())
    
    # 统计信息
    print("\n数据统计:")
    print(f"  - 总记录数: {len(df)}")
    print(f"  - 有CAS号: {df['cas_number'].notna().sum()}")
    print(f"  - 有分类: {df['category'].notna().sum()}")
    print(f"  - 有品牌: {df['brand'].notna().sum()}")
    
    # 保存
    spider.save_to_excel(df)
    
    print("\n完成!")


if __name__ == "__main__":
    main()
