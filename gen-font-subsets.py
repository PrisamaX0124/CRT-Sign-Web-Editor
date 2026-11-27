#!/usr/bin/env python3
"""
从原始 fonts/MiSans-*.ttf 生成 WOFF2 分片、fonts-subsets/manifest.js 与 fonts.css。

用法：
  uv run --with fonttools --with brotli python gen-font-subsets.py
  或已安装 fonttools + brotli 时直接运行：
  python gen-font-subsets.py
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
FONTS_DIR = ROOT / 'fonts'
OUT_DIR = ROOT / 'fonts-subsets'
CSS_PATH = ROOT / 'fonts.css'

MISANS_FACES = [
    {'source': 'MiSans-Regular.ttf', 'dir': 'MiSans-Regular', 'weight': 400},
    {'source': 'MiSans-Semibold.ttf', 'dir': 'MiSans-Semibold', 'weight': 600},
    {'source': 'MiSans-Bold.ttf', 'dir': 'MiSans-Bold', 'weight': 700},
]

FRUTIGER_CSS = """@font-face {
  font-family: 'Frutiger';
  src: url('fonts/Frutiger-Regular.ttf') format('truetype');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Frutiger';
  src: url('fonts/Frutiger-Bold.ttf') format('truetype');
  font-weight: 700; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Frutiger Condensed';
  src: url('fonts/FrutigerCondensed-Regular.ttf') format('truetype');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Frutiger Condensed';
  src: url('fonts/FrutigerCondensed-Bold.ttf') format('truetype');
  font-weight: 700; font-style: normal; font-display: swap;
}
"""

# 首屏高频字：轨道交通导向、站台、换乘高频词及常见城市站名用字，确保默认牌面与常见站名一次命中。
CORE_TRANSIT_CHARS = (
    '一二三四五六七八九十零百千万两第号线路段支快慢环干联接'
    '站台厅层楼面口出入口进出换乘转搭乘坐开往前往方向终点始发本站下上左右前后中内外南北东西'
    '地铁轻轨单轨市域城际高铁铁路火车客运机场航站港口码头客渡直升停泊公交巴士租车出租网约'
    '人民中心广场公园大街道路巷弄胡同桥门河湖海江湾岛山岭峰坡坪坝沟冲塘溪洲滩渡水库池泉'
    '上海重庆成都北京天津广州深圳南京杭州武汉西安苏州郑州长沙青岛沈阳大连厦门福州合肥昆明'
    '虹桥浦东浦西徐家汇陆家嘴静安寺南京东路南京西路世纪大道龙阳路中山公园莘庄张江高科'
    '嘉闵南汇示范区南枫奉贤浦江机场线八通大兴昌平房山燕房西郊亦庄碧桐蓉新都金堂空港资阳'
    '龙泉驿淮州眉山仁寿新津蒲江安仁温江都江堰广汉德阳罗江成华旌阳天府简阳青神东南'
    '解放碑较场口观音桥沙坪坝两路口牛角沱红旗河沟曾家岩李子坝小什字朝天门菜园坝重庆北重庆西'
    '春熙路天府广场骡马市火车北火车南火车东犀浦双流龙泉温江郫都新津简阳华阳金融城'
    '王府井西单东单国贸复兴门建国门前门天安门崇文门宣武门朝阳门阜成门德胜门安定门雍和宫'
    '列车行驶停靠候车检票售票安检闸机服务咨询失物招领卫生间洗手间母婴室无障碍电梯扶梯楼梯'
    '通道连廊过街地下室地上商业办公住宅社区学校大学学院中学小学医院中心院馆博物图书科技文化'
    '艺术体育会展博览国际世界金融贸易软件产业创新园科创高新经济开发保税物流枢纽综合'
    '城区镇村庄屯营堡关寺庙观宫殿塔亭阁府苑林花园草木松柏梅兰竹菊桃柳桂荷莲银杏枫'
    '金银铜铁玉石砂土红黄蓝绿青紫白黑灰彩阳光明亮华兴旺安康平和顺福寿禄喜乐美好永长久远'
    '高低深浅宽广宏伟盛昌隆达通泰宁静清泉溪江淮汉湘赣闽粤桂川渝滇黔陕甘晋冀鲁豫辽吉苏浙皖鄂'
    '请勿注意安全小心站隙台阶自动人工优先排队文明礼让禁止吸烟饮食携带危险品紧急求助报警'
    '首班末班全程区间大站快车普通直达环行内环外环上行下行左门右门开闭提示信息标识导向'
    '未命名新建编辑项目预设副本测试示例默认样式颜色背景灰框底纹双语英文中文数字编号文字'
    '总站副站东站西站南站北站中站老城新城老街新街古镇古街步行街商圈中心城大学城科学城'
    '机场东机场西航站楼客运站汽车站长途站游船渡口索道缆车观光旅游景区风景名胜遗址纪念'
    '国展世博奥体奥林匹克工人体育场体育馆游泳馆音乐厅大剧院美术馆展览馆科技馆动物园植物园'
    '湿地森林滨江沿江滨海临港自贸保税物流园工业园软件园创意园创业园总部基地商务区'
    '十字街三岔口五里店六公里七星岗八公里九公里十里铺百花潭千厮门万象城双桥三桥四桥五桥'
    '杨浦虹口黄浦静安徐汇长宁普陀闵行宝山嘉定金山松江青浦奉贤崇明渝中江北南岸九龙坡大渡口'
    '渝北巴南北碚两江锦江青羊金牛武侯成华龙泉驿青白江新都温江双流郫都新津朝阳海淀丰台石景山'
    '通州顺义昌平大兴房山门头沟怀柔平谷密云延庆东城西城'
)


def format_unicode_range(codepoints: list[int]) -> str:
    ordered = sorted(set(codepoints))
    if not ordered:
        return ''
    ranges: list[str] = []
    start = end = ordered[0]
    for cp in ordered[1:]:
        if cp == end + 1:
            end = cp
        else:
            ranges.append(f'U+{start:X}' if start == end else f'U+{start:X}-{end:X}')
            start = end = cp
    ranges.append(f'U+{start:X}' if start == end else f'U+{start:X}-{end:X}')
    return ','.join(ranges)


def build_buckets(available: set[int]) -> list[list[int]]:
    assigned: set[int] = set()

    def take(candidates: list[int]) -> list[int]:
        picked: list[int] = []
        for cp in candidates:
            if cp in available and cp not in assigned:
                assigned.add(cp)
                picked.append(cp)
        return picked

    # 分片 00：ASCII + 常用标点 + 轨道交通核心高频字（控制在极小首屏体积）
    core_candidates: list[int] = []
    core_candidates.extend(range(0x0020, 0x007F))
    core_candidates.extend(ord(ch) for ch in '·×—–…（）《》「」【】、，。：；？！～')
    core_candidates.extend(ord(ch) for ch in CORE_TRANSIT_CHARS)

    buckets: list[list[int]] = []
    core = sorted(take(core_candidates))
    if core:
        buckets.append(core)

    # 其余所有码点按升序切分：每个分片保持连续区间，让阻塞渲染的 fonts.css 保持极小体积。
    remaining = sorted(available - assigned)
    for i in range(0, len(remaining), 400):
        buckets.append(remaining[i:i + 400])

    return buckets


def subset_worker(task: tuple[str, str, list[int]]) -> tuple[str, int]:
    source_path, target_path, codepoints = task
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.hinting = True
    options.legacy_kern = True
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.drop_tables = ['DSIG']

    font = TTFont(source_path, lazy=True)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    # 必须显式设置 flavor='woff2'，否则 TTFont.save 会写出未压缩的 TTF。
    font.flavor = 'woff2'
    font.save(target_path)
    font.close()
    return target_path, os.path.getsize(target_path)


def main() -> int:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    cmaps: dict[str, set[int]] = {}
    for face in MISANS_FACES:
        src = FONTS_DIR / face['source']
        with TTFont(src, lazy=True) as font:
            cmaps[face['source']] = set(font.getBestCmap().keys())

    first_cmap = cmaps[MISANS_FACES[0]['source']]
    shared = all(cmap == first_cmap for cmap in cmaps.values())

    face_buckets: dict[str, list[list[int]]] = {}
    if shared:
        common = build_buckets(first_cmap)
        for face in MISANS_FACES:
            face_buckets[face['source']] = common
    else:
        for face in MISANS_FACES:
            face_buckets[face['source']] = build_buckets(cmaps[face['source']])

    tasks: list[tuple[str, str, list[int]]] = []
    for face in MISANS_FACES:
        target_dir = OUT_DIR / face['dir']
        target_dir.mkdir(parents=True, exist_ok=True)
        src = str(FONTS_DIR / face['source'])
        for idx, codepoints in enumerate(face_buckets[face['source']]):
            out_file = target_dir / f'{idx:02d}.woff2'
            tasks.append((src, str(out_file), codepoints))

    workers = max(1, min(os.cpu_count() or 4, 8))
    print(f'开始生成 {len(tasks)} 个 WOFF2 分片（{workers} 进程并行）...')
    sizes: dict[str, int] = {}
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
        for path, size in pool.map(subset_worker, tasks):
            sizes[path] = size

    hasher = hashlib.sha256()
    for face in MISANS_FACES:
        src = FONTS_DIR / face['source']
        hasher.update(face['source'].encode('utf-8'))
        hasher.update(str(src.stat().st_size).encode('utf-8'))
    version = 'misans-woff2-' + hasher.hexdigest()[:10]

    manifest_families: dict[str, dict] = {}
    css_lines = [
        '/* 由 gen-font-subsets.py 生成，请勿手工编辑；源字体保持 fonts/ 原文件。 */',
    ]

    for face in MISANS_FACES:
        buckets = face_buckets[face['source']]
        base_path = f"fonts-subsets/{face['dir']}/"
        total_bytes = 0
        chunk_entries = []
        for idx, codepoints in enumerate(buckets):
            filename = f'{idx:02d}.woff2'
            urange = format_unicode_range(codepoints)
            file_path = str(OUT_DIR / face['dir'] / filename)
            size = sizes[file_path]
            total_bytes += size
            chunk_entries.append({'file': filename, 'unicodeRange': urange})
            css_lines.append(
                f"@font-face {{ font-family: 'MiSans'; src: url('{base_path}{filename}') format('woff2'); "
                f"font-weight: {face['weight']}; font-style: normal; font-display: swap; unicode-range: {urange}; }}"
            )
        core_kb = sizes[str(OUT_DIR / face['dir'] / '00.woff2')] / 1024
        max_kb = max(sizes[str(OUT_DIR / face['dir'] / f'{i:02d}.woff2')] for i in range(len(buckets))) / 1024
        print(
            f"{face['source']}: {len(buckets)} 片, 首屏核心包 {core_kb:.1f} KB, "
            f"最大单片 {max_kb:.1f} KB, 合计 {total_bytes / (1024 * 1024):.2f} MB"
        )
        entry = {
            'family': 'MiSans',
            'weight': face['weight'],
            'basePath': base_path,
            'format': 'woff2',
            'mime': 'font/woff2',
        }
        if not shared:
            entry['chunks'] = chunk_entries
        manifest_families[face['source']] = entry

    css_lines.append('')
    css_lines.append(FRUTIGER_CSS.strip())
    CSS_PATH.write_text('\n'.join(css_lines) + '\n', encoding='utf-8')

    manifest = {
        'version': version,
        'sharedChunks': [
            {'file': f'{idx:02d}.woff2', 'unicodeRange': format_unicode_range(codepoints)}
            for idx, codepoints in enumerate(face_buckets[MISANS_FACES[0]['source']])
        ] if shared else None,
        'families': manifest_families,
    }
    manifest_js = (
        '// 由 gen-font-subsets.py 生成，请勿手工编辑。\n'
        '(function (global) {\n'
        '  \'use strict\';\n'
        '  global.SignFontManifest = ' + json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + ';\n'
        '})(typeof window !== \'undefined\' ? window : globalThis);\n'
    )
    manifest_path = OUT_DIR / 'manifest.js'
    manifest_path.write_text(manifest_js, encoding='utf-8')
    print(f'已生成 {manifest_path.relative_to(ROOT)} ({manifest_path.stat().st_size / 1024:.1f} KB)')
    print(f'已更新 {CSS_PATH.relative_to(ROOT)} ({CSS_PATH.stat().st_size / 1024:.1f} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
