#!/usr/bin/env python3
"""把官方/机构真题 PDF 解析成 questions JSON。

支持两种版式：
  A) 「N.stem【1 分】」+「答案：X」+「解析：…来源于第N章」   （2025 真题套卷）
  B) 「【单选题-题号 N】」+「【参考答案】X」+「【考点来源】第N章」 （历年真题 100 题）

用法: python3 tools/parse_papers.py <pdf> [...]
输出: <name>.json 与校验报告（不通过则退出码 1）。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

NOISE = re.compile(
    r'^(?:-?\d+-|http://ekaoshi\.mulupan\.cn/?|官方网站[:：].*|'
    r'初级、中级、注会、税务师.*|学员专用 请勿外泄|环球网校学员专用|'
    r'.*更多精品资料.*)$'
)
PAGE_TAIL = re.compile(r'\s*-\s*\d{1,3}\s*-(?:\s*-\s*\d{1,3}\s*-)?\s*$')
PAGE_MARK = re.compile(r'\s*-\s+\d{1,3}\s*-')


def strip_pages(text):
    """去掉 PDF 分页符串进正文的 “- 51 -- 52 -”。"""
    for _ in range(3):
        cleaned = PAGE_MARK.sub('', text)
        if cleaned == text:
            break
        text = cleaned
    return PAGE_TAIL.sub('', text).strip()
CN_NUM = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
CHAPTER = re.compile(r'第\s*([0-9]+|[一二三四五六七八九十]+)\s*章')


def chapter_of(text):
    m = CHAPTER.search(text or '')
    if not m:
        return None
    raw = m.group(1)
    if raw.isdigit():
        return int(raw)
    if raw == '十':
        return 10
    if raw.startswith('十'):
        return 10 + CN_NUM.get(raw[1], 0)
    if raw.endswith('十'):
        return CN_NUM.get(raw[0], 0) * 10
    if '十' in raw:
        a, b = raw.split('十')
        return CN_NUM.get(a, 0) * 10 + CN_NUM.get(b, 0)
    return CN_NUM.get(raw)


def clean_pages(text):
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if not s or NOISE.match(s):
            continue
        lines.append(s)
    return lines


def flush(chunk, section_type='single'):
    """把一个题块解析为 dict；失败返回 (None, reason)。"""
    if not chunk:
        return None, 'empty'
    head, body = chunk[0], chunk[1:]
    m = re.match(r'^(?:【例题\s*\d+[:：](单选|多选)题】|【(单选|多选)题-题号\s*(\d+)】|(\d+)\.)', head)
    if not m:
        return None, f'unrecognized head: {head[:40]}'
    kind = m.group(1) or m.group(2)
    number = m.group(3) or m.group(4)
    qtype = 'multiple' if kind == '多选' else 'single' if kind == '单选' else section_type
    joined = ''.join(chunk)
    if '【1 分】' in joined:
        qtype = 'single'
    elif '【2 分】' in joined:
        qtype = 'multiple'

    stem_parts, options, answer, analysis = [], [], [], []
    mode = 'stem'
    for line in [head] + body:
        if mode == 'stem':
            om = re.match(r'^([A-E])[.．、]\s*(.*)$', line)
            if om:
                options.append({'key': om.group(1), 'text': om.group(2).strip()})
                mode = 'options'
                continue
            am = re.match(r'^【?(?:参考答案|答案)】?[:：]?\s*([A-E]+)\s*$', line)
            if am:
                answer.append(am.group(1))
                mode = 'answer'
                continue
            dm = re.match(r'^【?(?:环球网校解析|解析)】?[:：]?\s*(.*)$', line)
            if dm:
                analysis.append(dm.group(1))
                mode = 'analysis'
                continue
            stem_parts.append(line)
        elif mode == 'options':
            om = re.match(r'^([A-E])[.．、]\s*(.*)$', line)
            if om:
                options.append({'key': om.group(1), 'text': om.group(2).strip()})
                continue
            am = re.match(r'^【?(?:参考答案|答案)】?[:：]?\s*([A-E]+)\s*$', line)
            if am:
                answer.append(am.group(1))
                mode = 'answer'
                continue
            # 选项换行续行
            if options:
                options[-1]['text'] += line
        elif mode == 'answer':
            dm = re.match(r'^【?(?:环球网校解析|解析)】?[:：]?\s*(.*)$', line)
            if dm:
                analysis.append(dm.group(1))
                mode = 'analysis'
            continue
        else:
            cm = re.match(r'^【考点来源】(.*)$', line)
            if cm:
                analysis.append(f'（考点：{cm.group(1).strip()}）')
                continue
            analysis.append(line)

    stem = ''.join(stem_parts)
    stem = re.sub(r'【\d\s*分】$', '', stem).strip()
    stem = re.sub(r'^【例题\s*\d+[:：][^】]*】', '', stem).strip()
    stem = re.sub(r'^【[^】]*题-题号\s*\d+】', '', stem).strip()
    stem = re.sub(r'^\d+\.\s*', '', stem).strip()

    problems = []
    if not stem or len(stem) < 6:
        problems.append('stem too short')
    keys = [o['key'] for o in options]
    if keys != [chr(ord('A') + i) for i in range(len(keys))] or len(keys) < 4:
        problems.append(f'options not A..{len(keys)}: {keys}')
    letters = ''.join(answer)
    if not letters:
        problems.append('no answer')
    else:
        if qtype == 'single' and len(letters) != 1:
            problems.append(f'single has {len(letters)} answers: {letters}')
        if qtype == 'multiple' and len(letters) < 2:
            problems.append(f'multiple has 1 answer: {letters}')
        if any(ch not in keys for ch in letters):
            problems.append(f'answer {letters} not in options {keys}')
    if problems:
        return None, '; '.join(problems)

    text = strip_pages(''.join(analysis))
    return {
        'number': number,
        'type': qtype,
        'stem': strip_pages(stem),
        'options': [{'key': o['key'], 'text': strip_pages(o['text'])} for o in options],
        'answer': sorted(letters),
        'analysis': text,
        'chapter': chapter_of(text) or chapter_of(stem),
    }, None


def parse(lines):
    SECTION = re.compile(r'^[一二三四五]\.(单选|多选)题')
    chunks, cur, section_type = [], [], 'single'
    for line in lines:
        sm = SECTION.match(line)
        if sm:
            section_type = 'multiple' if sm.group(1) == '多选' else 'single'
        is_head = bool(re.match(r'^(?:【例题\s*\d+[:：][单多]选题】|【[单多]选题-题号\s*\d+】|\d+\.)', line))
        has_stem_marker = bool(re.search(r'【\d\s*分】$', line))
        if is_head and cur and (has_stem_marker or len(cur) > 1 or re.match(r'^【', line)):
            chunks.append((section_type, cur))
            cur = []
        cur.append(line)
    if cur:
        chunks.append((section_type, cur))

    questions, rejected = [], []
    for section, chunk in chunks:
        item, reason = flush(chunk, section)
        if item:
            questions.append(item)
        elif questions and 'options not A' in reason and '答案' not in ''.join(chunk):
            # 解析里的编号列表被误切，合并回上一题的解析
            questions[-1]['analysis'] += strip_pages(''.join(chunk))
        elif chunk and not re.match(r'^(?:【考点概览】|第\s*[0-9一二三四五六七八九十]+\s*章)', chunk[0]):
            rejected.append((chunk[0][:60], reason))
    return questions, rejected


def main(paths):
    total, all_rejected = 0, []
    for path in paths:
        pdf = Path(path)
        text = subprocess.run(['pdftotext', str(pdf), '-'], capture_output=True, text=True, check=True).stdout
        questions, rejected = parse(clean_pages(text))
        out = pdf.with_suffix('.parsed.json')
        out.write_text(json.dumps(questions, ensure_ascii=False, indent=1), encoding='utf-8')
        singles = sum(1 for q in questions if q['type'] == 'single')
        multis = len(questions) - singles
        no_chapter = sum(1 for q in questions if not q['chapter'])
        no_analysis = sum(1 for q in questions if not q['analysis'])
        print(f'{pdf.name}: {len(questions)} 题（单选 {singles} / 多选 {multis}）'
              f' 无章节 {no_chapter} 无解析 {no_analysis} → {out.name}')
        all_rejected += [(pdf.name, *r) for r in rejected]
        total += len(questions)

    if all_rejected:
        print(f'\n跳过 {len(all_rejected)} 块:')
        for name, head, reason in all_rejected[:12]:
            print(f'  [{name}] {head} → {reason}')
    print(f'\n合计 {total} 题')
    return 0 if total else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
