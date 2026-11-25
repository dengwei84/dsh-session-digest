import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function userEvent(seq, text, kind = 'user') {
  return { type: 'user/message', seq, data: { content: [{ type: 'text', text }], source: { kind } } }
}

function assistantEvent(seq, text) {
  return {
    type: 'assistant/message',
    seq,
    data: { message: { content: [{ type: 'reasoning', text: 'thinking…' }, { type: 'text', text }] } },
  }
}

const SESSION_A = {
  id: 'session-aaaa-1111',
  cwd: 'D:\\AI\\MD',
  createdAt: 1790000000000,
  isSeeded: false,
}

const SESSION_B = {
  id: 'session-bbbb-2222',
  cwd: 'D:\\AI\\DeepSeek',
  createdAt: 1790100000000,
  isSeeded: true,
}

function makeContext({ surface = {}, logs = {}, records = [] }) {
  const registered = []
  const ctx = {
    tools: { register: tool => registered.push(tool) },
    sessionQuery: {
      listSessions: async () => records,
      readSurface: async id => {
        if (surface[id] === undefined) throw new Error(`no session ${id}`)
        return surface[id]
      },
      readSession: async id => {
        if (logs[id] === undefined) throw new Error(`no session ${id}`)
        return logs[id]
      },
      readTitleSnapshots: async ids =>
        ids.map(id => ({
          sessionId: id,
          status: 'fulfilled',
          value: { title: id === SESSION_A.id ? '记忆库索引讨论' : undefined },
        })),
    },
    get: key => ctx[key],
  }
  apply(ctx, {})
  return { ctx, tool: name => registered.find(t => t.name === name) }
}

const calls = {
  agent: { session: { id: 'session-self', header: { cwd: 'D:\\AI\\DeepSeek' } } },
  signal: undefined,
}

test('digest keeps only user/assistant text and drops injected context', async () => {
  const surface = {
    [SESSION_A.id]: {
      session: SESSION_A,
      capturedThroughSeq: 12,
      events: [
        userEvent(1, '请整理记忆库索引'),
        userEvent(2, '这是注入的引用快照', 'session-reference'),
        assistantEvent(3, '好的，先读 README'),
        userEvent(4, '压缩检查点', 'plugin'),
        assistantEvent(5, '索引已更新'),
        { type: 'tool/result', seq: 6, data: {} },
      ],
    },
  }
  const { tool } = makeContext({ surface })
  const result = await tool('session_digest').execute({ sessionId: SESSION_A.id }, calls)
  assert.equal(result.totalMessages, 4)
  assert.equal(result.scope, 'surface')
  assert.deepEqual(result.material.map(item => item.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(result.material[2].checkpoint, true)
  assert.ok(!result.markdown.includes('这是注入的引用快照'))
  assert.ok(result.markdown.includes('压缩检查点'))
  assert.equal(result.omittedMessages, 0)
  assert.equal(result.truncated, false)
  assert.equal(result.goal, undefined)
})

test('digest keeps the newest messages within the overall budget and keeps the opening ask', async () => {
  const events = []
  for (let i = 0; i < 10; i += 1) {
    events.push(userEvent(i * 2 + 1, `问题 ${i} `.padEnd(600, 'x')))
    events.push(assistantEvent(i * 2 + 2, `回答 ${i}`))
  }
  const surface = { [SESSION_A.id]: { session: SESSION_A, capturedThroughSeq: 20, events } }
  const { tool } = makeContext({ surface })
  const result = await tool('session_digest').execute(
    { sessionId: SESSION_A.id, maxMessages: 200, maxChars: 2500, maxMessageChars: 3000 },
    calls,
  )
  assert.equal(result.totalMessages, 20)
  assert.ok(result.includedMessages < result.totalMessages)
  assert.equal(result.omittedMessages, result.totalMessages - result.includedMessages)
  assert.equal(result.truncated, true)
  assert.ok(result.material.at(-1).text.includes('回答 9'))
  assert.ok(result.goal.includes('问题 0'))
  assert.ok(result.markdown.includes('## Opening request'))
  for (const item of result.material) {
    assert.ok([...item.text].length <= 3000)
  }
})

test('digest clips one oversized message and records the omission', async () => {
  const surface = {
    [SESSION_A.id]: {
      session: SESSION_A,
      capturedThroughSeq: 3,
      events: [userEvent(1, 'a'.repeat(5000)), assistantEvent(2, '收到')],
    },
  }
  const { tool } = makeContext({ surface })
  const result = await tool('session_digest').execute({ sessionId: SESSION_A.id, maxMessageChars: 500 }, calls)
  assert.equal(result.omittedChars, 5000 - 468)
  assert.ok(result.material[0].text.includes('[omitted'))
  assert.ok(result.material[1].text.includes('收到'))
})

test('scope=full reads the stored log and can include pre-compaction turns', async () => {
  const surfaceEvents = [userEvent(9, '压缩后的最新问题'), assistantEvent(10, '压缩后的回答')]
  const logEvents = [
    userEvent(1, '最早的目标'),
    assistantEvent(2, '早期工作'),
    userEvent(3, '另一轮'),
    assistantEvent(4, '另一轮回答'),
    ...surfaceEvents,
  ]
  const surface = { [SESSION_A.id]: { session: SESSION_A, capturedThroughSeq: 10, events: surfaceEvents } }
  const logs = { [SESSION_A.id]: { session: SESSION_A, events: logEvents } }
  const { tool } = makeContext({ surface, logs })

  const compacted = await tool('session_digest').execute({ sessionId: SESSION_A.id }, calls)
  assert.equal(compacted.totalMessages, 2)

  const full = await tool('session_digest').execute({ sessionId: SESSION_A.id, scope: 'full' }, calls)
  assert.equal(full.totalMessages, 6)
  assert.equal(full.scope, 'full')
  assert.equal(full.capturedThroughSeq, null)
  assert.ok(full.material[0].text.includes('最早的目标'))
})

test('empty sessions explain themselves instead of returning an empty body', async () => {
  const surface = { [SESSION_A.id]: { session: SESSION_A, capturedThroughSeq: null, events: [] } }
  const { tool } = makeContext({ surface })
  const result = await tool('session_digest').execute({ sessionId: SESSION_A.id }, calls)
  assert.equal(result.totalMessages, 0)
  assert.match(result.note, /scope="full"/)
  assert.ok(result.markdown.includes('> No user/assistant text'))
})

test('session_list filters by cwd, days and query, sorts, marks the current session and reads titles', async () => {
  const records = [
    { header: SESSION_A, live: true, persisted: true },
    { header: SESSION_B, live: false, persisted: true },
    { header: { ...SESSION_B, id: 'session-cccc', cwd: 'D:\\XCR' }, live: true, persisted: true },
  ]
  const { tool } = makeContext({ records })

  const filtered = await tool('session_list').execute({ cwd: 'AI\\' }, calls)
  assert.equal(filtered.total, 2)
  assert.equal(filtered.returned, 2)

  const newest = await tool('session_list').execute({ limit: 2 }, calls)
  assert.deepEqual(newest.sessions.map(item => item.sessionId), [SESSION_B.id, 'session-cccc'])

  const self = await tool('session_list').execute({}, calls)
  assert.equal(self.sessions.some(item => item.self === true), false)
  assert.equal(self.sessions[0].sameWorkspace, true)
  assert.equal(self.sessions.find(item => item.sessionId === SESSION_A.id).title, '记忆库索引讨论')

  const byQuery = await tool('session_list').execute({ query: 'aaaa' }, calls)
  assert.equal(byQuery.total, 1)
  assert.equal(byQuery.sessions[0].sessionId, SESSION_A.id)

  const recent = await tool('session_list').execute({ days: 30 }, calls)
  assert.equal(recent.total, 0)
})

test('digest requires a sessionId and reports unreadable sessions', async () => {
  const { tool } = makeContext({})
  await assert.rejects(() => tool('session_digest').execute({}, calls), /sessionId is required/)
  await assert.rejects(
    () => tool('session_digest').execute({ sessionId: 'session-missing' }, calls),
    /cannot read session session-missing/,
  )
})
