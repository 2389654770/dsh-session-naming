# dsh-session-naming

Give the agent the **habit** of naming its own session, not just the API.

A [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Cordis bundle with two halves that only make sense together:

1. a model-facing tool `session_title` — read or set the current session's name;
2. a prompt section that says *when* to use it — "as soon as the task focus is clear, name the session, then keep working", with defaults tuned for **note/topic workspaces**.

```
会话名已更新：开发会话主动命名插件 → 实现会话主动命名插件
```

## The gap

DSH can already store a session title. What it cannot do is let the *agent* decide one — every existing mechanism is automatic:

| What | Provided by | Agent chooses the name? |
| --- | --- | --- |
| title fold + `rename/get/refresh` service | `@deepseek-ai/dsh-session-title` (core) | no — service only, no model tool |
| one title generated from the first human prompt | `@deepseek-ai/dsh-session-title-first-prompt-llm` | no — automatic, once |
| title refreshed on every human prompt | `@deepseek-ai/dsh-experimental-session-titles-bundle` | no — automatic, uncontrolled |
| auto emoji category prefix from the first message | [`dsh-session-namer`](https://www.npmjs.com/package/dsh-session-namer) (community) | no — heuristic prefix |
| `session_rename` tool | [`dsh-session-rename`](https://www.npmjs.com/package/dsh-session-rename) (community) | **yes** — tool only, no rules |

So a tool exists (see *Related work*), but a tool alone leaves the behaviour to luck: nothing in the prompt tells the model that naming is its job. This bundle ships the tool **and** the rule, which is what makes the sidebar name accurate at the end of a task instead of a truncated first sentence.

## What's in the box

- **`session_title` tool** — `{ title?, note? }`. Omitting `title` reads the current name. Passing `title` renames through `ctx.sessionTitle.rename()`, which appends a `session/title` event with `source: 'user'`: persisted in the session log, sidebar updates immediately, and later automatic generation no longer overwrites it. A repeated identical title writes nothing (no log spam).
- **Proactive-naming prompt section** (`session-namer:auto-rename`, order 4550) — static text, so the system prefix stays cacheable. Default rules: rename once when the topic is clear; rename again when the topic changes; skip greetings and one-off questions; in a note workspace the name equals the note being edited.
- Nothing else: no timers, no state, no dependencies, no build step.

## Install

### From npm

```text
plugin_manager({ action: 'install_bundle', target: 'dsh-session-naming' })
```

or from a shell:

```powershell
dsh plugin --profile <profile> add dsh-session-naming
```

### From a local checkout (development)

```text
plugin_manager({ action: 'install_bundle', target: '<absolute path to this directory>' })
```

A directory install links the checkout, so edits apply after a plugin toggle (see *Gotchas*).

### By hand

```yaml
- insert:
    - id: dsh-session-naming
      name: dsh-session-naming
      config: {}
```

## Usage

| Call | Result |
| --- | --- |
| `session_title()` | `当前会话名：实现会话主动命名插件` |
| `session_title({ title: '实现会话主动命名插件' })` | `会话名已更新：开发会话主动命名插件 → 实现会话主动命名插件` |
| same title again | `当前会话名：…`, `changed: false`, no log event |
| `session_title({ title: '   ' })` | read mode — blank input is not an error |

Returned value: `{ sessionId, title, previous, changed }`. The tool resolves the session from `exec.agent.session`, never from an id the model supplies — there is no way to rename another session.

## Config

Optional; `cordis.patch.yml` ships the defaults. The plugin deliberately exports **no** `Config` schema: the row's config is read as-is and invalid values fall back, so a typo can never stop the plugin from activating.

| Field | Default | Meaning |
| --- | --- | --- |
| `autoRename` | `true` | Inject the proactive-naming guidance. `false` keeps the tool only (manual naming). |
| `prefix` | `''` | Prefix written into the guidance, e.g. `笔记：`, to group named sessions in the sidebar. |
| `maxChars` | `24` | Suggested title length, 4–80. |
| `language` | `zh` | Guidance language: `zh` or `en`. |
| `customRule` | `''` | Extra naming convention, appended verbatim to the guidance. |

**Note-workspace recipe** (the default target):

```yaml
config:
  prefix: '笔记：'
  maxChars: 24
  customRule: 一篇笔记一条会话；跨多篇时用「汇总：<主题>」；只改本会话。
```

## How it works

```
model step reads the guidance
  └─ calls session_title({ title })
       └─ ctx.sessionTitle.rename(session, title)
            └─ session.append('session/title', { title, source: { kind: 'user' } })
                 ├─ the title folds into the sidebar immediately
                 └─ automatic generation is superseded and stays superseded
```

Same code path as the Web UI's rename dialog, so normalization (control-character stripping, whitespace collapsing, UTF-8 truncation) and event shape are identical.

## Related work, and choosing one

- [`dsh-session-rename`](https://github.com/qinu321/dsh-session-rename) — MIT, the `session_rename` tool, zero-dependency, no prompt guidance. **Pick it if you only want the capability and prefer to state the rule yourself.** Installing both leaves two near-identical tools in the catalog (they do not collide by name, but the model sees both).
- [`dsh-session-namer`](https://www.npmjs.com/package/dsh-session-namer) — heuristic emoji-category prefix from the first message. No tool, no model involvement.
- This bundle differs by the prompt half: the rule, the read mode, the idempotent write, and the workspace conventions.

## Gotchas

- **`output.render` must return `ContentBlock[]`.** Returning a bare string fails deep in the pipeline with `content.some is not a function`, *after* `execute` already renamed the session.
- **Editing a linked bundle needs a reload.** The profile links the directory, so a changed `index.js` is not always a new module generation. Toggle the row (`plugin_manager` `set_plugin` off, then on) to force one.
- **`session_title` is registered for every session in the profile.** If another plugin registers the same name in the same layer, registration fails; rename one of them.
- **Renaming pins the title.** That is the point, but the built-in first-prompt generator will not touch the session afterwards. Set `autoRename: false` if you want to keep the automatic behaviour as a baseline.

## Verify

```text
cordis_inspect_query({ platform: 'host', provider: 'Tool', method: 'listTools' })   # session_title is listed
node scripts/check.mjs                                                            # manifest, locale, icon, exports
```

`scripts/check.mjs` is what CI runs (`.github/workflows/check.yml`).

## Release

```powershell
npm login                              # once, in a browser
npm publish --access public            # dsh-session-naming@0.1.0
gh auth login                          # once
gh repo create dsh-session-naming --public --source=. --push
```

Version bumps: edit `package.json`, add a `CHANGELOG.md` entry, `npm publish`, then `git tag vX.Y.Z && git push --tags`.

## 中文速览

给 Agent 一个「改自己会话名」的工具，附一段提示词规则，让它在任务主题明确后**主动**把会话名改准；默认按**笔记工作区**的约定命名（会话名 = 正在处理的笔记）。改名写 `session/title` 事件（`source: user`），侧边栏即时生效且不会被自动生成覆盖；同名不重复写事件，传空白等于只读。

同类已有 `dsh-session-rename`（只有工具、没有规则），本包多了「何时改名」的引导、笔记工作区约定、读取模式与幂等写入；两者工具名不同（`session_title` / `session_rename`），建议二选一。

安装：`plugin_manager({ action: 'install_bundle', target: 'dsh-session-naming' })`。配置见上表，`autoRename: false` 只留工具。只改当前会话。

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
