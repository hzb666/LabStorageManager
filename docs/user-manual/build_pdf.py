from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEX_PATH = ROOT / 'user_manual.tex'
PDF_PATH = ROOT / 'user_manual.pdf'
TXT_PATH = ROOT / 'user_manual_extracted.txt'

PAGE_WIDTH = 595.28
PAGE_HEIGHT = 841.89
LEFT = 62
RIGHT = 62
TOP = 56
BOTTOM = 44
FONT_SIZE = 10.2
LINE_HEIGHT = 14.2
TITLE_SIZE = 20
SECTION_SIZE = 16
SUBSECTION_SIZE = 13
MAX_CHARS = 56


def strip_latex_commands(text: str) -> str:
    replacements = [
        (r'\\textbf\{([^{}]*)\}', r'\1'),
        (r'\\texttt\{([^{}]*)\}', r'\1'),
        (r'\\today', '2026-03-18'),
        (r'\\LaTeX', 'LaTeX'),
        (r'\\%', '%'),
        (r'\\_', '_'),
        (r'\\&', '&'),
        (r'~', ' '),
    ]
    for pattern, repl in replacements:
        text = re.sub(pattern, repl, text)

    # unwrap simple braces
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r'\\[a-zA-Z*]+\{([^{}]*)\}', r'\1', text)

    text = re.sub(r'\\[a-zA-Z]+', '', text)
    text = text.replace('{', '').replace('}', '')
    return text.strip()


def extract_text(tex: str) -> list[tuple[str, str]]:
    lines = tex.splitlines()
    blocks: list[tuple[str, str]] = []
    in_longtable = False
    in_titlepage = False
    list_mode = None

    for raw in lines:
        line = raw.strip()
        if not line:
            if blocks and blocks[-1][0] == 'paragraph' and blocks[-1][1] != '':
                blocks.append(('blank', ''))
            continue
        if line.startswith('%'):
            continue
        if line.startswith('\\begin{titlepage}'):
            in_titlepage = True
            continue
        if line.startswith('\\end{titlepage}'):
            in_titlepage = False
            continue
        if in_titlepage:
            text = strip_latex_commands(line)
            if text and text not in {'centering', 'vfill'}:
                blocks.append(('title', text))
            continue
        if line.startswith('\\tableofcontents'):
            blocks.append(('section', '目录'))
            blocks.append(('paragraph', '本 PDF 版本保留完整正文内容；如需按章节跳转，可结合 LaTeX 源文件目录查看。'))
            continue
        if line.startswith('\\newpage'):
            blocks.append(('blank', ''))
            continue
        if line.startswith('\\begin{itemize}'):
            list_mode = 'bullet'
            continue
        if line.startswith('\\begin{enumerate}'):
            list_mode = 'number'
            continue
        if line.startswith('\\end{itemize}') or line.startswith('\\end{enumerate}'):
            list_mode = None
            blocks.append(('blank', ''))
            continue
        if line.startswith('\\begin{longtable}'):
            in_longtable = True
            continue
        if line.startswith('\\end{longtable}'):
            in_longtable = False
            blocks.append(('blank', ''))
            continue
        if in_longtable:
            if any(token in line for token in ['\\toprule', '\\midrule', '\\bottomrule']):
                continue
            if '&' in line and '\\\\' in line:
                row = strip_latex_commands(line.replace('\\\\', ''))
                parts = [p.strip() for p in row.split('&') if p.strip()]
                if parts:
                    blocks.append(('paragraph', '｜'.join(parts)))
            continue

        section_match = re.match(r'\\section\{(.+?)\}', line)
        if section_match:
            blocks.append(('section', strip_latex_commands(section_match.group(1))))
            continue
        subsection_match = re.match(r'\\subsection\{(.+?)\}', line)
        if subsection_match:
            blocks.append(('subsection', strip_latex_commands(subsection_match.group(1))))
            continue
        subsubsection_match = re.match(r'\\subsubsection\{(.+?)\}', line)
        if subsubsection_match:
            blocks.append(('subsection', strip_latex_commands(subsubsection_match.group(1))))
            continue
        if line.startswith('\\item'):
            content = strip_latex_commands(line[5:].strip())
            prefix = '• ' if list_mode == 'bullet' else '◦ '
            blocks.append(('paragraph', prefix + content))
            continue

        text = strip_latex_commands(line)
        if text and text not in {'pagestylefancy', 'fancyhf[]', 'fancyhead[L]实验室库存管理系统用户操作手册'}:
            blocks.append(('paragraph', text))

    merged: list[tuple[str, str]] = []
    for kind, text in blocks:
        if kind == 'blank':
            if merged and merged[-1][0] != 'blank':
                merged.append((kind, text))
            continue
        if kind == 'paragraph' and merged and merged[-1][0] == 'paragraph':
            if merged[-1][1].endswith(('：', ':')) or text.startswith(('•', '◦')):
                merged.append((kind, text))
            else:
                merged[-1] = ('paragraph', merged[-1][1] + text)
        else:
            merged.append((kind, text))
    return merged


def char_units(ch: str) -> float:
    if ch.isspace():
        return 0.45
    if ord(ch) < 128:
        return 0.55
    return 1.0


def wrap_text(text: str, limit: float) -> list[str]:
    if not text:
        return ['']
    out: list[str] = []
    cur = ''
    units = 0.0
    for ch in text:
        w = char_units(ch)
        if cur and units + w > limit:
            out.append(cur)
            cur = ch
            units = w
        else:
            cur += ch
            units += w
    if cur:
        out.append(cur)
    return out or ['']


def escape_pdf_text(text: str) -> str:
    return text.encode('utf-16-be').hex().upper()


def build_pages(blocks: list[tuple[str, str]]) -> list[list[tuple[str, float, str]]]:
    pages: list[list[tuple[str, float, str]]] = []
    current: list[tuple[str, float, str]] = []
    y = PAGE_HEIGHT - TOP

    def ensure(lines_needed: int, line_height: float = LINE_HEIGHT):
        nonlocal current, y
        needed = lines_needed * line_height
        if y - needed < BOTTOM:
            pages.append(current)
            current = []
            y = PAGE_HEIGHT - TOP

    for kind, text in blocks:
        if kind == 'blank':
            y -= LINE_HEIGHT * 0.6
            continue
        if kind == 'title':
            ensure(2, 24)
            current.append((text, TITLE_SIZE, 'center'))
            y -= 26
            continue
        if kind == 'section':
            y -= 8
            ensure(2, 22)
            current.append((text, SECTION_SIZE, 'left'))
            y -= 24
            continue
        if kind == 'subsection':
            y -= 4
            ensure(2, 18)
            current.append((text, SUBSECTION_SIZE, 'left'))
            y -= 18
            continue
        if kind == 'paragraph':
            lines = wrap_text(text, MAX_CHARS)
            ensure(len(lines) + 1)
            for line in lines:
                current.append((line, FONT_SIZE, 'left'))
                y -= LINE_HEIGHT
            y -= 4
    if current:
        pages.append(current)
    return pages


def make_content_stream(page_items: list[tuple[str, float, str]], page_no: int, total_pages: int) -> bytes:
    y = PAGE_HEIGHT - TOP
    parts: list[str] = []
    for text, size, align in page_items:
        if align == 'center':
            x = PAGE_WIDTH / 2 - (len(text) * size) / 2
        else:
            x = LEFT
        parts.append('BT')
        parts.append(f'/F1 {size:.2f} Tf')
        parts.append(f'1 0 0 1 {x:.2f} {y:.2f} Tm')
        parts.append(f'<{escape_pdf_text(text)}> Tj')
        parts.append('ET')
        if size >= TITLE_SIZE:
            y -= 26
        elif size >= SECTION_SIZE:
            y -= 24
        elif size >= SUBSECTION_SIZE:
            y -= 18
        else:
            y -= LINE_HEIGHT
    footer = f'第 {page_no} 页 / 共 {total_pages} 页'
    parts.extend([
        'BT',
        '/F1 10 Tf',
        f'1 0 0 1 {PAGE_WIDTH / 2 - 55:.2f} 26 Tm',
        f'<{escape_pdf_text(footer)}> Tj',
        'ET',
    ])
    return '\n'.join(parts).encode('utf-8')


def write_pdf(pages: list[list[tuple[str, float, str]]], path: Path) -> None:
    objects: list[bytes] = []

    def add(obj: str | bytes) -> int:
        data = obj if isinstance(obj, bytes) else obj.encode('utf-8')
        objects.append(data)
        return len(objects)

    font_descendant_id = add(
        '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light '
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> '
        '/DW 1000 >>'
    )
    font_id = add(
        f'<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H '
        f'/DescendantFonts [{font_descendant_id} 0 R] >>'
    )

    page_ids: list[int] = []
    content_ids: list[int] = []
    pages_tree_id_placeholder = len(objects) + 1

    total_pages = len(pages)
    for idx, page in enumerate(pages, start=1):
        content = make_content_stream(page, idx, total_pages)
        content_id = add(f'<< /Length {len(content)} >>\nstream\n'.encode('utf-8') + content + b'\nendstream')
        content_ids.append(content_id)
        page_id = add(
            f'<< /Type /Page /Parent {pages_tree_id_placeholder} 0 R '
            f'/MediaBox [0 0 {PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] '
            f'/Resources << /Font << /F1 {font_id} 0 R >> >> '
            f'/Contents {content_id} 0 R >>'
        )
        page_ids.append(page_id)

    kids = ' '.join(f'{pid} 0 R' for pid in page_ids)
    pages_tree_id = add(f'<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>')
    catalog_id = add(f'<< /Type /Catalog /Pages {pages_tree_id} 0 R >>')

    # Rebuild page objects with correct parent id if placeholder moved.
    if pages_tree_id != pages_tree_id_placeholder:
        for i, (page_id, content_id) in enumerate(zip(page_ids, content_ids), start=1):
            objects[page_id - 1] = (
                f'<< /Type /Page /Parent {pages_tree_id} 0 R '
                f'/MediaBox [0 0 {PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] '
                f'/Resources << /Font << /F1 {font_id} 0 R >> >> '
                f'/Contents {content_id} 0 R >>'
            ).encode('utf-8')

    out = bytearray(b'%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f'{idx} 0 obj\n'.encode('utf-8'))
        out.extend(obj)
        out.extend(b'\nendobj\n')

    xref_start = len(out)
    out.extend(f'xref\n0 {len(objects)+1}\n'.encode('utf-8'))
    out.extend(b'0000000000 65535 f \n')
    for off in offsets[1:]:
        out.extend(f'{off:010d} 00000 n \n'.encode('utf-8'))
    out.extend(
        f'trailer\n<< /Size {len(objects)+1} /Root {catalog_id} 0 R >>\nstartxref\n{xref_start}\n%%EOF\n'.encode('utf-8')
    )
    path.write_bytes(out)


if __name__ == '__main__':
    tex = TEX_PATH.read_text(encoding='utf-8')
    blocks = extract_text(tex)
    extracted = '\n'.join(text if kind != 'blank' else '' for kind, text in blocks)
    TXT_PATH.write_text(extracted, encoding='utf-8')
    pages = build_pages(blocks)
    write_pdf(pages, PDF_PATH)
    print(f'Extracted blocks: {len(blocks)}')
    print(f'Generated pages: {len(pages)}')
    print(f'PDF written to: {PDF_PATH}')
