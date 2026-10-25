import { createClient } from '@supabase/supabase-js'
import { supabaseAnonKey, supabaseUrl } from './config.js'
import './style.css'

const supabase = createClient(supabaseUrl, supabaseAnonKey)
const app = document.querySelector('#app')
const bankId = 'jingji-jichu-2026'
const AUTH_DOMAIN = '@jingjishi.local'
const subjectName = '经济基础知识'
const modeNames = { chapter: '章节练习', topic: '专题练习', mixed: '混合练习', mock: '模拟考试', 'past-paper': '真题训练' }
const emptyOverview = { questionCount: 0, chapters: [], papers: [], days: [], recent: null }

let user = null
let subject = subjectName
let mode = ''
let selectedChapter = ''
let selectedPaper = ''
let overview = emptyOverview
let questions = []
let sessionState = null
let currentIndex = 0
let multiDraft = new Set()
let busy = false
let view = 'practice'
let sheetOpen = false
let subjectsOpen = false
let wrongItems = []
let wrongChapter = ''
let wrongReplay = null

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function emailFor(username) {
  const value = username.trim().toLowerCase()
  return value.includes('@') ? value : `${value}${AUTH_DOMAIN}`
}

function displayName() {
  const email = user?.email || ''
  return email.endsWith(AUTH_DOMAIN) ? email.slice(0, -AUTH_DOMAIN.length) : email
}

function rate(correct, total) {
  return total ? `${Math.round(correct / total * 100)}%` : '—'
}

function dayKey(date) {
  const local = new Date(date)
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
}

function last14Days() {
  const days = []
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    days.push({ key: dayKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, count: 0, correct: 0 })
  }
  return days
}

function renderAuth(message = '', username = '') {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="auth-title">
        <p class="eyebrow">2026 · 中级经济师</p>
        <h1 id="auth-title">把今天的练习，变成考试时的底气。</h1>
        <p class="auth-copy">用用户名登录即可；暂时不想改账号的，直接填原来的完整邮箱也能登录。界面不开放注册。</p>
        <form id="auth-form">
          <label for="username">用户名</label>
          <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escapeHtml(username)}" required />          <label for="password">密码</label>
          <input id="password" name="password" type="password" autocomplete="current-password" minlength="8" required />
          <button class="button primary wide" type="submit" ${busy ? 'disabled' : ''}>${busy ? '请稍候…' : '登录'}</button>
        </form>
        <p class="message" data-message role="status">${escapeHtml(message)}</p>
      </section>
      <p class="auth-footnote">你的个人记录仅对当前登录账号可见。</p>
    </main>`
}

function renderTabs() {
  const tabs = [['practice', '练习'], ['wrong', '错题'], ['stats', '学习记录']]
  return `<nav class="tabbar" aria-label="主导航">${tabs.map(([id, label]) => `<button class="tab${id === view ? ' active' : ''}" type="button" data-action="tab" data-tab="${id}"${id === view ? ' aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`
}

function renderTopbar(backAction = '', backLabel = '') {
  return `<header class="topbar">
    <div class="topbar-left">
      <button class="subject-switch" type="button" data-action="toggle-subjects" aria-expanded="${subjectsOpen}" aria-haspopup="menu">
        ${escapeHtml(subject)}<span aria-hidden="true">▾</span>
      </button>
      ${subjectsOpen ? `<div class="subject-menu" role="menu">
        <button class="subject-item active" type="button" role="menuitem" data-action="pick-subject" data-subject="${escapeHtml(subjectName)}">${escapeHtml(subjectName)}</button>
        <button class="subject-item" type="button" role="menuitem" disabled>工商管理专业知识和实务 · 待导入</button>
      </div>` : ''}
    </div>
    <div class="topbar-right">
      ${backAction ? `<button class="text-button" type="button" data-action="${backAction}">${escapeHtml(backLabel)}</button>` : ''}
      <span class="user-name">${escapeHtml(displayName())}</span>
      <button class="text-button" type="button" data-action="signout">退出</button>
    </div>
  </header>
  ${renderTabs()}`
}

function renderProblem(title, detail) {
  app.innerHTML = `
    <main class="page-shell">
      <section class="problem-card">
        <p class="eyebrow">暂不可用</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(detail)}</p>
        <button class="button secondary" type="button" data-action="reload">重新加载</button>
      </section>
    </main>`
}

async function saveSession() {
  const row = {
    ...sessionState,
    user_id: user.id,
    subject,
    mode,
    scope: sessionScope(),
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('practice_sessions')
    .upsert(row, { onConflict: 'user_id,subject,mode,scope' })
  if (error) throw error
  sessionState = row
}

function sessionScope() {
  if (wrongReplay) return 'wrong'
  if (mode === 'chapter') return selectedChapter
  if (mode === 'topic') return selectedPaper
  return ''
}

async function loadOverview() {
  overview = emptyOverview
  const { data: questionMeta, error } = await supabase
    .from('questions')
    .select('id, chapter, source')
    .eq('bank_id', bankId)
    .order('id')

  if (error) {
    renderProblem('题库还没连接好', '请检查 Supabase 登录和 questions 表的读取策略。')
    return false
  }

  const chapters = new Map()
  const papers = new Map()
  for (const question of questionMeta || []) {
    if (question.chapter) {
      const chapter = chapters.get(question.chapter) || { name: question.chapter, count: 0, practiced: 0, correct: 0 }
      chapter.count += 1
      chapters.set(question.chapter, chapter)
    }
    if (question.source) {
      const paper = papers.get(question.source) || { name: question.source, count: 0, practiced: 0, correct: 0 }
      paper.count += 1
      papers.set(question.source, paper)
    }
  }

  const days = last14Days()
  const byDay = new Map(days.map((day) => [day.key, day]))
  const latest = new Map()

  if (questionMeta?.length) {
    const { data: attempts, error: attemptError } = await supabase
      .from('practice_attempts')
      .select('question_id, is_correct, answered_at')
      .eq('subject', subjectName)
    if (attemptError) {
      renderProblem('无法读取练习进度', '请检查 Supabase 的作答记录读取策略。')
      return false
    }
    for (const attempt of attempts || []) {
      const previous = latest.get(attempt.question_id)
      if (!previous || new Date(attempt.answered_at) > new Date(previous.answered_at)) latest.set(attempt.question_id, attempt)
      const day = byDay.get(dayKey(attempt.answered_at))
      if (day) {
        day.count += 1
        if (attempt.is_correct) day.correct += 1
      }
    }
  }

  const metaById = new Map((questionMeta || []).map((question) => [question.id, question]))
  for (const [questionId, attempt] of latest) {
    const question = metaById.get(questionId)
    if (!question) continue
    const chapter = chapters.get(question.chapter)
    if (chapter) {
      chapter.practiced += 1
      if (attempt.is_correct) chapter.correct += 1
    }
    const paper = papers.get(question.source)
    if (paper) {
      paper.practiced += 1
      if (attempt.is_correct) paper.correct += 1
    }
  }

  const { data: recent, error: recentError } = await supabase
    .from('practice_sessions')
    .select('subject, mode, scope, current_index, question_ids, updated_at')
    .eq('completed', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recentError) {
    renderProblem('无法读取续练进度', '请确认已重新运行 supabase/setup.sql。')
    return false
  }

  overview = {
    questionCount: questionMeta?.length || 0,
    chapters: [...chapters.values()],
    papers: [...papers.values()].filter((paper) => paper.count > 1),
    days,
    recent: recent || null,
  }
  return true
}

function renderTodayCard() {
  const days = overview.days
  if (!days.length) return ''
  const today = days[days.length - 1]
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const totalCorrect = days.reduce((sum, day) => sum + day.correct, 0)
  const peak = Math.max(1, ...days.map((day) => day.count))
  return `<section class="today-card" aria-label="学习进度">
    <div class="today-head">
      <div><strong>${today.count}</strong><span>今天作答</span></div>
      <div><strong>${rate(today.correct, today.count)}</strong><span>今天正确率</span></div>
      <div><strong>${rate(totalCorrect, total)}</strong><span>近 14 天正确率</span></div>
    </div>
    <div class="mini-chart" role="img" aria-label="近 14 天每日题量">${days.map((day, index) => `<i class="${index === days.length - 1 ? 'today' : ''}" style="height:${Math.max(3, Math.round(day.count / peak * 100))}%" title="${day.label}：${day.count} 题"></i>`).join('')}</div>
    <div class="mini-legend"><span>14 天前</span><span>今天 · ${today.count} 题</span></div>
  </section>`
}

function renderResumeCard() {
  const recent = overview.recent
  if (!recent) return ''
  const done = Math.min((recent.current_index || 0) + 1, recent.question_ids?.length || 0)
  const label = recent.mode === 'chapter' ? recent.scope : recent.mode === 'topic' ? recent.scope : recent.scope === 'wrong' ? '错题重练' : '跨章节'
  return `<button class="resume-card" type="button" data-action="resume">
    <span><small>继续上次</small><strong>${escapeHtml(modeNames[recent.mode] || '练习')} · ${escapeHtml(label)}</strong></span>
    <span class="choice-status">${done}/${recent.question_ids?.length || 0}</span>
  </button>`
}

async function loadHome() {
  view = 'practice'
  mode = ''
  selectedChapter = ''
  selectedPaper = ''
  wrongReplay = null
  sheetOpen = false
  subjectsOpen = false
  app.innerHTML = '<main class="page-shell"><div class="loading-card" role="status">正在读取题库…</div></main>'
  if (!(await loadOverview())) return
  renderHome()
}

function renderHome() {
  const mixedReady = overview.questionCount > 1 && overview.chapters.length > 1
  const topicReady = overview.papers.length > 0
  const modes = [
    { id: 'chapter', name: modeNames.chapter, detail: '按教材章节练习，逐题查看答案与解析。', enabled: overview.questionCount > 0, status: `${overview.chapters.length} 个章节` },
    { id: 'topic', name: modeNames.topic, detail: '按导入的每份试卷成套练习，逐题反馈。', enabled: topicReady, status: topicReady ? `${overview.papers.length} 套` : '题库尚未导入' },
    { id: 'mixed', name: modeNames.mixed, detail: '跨章节、不计时，逐题反馈。', enabled: mixedReady, status: mixedReady ? '全部题目' : '题目不足' },
    { id: 'mock', name: modeNames.mock, detail: '限时组卷，交卷后查看成绩与解析。', enabled: false, status: '组卷规则尚未核实' },
    { id: 'past-paper', name: modeNames['past-paper'], detail: '按年份完成完整真题试卷。', enabled: false, status: '尚未导入完整试卷' },
  ]
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      <main class="selection-shell">
        ${renderTodayCard()}
        ${renderResumeCard()}
        <h1 tabindex="-1">选择练习方式</h1>
        <div class="choice-list">
          ${modes.map((item) => `<button class="choice-card mode-card${item.enabled ? '' : ' unavailable'}" type="button" data-action="mode" data-mode="${item.id}" ${item.enabled ? '' : 'disabled'}>
            <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span>
            <span class="choice-status">${escapeHtml(item.status)}</span>
          </button>`).join('')}
        </div>
        <p class="source-note">共 ${overview.questionCount} 道题。模拟考试和真题训练在组卷规则核实前不可用。</p>
      </main>
    </div>`
  app.querySelector('h1')?.focus()
}

function renderChapters() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar('modes', '返回练习方式')}
      <main class="selection-shell">
        <p class="eyebrow">${escapeHtml(subject)} · 章节练习</p>
        <h1 tabindex="-1">选择章节</h1>
        <p class="selection-copy">正确率按每道题最近一次作答计算；再次进入同一章节会恢复最近一次未完成进度。</p>
        <div class="choice-list">
          ${overview.chapters.map((chapter) => `<button class="choice-card" type="button" data-action="chapter" data-chapter="${escapeHtml(chapter.name)}">
            <span><strong>${escapeHtml(chapter.name)}</strong><small>${chapter.count} 道题 · 已练 ${chapter.practiced}/${chapter.count} · 正确率 ${rate(chapter.correct, chapter.practiced)}</small></span>
            <span class="progress-track"><i style="width:${Math.round(chapter.practiced / chapter.count * 100)}%"></i></span>
          </button>`).join('')}
        </div>
      </main>
    </div>`
  app.querySelector('h1')?.focus()
}

function renderPapers() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar('modes', '返回练习方式')}
      <main class="selection-shell">
        <p class="eyebrow">${escapeHtml(subject)} · 专题练习</p>
        <h1 tabindex="-1">选择一套题</h1>
        <p class="selection-copy">每份导入的试卷为一套，按原卷顺序逐题练习；再次进入同一套会恢复最近一次未完成进度。</p>
        <div class="choice-list">
          ${overview.papers.map((paper) => `<button class="choice-card" type="button" data-action="paper" data-paper="${escapeHtml(paper.name)}">
            <span><strong>${escapeHtml(paper.name)}</strong><small>${paper.count} 道题 · 已练 ${paper.practiced}/${paper.count} · 正确率 ${rate(paper.correct, paper.practiced)}</small></span>
            <span class="progress-track"><i style="width:${Math.round(paper.practiced / paper.count * 100)}%"></i></span>
          </button>`).join('')}
        </div>
      </main>
    </div>`
  app.querySelector('h1')?.focus()
}

async function loadPractice() {
  view = 'practice'
  sheetOpen = false
  subjectsOpen = false
  app.innerHTML = '<main class="page-shell"><div class="loading-card" role="status">正在连接题库…</div></main>'
  let query = supabase
    .from('questions')
    .select('id, stem, options, answer, analysis, chapter, point, type')
    .eq('bank_id', bankId)
  if (mode === 'chapter') query = query.eq('chapter', selectedChapter)
  if (mode === 'topic') query = query.eq('source', selectedPaper)
  const { data: bankQuestions, error: bankError } = await query.order('id')

  if (bankError) {
    renderProblem('题库还没连接好', '请检查 Supabase 登录和 questions 表的读取策略。')
    return
  }
  const pool = wrongReplay ? (bankQuestions || []).filter((question) => wrongReplay.has(question.id)) : (bankQuestions || [])
  if (!pool.length) {
    renderProblem('当前筛选下没有题目', '请选择其他章节，或等待该章节题库导入。')
    return
  }

  const { data: saved, error: sessionError } = await supabase
    .from('practice_sessions')
    .select('*')
    .eq('subject', subject)
    .eq('mode', mode)
    .eq('scope', sessionScope())
    .maybeSingle()

  if (sessionError) {
    renderProblem('无法读取练习进度', '请确认已运行 supabase/setup.sql 后再试。')
    return
  }

  const byId = new Map((bankQuestions || []).map((question) => [question.id, question]))
  const ids = saved?.question_ids?.filter((id) => byId.has(id))
  const resume = Boolean(saved && !saved.completed && ids?.length)
  questions = resume ? ids.map((id) => byId.get(id)) : pool
  sessionState = resume
    ? { ...saved, question_ids: questions.map((question) => question.id), answers: saved.answers || {} }
    : {
        user_id: user.id,
        session_id: crypto.randomUUID(),
        subject,
        mode,
        question_ids: questions.map((question) => question.id),
        current_index: 0,
        answers: {},
        completed: false,
      }
  currentIndex = Math.min(sessionState.current_index || 0, questions.length - 1)
  sessionState.current_index = currentIndex
  multiDraft = new Set()

  try {
    await saveSession()
    renderQuestion(true)
  } catch {
    renderProblem('无法保存练习进度', '请确认 Supabase 的练习进度 RLS 策略已安装。')
  }
}

function contextLabel() {
  if (wrongReplay) return '错题重练'
  if (mode === 'topic') return selectedPaper
  if (mode === 'chapter') return selectedChapter
  return '跨章节'
}

function renderAnswerSheet() {
  const answered = questions.filter((question) => sessionState.answers[question.id]).length
  return `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <section class="sheet" role="dialog" aria-label="答题卡" aria-modal="true">
      <header class="sheet-head">
        <strong>答题卡 · 已答 ${answered}/${questions.length}</strong>
        <button class="text-button" type="button" data-action="close-sheet">关闭</button>
      </header>
      <div class="sheet-grid">
        ${questions.map((question, index) => {
          const answer = sessionState.answers[question.id]
          const state = answer ? (answer.correct ? 'ok' : 'bad') : 'idle'
          return `<button class="sheet-cell ${state}${index === currentIndex ? ' current' : ''}" type="button" data-action="jump" data-index="${index}">${index + 1}</button>`
        }).join('')}
      </div>
      <p class="sheet-legend"><span class="dot ok"></span>答对 <span class="dot bad"></span>答错 <span class="dot idle"></span>未答</p>
    </section>`
}

function renderQuestion(focusHeading = false) {
  const question = questions[currentIndex]
  const savedAnswer = sessionState.answers[question.id]
  const selected = savedAnswer ? new Set(Array.isArray(savedAnswer.selected) ? savedAnswer.selected : [savedAnswer.selected]) : multiDraft
  const options = (question.options || []).map((option) => {
    const key = String(option.key)
    const isSelected = selected.has(key)
    const correctKeys = Array.isArray(question.answer) ? question.answer.map(String) : [String(question.answer)]
    const stateClass = savedAnswer
      ? correctKeys.includes(key) ? ' correct' : isSelected ? ' incorrect' : ''
      : isSelected ? ' selected' : ''
    return `<button class="option${stateClass}" type="button" data-action="option" data-key="${escapeHtml(key)}" ${savedAnswer || busy ? 'disabled' : ''}>
      <span class="option-key">${escapeHtml(key)}</span><span>${escapeHtml(option.text)}</span>
    </button>`
  }).join('')

  const feedback = savedAnswer
    ? `<section class="feedback ${savedAnswer.correct ? 'is-correct' : 'is-wrong'}" aria-live="polite">
        <strong>${savedAnswer.correct ? '回答正确' : '再记一下'}</strong>
        <p>参考答案：${escapeHtml(Array.isArray(question.answer) ? question.answer.join('、') : question.answer)}</p>
        <p>${escapeHtml(question.analysis)}</p>
      </section>`
    : question.type === 'multiple'
      ? '<button class="button primary" type="button" data-action="submit-multiple" disabled>提交答案</button>'
      : '<p class="answer-hint">选择一个选项后立即查看解析</p>'

  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar('modes', '更换练习方式')}
      <main class="practice-shell">
        <div class="page-heading">
          <div><p class="eyebrow">${escapeHtml(subject)} · ${escapeHtml(contextLabel())}</p><h1 tabindex="-1">${escapeHtml(wrongReplay ? '错题重练' : modeNames[mode])}</h1></div>
          <div class="heading-actions">
            <span class="progress-pill">${currentIndex + 1} / ${questions.length}</span>
            <button class="sheet-button" type="button" data-action="sheet" aria-expanded="${sheetOpen}">答题卡</button>
          </div>
        </div>
        <section class="question-card" aria-labelledby="question-stem">
          <div class="question-meta"><span>${escapeHtml(question.chapter || '章节待标注')}</span><span>${question.type === 'multiple' ? '多选题' : '单选题'}</span></div>
          <h2 id="question-stem">${escapeHtml(question.stem)}</h2>
          <div class="options" role="group" aria-label="选择答案">${options}</div>
          ${feedback}
          ${savedAnswer ? `<button class="button primary next-button" type="button" data-action="next" ${busy ? 'disabled' : ''}>${currentIndex + 1 === questions.length ? '完成练习' : '下一题'}</button>` : ''}
        </section>
      </main>
    </div>
    ${sheetOpen ? renderAnswerSheet() : ''}`
  if (focusHeading) app.querySelector('.page-heading h1')?.focus()
}

async function submitAnswer(selected) {
  if (busy) return
  busy = true
  const question = questions[currentIndex]
  const actualKeys = (Array.isArray(selected) ? selected : [selected]).map(String).sort()
  const expectedKeys = (Array.isArray(question.answer) ? question.answer : [question.answer]).map(String).sort()
  const correct = actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index])
  const { error } = await supabase.from('practice_attempts').upsert({
    user_id: user.id,
    session_id: sessionState.session_id,
    question_id: question.id,
    subject,
    mode,
    selected_answer: selected,
    is_correct: correct,
  }, { onConflict: 'user_id,session_id,question_id', ignoreDuplicates: true })
  if (error) {
    busy = false
    renderProblem('作答未能保存', '请检查网络后重新加载；当前题目尚未计入练习记录。')
    return
  }
  sessionState.answers[question.id] = { selected, correct }
  busy = false
  try {
    await saveSession()
    renderQuestion()
  } catch {
    renderProblem('作答已记录，但续练进度保存失败', '请刷新后检查网络；不要重复提交当前题。')
  }
}

async function goNext() {
  if (busy) return
  busy = true
  try {
    if (currentIndex + 1 >= questions.length) {
      sessionState.completed = true
      await saveSession()
      busy = false
      const answered = questions.filter((question) => sessionState.answers[question.id]).length
      const correct = questions.filter((question) => sessionState.answers[question.id]?.correct).length
      app.innerHTML = `
        <div class="app-shell">
          ${renderTopbar('modes', '更换练习方式')}
          <main class="page-shell"><section class="complete-card">
            <p class="eyebrow">${escapeHtml(subject)} · ${escapeHtml(contextLabel())}</p><h1 tabindex="-1">练习完成</h1>
            <p>本次答对 ${correct} / ${answered} 题，正确率 ${rate(correct, answered)}。作答已保存。</p>
            <button class="button primary" type="button" data-action="restart">再练一次</button>
          </section></main>
        </div>`
      return
    }
    currentIndex += 1
    sessionState.current_index = currentIndex
    multiDraft = new Set()
    await saveSession()
    busy = false
    renderQuestion()
  } catch {
    busy = false
    currentIndex = sessionState.current_index
    renderProblem('进度保存失败', '请检查网络后重新加载；当前练习位置没有前进。')
  }
}

async function loadWrong() {
  view = 'wrong'
  subjectsOpen = false
  app.innerHTML = `<div class="app-shell">${renderTopbar()}<main class="selection-shell"><div class="loading-card" role="status">正在读取错题…</div></main></div>`
  const { data: attempts, error } = await supabase
    .from('practice_attempts')
    .select('question_id, selected_answer, answered_at')
    .eq('is_correct', false)
    .order('answered_at', { ascending: false })

  if (error) {
    renderProblem('无法读取错题', '请确认已运行 supabase/setup.sql 后再试。')
    return
  }

  const { data: dismissed, error: dismissError } = await supabase.from('wrong_dismissed').select('question_id, dismissed_at')
  if (dismissError) {
    renderProblem('错题清单尚未初始化', '请在 Supabase 重新运行 supabase/setup.sql，创建 wrong_dismissed 表。')
    return
  }

  const dismissedAt = new Map((dismissed || []).map((row) => [row.question_id, row.dismissed_at]))
  const latest = new Map()
  for (const attempt of attempts || []) {
    if (!latest.has(attempt.question_id)) latest.set(attempt.question_id, attempt)
  }
  const ids = [...latest.keys()].filter((id) => {
    const dismissedTime = dismissedAt.get(id)
    return !dismissedTime || new Date(dismissedTime) < new Date(latest.get(id).answered_at)
  })

  if (!ids.length) {
    wrongItems = []
    app.innerHTML = `<div class="app-shell">${renderTopbar()}<main class="selection-shell">
      <p class="eyebrow">${escapeHtml(subjectName)}</p><h1 tabindex="-1">错题</h1>
      <p class="selection-copy">答错的题目会出现在这里。答对后仍保留，方便回头再看。</p>
    </main></div>`
    app.querySelector('h1')?.focus()
    return
  }

  const { data: bankQuestions, error: questionError } = await supabase
    .from('questions')
    .select('id, stem, options, answer, analysis, chapter')
    .eq('bank_id', bankId)
    .in('id', ids)

  if (questionError) {
    renderProblem('无法读取错题内容', '请检查题目读取策略后重试。')
    return
  }

  const byId = new Map((bankQuestions || []).map((question) => [question.id, question]))
  wrongItems = ids.map((id) => {
    const question = byId.get(id)
    if (!question) return null
    return { question, picked: latest.get(id).selected_answer, at: latest.get(id).answered_at }
  }).filter(Boolean)
  if (wrongChapter && !wrongItems.some((item) => item.question.chapter === wrongChapter)) wrongChapter = ''
  renderWrong()
}

function renderWrong() {
  const chapters = new Map()
  for (const item of wrongItems) {
    const name = item.question.chapter || '章节待标注'
    chapters.set(name, (chapters.get(name) || 0) + 1)
  }
  const visible = wrongChapter ? wrongItems.filter((item) => (item.question.chapter || '章节待标注') === wrongChapter) : wrongItems
  app.innerHTML = `<div class="app-shell">${renderTopbar()}<main class="selection-shell">
    <p class="eyebrow">${escapeHtml(subjectName)}</p>
    <h1 tabindex="-1">错题 ${wrongItems.length} 道</h1>
    <p class="selection-copy">答对后仍会保留，方便你回头再看；确认掌握后可手动移出。</p>
    <div class="chip-row" role="group" aria-label="按章节筛选">
      <button class="chip${wrongChapter ? '' : ' active'}" type="button" data-action="filter-wrong" data-chapter="">全部 ${wrongItems.length}</button>
      ${[...chapters.entries()].map(([name, count]) => `<button class="chip${wrongChapter === name ? ' active' : ''}" type="button" data-action="filter-wrong" data-chapter="${escapeHtml(name)}">${escapeHtml(name)} ${count}</button>`).join('')}
    </div>
    <button class="button primary wide" type="button" data-action="replay-wrong">重练这 ${visible.length} 道</button>
    <div class="wrong-list">${visible.map((item) => {
      const picked = item.picked
      return `<article class="wrong-item">
        <p class="question-meta"><span>${escapeHtml(item.question.chapter || '章节待标注')}</span><span>${new Date(item.at).toLocaleDateString('zh-CN')}</span></p>
        <h2>${escapeHtml(item.question.stem)}</h2>
        <p class="wrongtxt">你的答案：${escapeHtml(Array.isArray(picked) ? picked.join('、') : picked)}</p>
        <p class="righttxt">参考答案：${escapeHtml(Array.isArray(item.question.answer) ? item.question.answer.join('、') : item.question.answer)}</p>
        <p class="analysis">${escapeHtml(item.question.analysis)}</p>
        <button class="text-button" type="button" data-action="dismiss" data-id="${escapeHtml(item.question.id)}">移出错题</button>
      </article>`
    }).join('')}</div>
  </main></div>`
  app.querySelector('h1')?.focus()
}

function visibleWrongIds() {
  return (wrongChapter ? wrongItems.filter((item) => (item.question.chapter || '章节待标注') === wrongChapter) : wrongItems)
    .map((item) => item.question.id)
}

async function loadStats() {
  view = 'stats'
  subjectsOpen = false
  app.innerHTML = `<div class="app-shell">${renderTopbar()}<main class="selection-shell"><div class="loading-card" role="status">正在读取学习记录…</div></main></div>`
  if (!(await loadOverview())) return
  const days = overview.days
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const totalCorrect = days.reduce((sum, day) => sum + day.correct, 0)
  const today = days[days.length - 1]
  const peak = Math.max(1, ...days.map((day) => day.count))

  app.innerHTML = `<div class="app-shell">${renderTopbar()}<main class="selection-shell">
    <p class="eyebrow">${escapeHtml(subjectName)}</p>
    <h1 tabindex="-1">学习记录</h1>
    <div class="stat-summary">
      <div><strong>${today.count}</strong><span>今天作答</span></div>
      <div><strong>${rate(today.correct, today.count)}</strong><span>今天正确率</span></div>
      <div><strong>${total}</strong><span>近 14 天作答</span></div>
      <div><strong>${rate(totalCorrect, total)}</strong><span>近 14 天正确率</span></div>
    </div>
    ${total ? '' : '<p class="selection-copy">最近 14 天还没有作答记录。去练习几道题后，这里会显示每天的题量和正确率。</p>'}
    <div class="day-list">${days.map((day) => `<div class="day-row">
      <span class="day-label">${day.label}</span>
      <span class="day-bar"><i style="width:${Math.round(day.count / peak * 100)}%"></i></span>
      <span class="day-count">${day.count} 题</span>
      <span class="day-rate">${day.count ? rate(day.correct, day.count) : '—'}</span>
    </div>`).join('')}</div>
    <p class="source-note">题量按每次作答计数；正确率 = 当日答对数 / 当日作答数。章节与专题卡片上的正确率按每道题最近一次作答计算。</p>
  </main></div>`
  app.querySelector('h1')?.focus()
}

app.addEventListener('submit', async (event) => {
  if (event.target.id !== 'auth-form') return
  event.preventDefault()
  const form = new FormData(event.target)
  const username = String(form.get('username') || '').trim()
  const password = String(form.get('password') || '')
  busy = true
  const submit = event.target.querySelector('button[type="submit"]')
  submit.disabled = true
  submit.textContent = '正在登录…'
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor(username), password })
  busy = false
  if (error) {
    const hint = /invalid login credentials/i.test(error.message) ? '用户名或密码不对' : error.message
    renderAuth(hint, username)
    return
  }
  localStorage.setItem('jjc.username', username.toLowerCase())
})

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]')
  if (!button) return
  const action = button.dataset.action

  if (button.tagName === 'A') event.preventDefault()
  if (action === 'signout') {
    await supabase.auth.signOut()
  } else if (action === 'toggle-subjects') {
    subjectsOpen = !subjectsOpen
    if (mode === '') renderHome()
    else renderQuestion()
  } else if (action === 'pick-subject') {
    subject = button.dataset.subject
    subjectsOpen = false
    await loadHome()
  } else if (action === 'modes') {
    mode = ''
    selectedChapter = ''
    selectedPaper = ''
    wrongReplay = null
    if (await loadOverview()) renderHome()
  } else if (action === 'mode') {
    mode = button.dataset.mode
    selectedChapter = ''
    selectedPaper = ''
    wrongReplay = null
    if (mode === 'chapter') renderChapters()
    else if (mode === 'topic') renderPapers()
    else await loadPractice()
  } else if (action === 'chapter') {
    selectedChapter = button.dataset.chapter
    wrongReplay = null
    await loadPractice()
  } else if (action === 'paper') {
    selectedPaper = button.dataset.paper
    wrongReplay = null
    await loadPractice()
  } else if (action === 'resume') {
    const recent = overview.recent
    if (!recent) return
    subject = recent.subject
    mode = recent.mode
    selectedChapter = mode === 'chapter' ? recent.scope : ''
    selectedPaper = mode === 'topic' ? recent.scope : ''
    wrongReplay = recent.mode === 'mixed' && recent.scope === 'wrong' ? new Set(recent.question_ids || []) : null
    await loadPractice()
  } else if (action === 'tab') {
    const tab = button.dataset.tab
    if (tab === 'practice') await loadHome()
    else if (tab === 'wrong') await loadWrong()
    else await loadStats()
  } else if (action === 'sheet') {
    sheetOpen = true
    renderQuestion()
    app.querySelector('.sheet-cell.current')?.focus()
  } else if (action === 'close-sheet') {
    sheetOpen = false
    renderQuestion()
  } else if (action === 'jump') {
    const target = Number(button.dataset.index)
    if (!Number.isInteger(target)) return
    currentIndex = Math.max(0, Math.min(target, questions.length - 1))
    sessionState.current_index = currentIndex
    multiDraft = new Set()
    sheetOpen = false
    try {
      await saveSession()
      renderQuestion()
    } catch {
      renderProblem('进度保存失败', '请检查网络后重新加载。')
    }
  } else if (action === 'filter-wrong') {
    wrongChapter = button.dataset.chapter || ''
    renderWrong()
  } else if (action === 'replay-wrong') {
    const ids = visibleWrongIds()
    if (!ids.length) return
    wrongReplay = new Set(ids)
    mode = 'mixed'
    selectedChapter = ''
    selectedPaper = ''
    await loadPractice()
  } else if (action === 'dismiss') {
    const { error } = await supabase
      .from('wrong_dismissed')
      .upsert({ user_id: user.id, question_id: button.dataset.id, dismissed_at: new Date().toISOString() }, { onConflict: 'user_id,question_id' })
    if (error) renderProblem('移出失败', '请检查网络后重试。')
    else await loadWrong()
  } else if (action === 'reload') {
    if (mode) await loadPractice()
    else if (view === 'wrong') await loadWrong()
    else if (view === 'stats') await loadStats()
    else await loadHome()
  } else if (action === 'option') {
    const question = questions[currentIndex]
    const key = button.dataset.key
    if (question.type === 'multiple') {
      multiDraft.has(key) ? multiDraft.delete(key) : multiDraft.add(key)
      renderQuestion()
    } else {
      await submitAnswer(key)
    }
  } else if (action === 'submit-multiple') {
    if (multiDraft.size) await submitAnswer([...multiDraft].sort())
  } else if (action === 'next') {
    if (!busy) await goNext()
  } else if (action === 'restart') {
    if (busy) return
    busy = true
    sessionState.session_id = crypto.randomUUID()
    sessionState.current_index = 0
    sessionState.answers = {}
    sessionState.completed = false
    currentIndex = 0
    try {
      await saveSession()
      busy = false
      renderQuestion()
    } catch {
      busy = false
      renderProblem('无法重新开始', '请检查网络后重新加载。')
    }
  }
})

const { data: { session } } = await supabase.auth.getSession()
user = session?.user || null
if (user) await loadHome()
else renderAuth('', localStorage.getItem('jjc.username') || '')

supabase.auth.onAuthStateChange((_event, nextSession) => {
  const nextUser = nextSession?.user || null
  // 切回窗口时 supabase 会重新发 token，事件频繁触发；用户没变就不重载页面。
  if ((nextUser?.id || null) === (user?.id || null)) return
  user = nextUser
  if (user) void loadHome()
  else renderAuth('', localStorage.getItem('jjc.username') || '')
})
