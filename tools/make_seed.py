#!/usr/bin/env python3
"""把 parse_papers.py 的 .parsed.json 汇总成 Supabase seed SQL。

用法: python3 tools/make_seed.py <parsed.json> [...] > supabase/seed.local.sql
"""
import json
import re
import sys
from pathlib import Path

CN = '零一二三四五六七八九十'


def cn_chapter(n):
    if n <= 10:
        return f'第{CN[n]}章'
    if n < 20:
        return f'第十{CN[n - 10]}章'
    tens, ones = divmod(n, 10)
    return f'第{CN[tens]}十{CN[ones] if ones else ""}章'


def paper_label(filename):
    m = re.search(r'《?基础\s*([1-4])》', filename)
    if m:
        return f'2025真题{m.group(1)}'
    if '100题' in filename:
        return '2026真题100'
    return Path(filename).stem[:20]


def sql_str(value):
    return "'" + str(value).replace("'", "''") + "'"


def main(paths):
    rows, seen = [], {}
    for path in paths:
        questions = json.loads(Path(path).read_text(encoding='utf-8'))
        label = paper_label(path)
        paper = re.search(r'基础\s*([1-4])', path)
        prefix = f'p{paper.group(1)}' if paper else 'x'
        for index, q in enumerate(questions, start=1):
            key = re.sub(r'\s+', '', q['stem'])[:60]
            if key in seen:
                continue
            seen[key] = q
            code = 's' if q['type'] == 'single' else 'm'
            number = int(q['number']) if str(q['number']).isdigit() else index
            qid = f'jjjc2026-{prefix}-{code}{number:02d}'
            rows.append((qid, label, q))

    print('-- 由 tools/make_seed.py 生成；不入库，只在本地粘贴到 Supabase SQL Editor。')
    print('insert into public.questions (id, bank_id, subject, source, chapter, point, type, stem, options, answer, analysis) values')
    values = []
    for qid, label, q in rows:
        chapter = cn_chapter(q['chapter']) if q.get('chapter') else None
        answer = json.dumps(q['answer'], ensure_ascii=False)
        values.append(
            '({}, {}, {}, {}, {}, {}, {}, {}, {}::jsonb, {}::jsonb, {})'.format(
                sql_str(qid), sql_str('jingji-jichu-2026'), sql_str('经济基础知识'),
                sql_str(label), 'null' if not chapter else sql_str(chapter), 'null',
                sql_str(q['type']), sql_str(q['stem']),
                sql_str(json.dumps(q['options'], ensure_ascii=False)),
                sql_str(answer), sql_str(q['analysis'] or ''),
            )
        )
    print(',\n'.join(values) + '\non conflict (id) do nothing;')
    print(f'-- 共 {len(rows)} 题', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
