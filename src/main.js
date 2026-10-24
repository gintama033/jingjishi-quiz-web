import { createClient } from '@supabase/supabase-js'
import { supabaseAnonKey, supabaseUrl } from './config.js'
import './style.css'

const supabase = createClient(supabaseUrl, supabaseAnonKey)
const app = document.querySelector('#app')
const subject = '经济基础知识'
const mode = 'chapter'
const bankId = 'jingji-jichu-2026'
let user = null
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

async function loadPractice() {
  app.innerHTML = '<main class="page-shell"><div class="loading-card" role="status">正在连接题库…</div></main>'
  const { data: bankQuestions, error: bankError } = await supabase
    .from('questions')
    .select('id, stem, options, answer, analysis, chapter, point, type')
    .eq('bank_id', bankId)
    .order('id')

  if (bankError) {
    renderProblem('题库还没连接好', '请先在 Supabase 执行项目里的 supabase/setup.sql 和本地样题脚本。')
    return
  }
  if (!bankQuestions?.length) {
    renderProblem('样题尚未导入', '请在 Supabase SQL Editor 执行 supabase/seed.local.sql，再重新加载。')
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
  questions = ids?.length ? ids.map((id) => byId.get(id)) : bankQuestions
  sessionState = saved && !saved.completed
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
    renderQuestion()
  } catch {
    renderProblem('无法保存练习进度', '请确认 Supabase 的练习进度 RLS 策略已安装。')
  }
}

function renderQuestion() {
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
      <header class="topbar">
        <a class="brand" href="#" aria-label="经师首页"><span class="brand-mark">经</span>经师</a>
        <div class="topbar-right"><span class="user-email">${escapeHtml(user.email || '')}</span><button class="text-button" type="button" data-action="signout">退出</button></div>
      </header>
      <main class="practice-shell">
        <div class="page-heading">
          <div><p class="eyebrow">经济基础知识 · 样题验证</p><h1>章节练习</h1></div>
          <span class="progress-pill">${currentIndex + 1} / ${questions.length}</span>
        </div>
        <section class="question-card" aria-labelledby="question-stem">
          <div class="question-meta"><span>${escapeHtml(question.chapter || '章节待标注')}</span><span>${question.type === 'multiple' ? '多选题' : '单选题'}</span></div>
          <h2 id="question-stem">${escapeHtml(question.stem)}</h2>
          <div class="options" role="group" aria-label="选择答案">${options}</div>
          ${feedback}
          ${savedAnswer ? `<button class="button primary next-button" type="button" data-action="next" ${busy ? 'disabled' : ''}>${currentIndex + 1 === questions.length ? '完成练习' : '下一题'}</button>` : ''}
        </section>
        <p class="source-note">当前仅载入 ${questions.length} 道样题；完整题库尚未导入。</p>
      </main>
    </div>`
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
          <header class="topbar"><a class="brand" href="#"><span class="brand-mark">经</span>经师</a><button class="text-button" type="button" data-action="signout">退出</button></header>
          <main class="page-shell"><section class="complete-card">
            <p class="eyebrow">本组样题已完成</p><h1>练习完成</h1>
            <p>本次样题作答已保存到你的 Supabase 账号。</p>
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

  if (action === 'signout') {
    await supabase.auth.signOut()
  } else if (action === 'reload') {
    await loadPractice()
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
if (user) await loadPractice()
else renderAuth()

supabase.auth.onAuthStateChange((_event, nextSession) => {
  user = nextSession?.user || null
  if (user) void loadPractice()
  else renderAuth()
})
