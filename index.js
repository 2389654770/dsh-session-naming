/**
 * @dsh-external/dsh-session-namer — 会话主动命名 v0.1
 *
 * 能力：
 *  1. `session_title` 工具：读取或改写「当前会话」的名称，落在 session/title 事件上
 *     （source = 'user'，因此会顶掉首轮自动命名，之后也不会被自动生成覆盖）。
 *  2. 系统提示词引导：告诉模型它就是这条会话的命名人，任务焦点明确后先改名再干活；
 *     默认按「笔记工作区」的约定起名（会话名 = 正在处理的那篇笔记）。
 *
 * 服务：只 inject tools / systemPrompt；session-title 通过 ctx.get('sessionTitle')
 * 软取——未挂载时工具报明确错误，而不是让整个插件起不来。
 *
 * 无静态 import：工具定义用原始 JSON Schema 直接注册，不依赖 defineTool 的解析。
 */

export const name = 'dsh-session-namer'
export const inject = ['tools', 'systemPrompt']

/** 默认配置（patch 里出现的同名字段覆盖这里）。 */
const DEFAULTS = {
  autoRename: true,
  prefix: '',
  maxChars: 24,
  language: 'zh',
  customRule: '',
}

/** 规范化插件配置：任何非法值退回默认，避免激活失败。 */
function readConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const merged = { ...DEFAULTS, ...input }
  const maxChars =
    Number.isInteger(merged.maxChars) && merged.maxChars >= 4 && merged.maxChars <= 80
      ? merged.maxChars
      : DEFAULTS.maxChars
  return {
    autoRename: merged.autoRename !== false,
    prefix: typeof merged.prefix === 'string' ? merged.prefix : '',
    maxChars,
    language: merged.language === 'en' ? 'en' : 'zh',
    customRule: typeof merged.customRule === 'string' ? merged.customRule : '',
  }
}

/** 中文引导：笔记工作区的命名约定。 */
function guidanceZh(config) {
  const prefix = config.prefix === '' ? '' : `以「${config.prefix}」开头，`
  const extra = config.customRule.trim() === '' ? '' : `\n- 本项目约定：${config.customRule.trim()}`
  return (
    '【会话命名 · 本会话】你是当前会话的命名人：任务焦点一明确，就先调用 session_title 把会话名定下来，再继续干活——' +
    '侧边栏靠这个名字找回上下文。\n' +
    '- 何时改：主题明确后改一次；开始处理另一篇笔记或另一个主题时再改。纯问候、一次性小问答、还没看清任务时不改。\n' +
    `- 怎么起名：${prefix}中文短语，≤${config.maxChars} 字；写清"在做什么 / 哪一篇"，不写"会话""助手""任务"这类空话；` +
    '不加引号、不加句号、不带时间戳。\n' +
    '- 笔记工作区：会话名与被处理的笔记保持一致——正在写 / 改 / 查哪篇笔记，就用那篇笔记的标题；' +
    '一次会话覆盖多篇时用集合名（如「周报汇总」），批量整理时用「整理：<范围>」。\n' +
    '- 只在确有变化时改：当前名字已经准确就不要重复调用；只想确认名字时，调用 session_title 但不传 title。\n' +
    '- 只改本会话，不替其它会话或用户猜名字。' +
    extra
  )
}

/** English guidance, same rules. */
function guidanceEn(config) {
  const prefix = config.prefix === '' ? '' : `start with "${config.prefix}", `
  const extra = config.customRule.trim() === '' ? '' : `\n- Project convention: ${config.customRule.trim()}`
  return (
    '[Session naming · this session] You own this session\'s name: as soon as the task focus is clear, call session_title ' +
    'to name it, then continue the work — the sidebar uses that name to find this context again.\n' +
    '- When: once when the topic is clear; again when you move to another note or topic. Not for greetings, one-off ' +
    'questions, or a task you cannot characterize yet.\n' +
    `- How: ${prefix}a short noun phrase, at most ${config.maxChars} characters; say what is being done and which note; ` +
    'no "session"/"assistant"/"task" filler, no quotes, no trailing period, no timestamps.\n' +
    '- Note workspaces: keep the name identical to the note being edited; use a collection name when one session covers ' +
    'several notes, and "整理：<scope>" style phrases for bulk passes.\n' +
    '- Only rename on a real change: skip the call when the current name is already accurate; call without `title` to read it.\n' +
    '- Rename this session only; never guess names for other sessions.' +
    extra
  )
}

/** 工具对模型暴露的说明。 */
const TOOL_DESCRIPTION =
  '读取或主动设置「当前会话」的名称（会话标题显示在侧边栏）。' +
  '不传 title = 只读取当前名称；传 title = 立即改名，改名会写入会话日志并顶掉自动生成的标题。' +
  '任务主题明确后、或切换到另一个主题 / 另一篇笔记时调用它，让会话名与正在做的事一致；' +
  '一个准确的名字够用，不要重复调用。只作用于当前会话。'

/** 返回值的渲染：一行人话，方便模型与用户都看懂。必须返回 ContentBlock[]。 */
function renderResult(args, value) {
  const title = value.title === '' ? '（尚未命名）' : value.title
  const text = value.changed
    ? `会话名已更新：${value.previous === '' ? '（尚未命名）' : value.previous} → ${title}`
    : `当前会话名：${title}`
  const note = typeof args?.note === 'string' ? args.note.trim() : ''
  return [{ type: 'text', text: note === '' ? text : `${text}\n（${note}）` }]
}

export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig)

  // ── 1. 提示词引导（静态文本，不改动工具目录，前缀稳定利于请求缓存）──────────
  if (config.autoRename) {
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: 'session-namer:auto-rename',
          order: 4550,
          text: config.language === 'en' ? guidanceEn(config) : guidanceZh(config),
        }),
      '@dsh-external/dsh-session-namer: naming guidance',
    )
  }

  // ── 2. session_title 工具 ──────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'session_title',
        description: TOOL_DESCRIPTION,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: {
              type: 'string',
              description: '新的会话名。省略则只读取当前名称。',
            },
            note: {
              type: 'string',
              description: '为什么这样命名（一句话，只回显在结果里，不写进标题）。',
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sessionId: { type: 'string', description: '当前会话 id。' },
              title: { type: 'string', description: '改名后的名称，空串表示尚未命名。' },
              previous: { type: 'string', description: '改名前的名称，空串表示此前没有名称。' },
              changed: { type: 'boolean', description: '本次调用是否真的改动了名称。' },
            },
          },
          render: renderResult,
        },
        async execute(args, exec) {
          const agent = exec.agent
          if (agent === undefined) throw new Error('session_title 只能在某个会话内调用')

          const session =
            agent.session ?? ctx.get('agents')?.get?.(agent.id)?.session
          if (session === undefined) throw new Error('session_title 找不到当前会话')

          const titles = ctx.get('sessionTitle')
          if (titles === undefined) {
            throw new Error('session_title 依赖的 session-title 服务未挂载（@deepseek-ai/dsh-session-title）')
          }

          const previous = titles.get(session)?.title ?? ''
          const wanted = typeof args.title === 'string' ? args.title.trim() : ''

          // 读取模式，或名字没变：不写日志事件，避免把会话日志刷满。
          if (wanted === '' || wanted === previous) {
            return { sessionId: session.id, title: previous, previous, changed: false }
          }

          let snapshot
          try {
            snapshot = titles.rename(session, wanted)
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            throw new Error(`会话改名失败：${reason}`)
          }
          return {
            sessionId: session.id,
            title: snapshot.title,
            previous,
            changed: snapshot.title !== previous,
          }
        },
      }),
    '@dsh-external/dsh-session-namer: session_title tool',
  )
}
