import { createClient } from '@supabase/supabase-js'
import { supabaseAnonKey, supabaseUrl } from './config.js'
import './style.css'

const supabase = createClient(supabaseUrl, supabaseAnonKey)
const app = document.querySelector('#app')
const bankId = 'jingji-jichu-2026'
const subjectName = '经济基础知识'
const modeNames = { chapter: '章节练习', mixed: '混合练习', mock: '模拟考试', 'past-paper': '真题训练' }
let user = null
let subject = ''
let mode = ''
let selectedChapter = ''
let bankOverview = { questionCount: 0, chapters: [] }
let questions = []
let sessionState = null
let currentIndex = 0
let multiDraft = new Set()
let busy = false

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function renderAuth(message = '', email = '') {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="auth-title">
        <p class="eyebrow">2026 · 中级经济师</p>
        <h1 id="auth-title">把今天的练习，变成考试时的底气。</h1>
        <p class="auth-copy">登录后，题目进度和作答记录会保存在你的 Supabase 账号中。账号需先在 Supabase 控制台创建。</p>
        <form id="auth-form">
          <label for="email">邮箱</label>
          <input id="email" name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required />
          <label for="password">密码</label>
          <input id="password" name="password" type="password" autocomplete="current-password" minlength="8" required />
          <button class="button primary wide" type="submit" ${busy ? 'disabled' : ''}>${busy ? '请稍候…' : '登录'}</button>
        </form>
        <p class="message" data-message role="status">${escapeHtml(message)}</p>
      </section>
      <p class="auth-footnote">你的个人记录仅对当前登录账号可见。</p>
    </main>`
}

function renderTopbar(backAction = '', backLabel = '') {
  return `<header class="topbar">
    <a class="brand" href="#" data-action="subjects" aria-label="经师首页"><span class="brand-mark">经</span>经师</a>
    <div class="topbar-right">
      ${backAction ? `<button class="text-button" type="button" data-action="${backAction}">${escapeHtml(backLabel)}</button>` : ''}
      <span class="user-email">${escapeHtml(user?.email || '')}</span>
      <button class="text-button" type="button" data-action="signout">退出</button>
    </div>
  </header>`
}

function renderProblem(title, detail) {
  app.innerHTML = `
    <main class="page-shell">
      <section class="problem-card">
        <p class="eyebrow">练习暂不可用</p>
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
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('practice_sessions')
    .upsert(row, { onConflict: 'user_id,subject,mode' })
  if (error) throw error
  sessionState = row
}

async function loadHome() {
  subject = ''
  mode = ''
  selectedChapter = ''
  bankOverview = { questionCount: 0, chapters: [] }
  app.innerHTML = '<main class="page-shell"><div class="loading-card" role="status">正在读取题库…</div></main>'
  const { data: questionMeta, error } = await supabase
    .from('questions')
    .select('id, chapter')
    .eq('bank_id', bankId)
    .order('id')

  if (error) {
    renderProblem('题库还没连接好', '请检查 Supabase 登录和 questions 表的读取策略。')
    return
  }

  const chapters = new Map()
  for (const question of questionMeta || []) {
    if (!question.chapter) continue
    const chapter = chapters.get(question.chapter) || { name: question.chapter, count: 0, practiced: 0 }
    chapter.count += 1
    chapters.set(question.chapter, chapter)
  }

  if (questionMeta?.length) {
    const { data: attempts, error: attemptError } = await supabase
      .from('practice_attempts')
      .select('question_id')
      .eq('subject', subjectName)
      .eq('mode', 'chapter')
    if (attemptError) {
      renderProblem('无法读取章节进度', '请检查 Supabase 的作答记录读取策略。')
      return
    }
    const practiced = new Set((attempts || []).map((attempt) => attempt.question_id))
    for (const question of questionMeta) {
      const chapter = chapters.get(question.chapter)
      if (chapter && practiced.has(question.id)) chapter.practiced += 1
    }
  }

  bankOverview = { questionCount: questionMeta?.length || 0, chapters: [...chapters.values()] }
  renderSubjects()
}

function renderSubjects() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      <main class="selection-shell">
        <p class="eyebrow">2026 · 中级经济师</p>
        <h1 tabindex="-1">先选科目，再开始练习</h1>
        <p class="selection-copy">题目、错题与学习进度分别记录，切换科目不会混在一起。</p>
        <div class="choice-list">
          <button class="choice-card" type="button" data-action="subject" ${bankOverview.questionCount ? '' : 'disabled'}>
            <span><strong>经济基础知识</strong><small>${bankOverview.questionCount ? `${bankOverview.questionCount} 道题 · ${bankOverview.chapters.length} 个章节` : '题库尚未导入'}</small></span>
            <span class="choice-status">${bankOverview.questionCount ? '可练习' : '待导入'}</span>
          </button>
          <button class="choice-card unavailable" type="button" disabled>
            <span><strong>工商管理专业知识和实务</strong><small>题库待导入；目前不可练习</small></span>
            <span class="choice-status">待导入</span>
          </button>
        </div>
        <p class="source-note">当前仅有验证题库；未导入的题目不会用于练习或模拟考试。</p>
      </main>
    </div>`
  app.querySelector('h1')?.focus()
}

function renderModes() {
  const mixedReady = bankOverview.questionCount > 1 && bankOverview.chapters.length > 1
  const modes = [
    { id: 'chapter', name: modeNames.chapter, detail: '按教材章节练习，逐题查看答案与解析。', enabled: bankOverview.questionCount > 0, status: `${bankOverview.questionCount} 道题可用` },
    { id: 'mixed', name: modeNames.mixed, detail: '跨章节、不计时，逐题反馈。', enabled: mixedReady, status: mixedReady ? `${bankOverview.chapters.length} 个章节可用` : '至少需要两个有题章节' },
    { id: 'mock', name: modeNames.mock, detail: '限时组卷，交卷后查看成绩与解析。', enabled: false, status: '样题数量不足，组卷规则尚未核实' },
    { id: 'past-paper', name: modeNames['past-paper'], detail: '按年份完成完整真题试卷。', enabled: false, status: '尚未导入完整年份试卷' },
  ]
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar('subjects', '返回科目')}
      <main class="selection-shell">
        <p class="eyebrow">${escapeHtml(subject)}</p>
        <h1 tabindex="-1">选择练习方式</h1>
        <div class="choice-list">
          ${modes.map((item) => `<button class="choice-card mode-card${item.enabled ? '' : ' unavailable'}" type="button" data-action="mode" data-mode="${item.id}" ${item.enabled ? '' : 'disabled'}>
            <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span>
            <span class="choice-status">${escapeHtml(item.status)}</span>
          </button>`).join('')}
        </div>
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
        <p class="selection-copy">系统显示已练题量；再次进入同一章节会恢复最近一次未完成进度。</p>
        <div class="choice-list">
          ${bankOverview.chapters.map((chapter) => `<button class="choice-card" type="button" data-action="chapter" data-chapter="${escapeHtml(chapter.name)}">
            <span><strong>${escapeHtml(chapter.name)}</strong><small>${chapter.count} 道题</small></span>
            <span class="choice-status">已练 ${chapter.practiced}/${chapter.count}</span>
          </button>`).join('')}
        </div>
      </main>
    </div>`
  app.querySelector('h1')?.focus()
}

async function loadPractice() {
  app.innerHTML = '<main class="page-shell"><div class="loading-card" role="status">正在连接题库…</div></main>'
  let query = supabase
    .from('questions')
    .select('id, stem, options, answer, analysis, chapter, point, type')
    .eq('bank_id', bankId)
  if (mode === 'chapter') query = query.eq('chapter', selectedChapter)
  const { data: bankQuestions, error: bankError } = await query.order('id')

  if (bankError) {
    renderProblem('题库还没连接好', '请检查 Supabase 登录和 questions 表的读取策略。')
    return
  }
  if (!bankQuestions?.length) {
    renderProblem('当前筛选下没有题目', '请选择其他章节，或等待该章节题库导入。')
    return
  }

  const { data: saved, error: sessionError } = await supabase
    .from('practice_sessions')
    .select('*')
    .eq('subject', subject)
    .eq('mode', mode)
    .maybeSingle()

  if (sessionError) {
    renderProblem('无法读取练习进度', '请确认已运行 supabase/setup.sql，并使用自己的邮箱账号登录。')
    return
  }

  const byId = new Map(bankQuestions.map((question) => [question.id, question]))
  const ids = saved?.question_ids?.filter((id) => byId.has(id))
  const resume = Boolean(saved && !saved.completed && ids?.length)
  questions = resume ? ids.map((id) => byId.get(id)) : bankQuestions
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
          <div><p class="eyebrow">${escapeHtml(subject)}${mode === 'chapter' ? ` · ${escapeHtml(selectedChapter)}` : ' · 跨章节'}</p><h1 tabindex="-1">${escapeHtml(modeNames[mode])}</h1></div>
          <span class="progress-pill">${currentIndex + 1} / ${questions.length}</span>
        </div>
        <section class="question-card" aria-labelledby="question-stem">
          <div class="question-meta"><span>${escapeHtml(question.chapter || '章节待标注')}</span><span>${question.type === 'multiple' ? '多选题' : '单选题'}</span></div>
          <h2 id="question-stem">${escapeHtml(question.stem)}</h2>
          <div class="options" role="group" aria-label="选择答案">${options}</div>
          ${feedback}
          ${savedAnswer ? `<button class="button primary next-button" type="button" data-action="next" ${busy ? 'disabled' : ''}>${currentIndex + 1 === questions.length ? '完成练习' : '下一题'}</button>` : ''}
        </section>
        <p class="source-note">当前题库共 ${bankOverview.questionCount} 道题；模拟考试和真题训练在题库/规则核实前不可用。</p>
      </main>
    </div>`
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
      app.innerHTML = `
        <div class="app-shell">
          ${renderTopbar('modes', '更换练习方式')}
          <main class="page-shell"><section class="complete-card">
            <p class="eyebrow">${escapeHtml(subject)} · ${escapeHtml(modeNames[mode])}</p><h1 tabindex="-1">练习完成</h1>
            <p>本次作答已保存到你的 Supabase 账号。</p>
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

app.addEventListener('submit', async (event) => {
  if (event.target.id !== 'auth-form') return
  event.preventDefault()
  const form = new FormData(event.target)
  const email = String(form.get('email') || '').trim()
  const password = String(form.get('password') || '')
  busy = true
  const submit = event.target.querySelector('button[type="submit"]')
  submit.disabled = true
  submit.textContent = '正在登录…'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  busy = false
  if (error) renderAuth(error.message, email)
})

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]')
  if (!button) return
  const action = button.dataset.action

  if (button.tagName === 'A') event.preventDefault()
  if (action === 'signout') {
    await supabase.auth.signOut()
  } else if (action === 'subjects') {
    await loadHome()
  } else if (action === 'modes') {
    mode = ''
    selectedChapter = ''
    renderModes()
  } else if (action === 'subject') {
    subject = subjectName
    renderModes()
  } else if (action === 'mode') {
    mode = button.dataset.mode
    selectedChapter = ''
    if (mode === 'chapter') renderChapters()
    else await loadPractice()
  } else if (action === 'chapter') {
    selectedChapter = button.dataset.chapter
    await loadPractice()
  } else if (action === 'reload') {
    if (mode) await loadPractice()
    else if (subject) renderModes()
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
else renderAuth()

supabase.auth.onAuthStateChange((_event, nextSession) => {
  user = nextSession?.user || null
  if (user) void loadHome()
  else renderAuth()
})
