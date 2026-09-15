import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { pendingPayments, decidePayment } from '@deepseek-ai/dsh-hy-finance/src/provider/register/submission.ts'
import * as finance from '@deepseek-ai/dsh-hy-finance'
import { DWClient, TOPIC_CARD, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream'
import * as dingtalk from '../src/index.ts'

await test('Loader entry downloads a robot picture, invokes host vision, and submits on card confirmation and books only after workbench approval', { timeout: 15000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hy-image-composition-'))
  const ctx = new Context()
  const envKeys = ['DINGTALK_CLIENT_ID', 'DINGTALK_CLIENT_SECRET', 'DINGTALK_CARD_TEMPLATE_ID', 'DINGTALK_VISION_PROVIDER', 'DINGTALK_VISION_MODEL']
  const saved = envKeys.map(key => process.env[key])
  const handlers = new Map<string, (value: DWClientDownStream) => void>()
  const frames: Record<string, unknown>[] = []
  const replies: string[] = []
  let acknowledge!: () => void
  let visionCalls = 0
  let connected!: () => void
  const connection = new Promise<void>((resolve) => { connected = resolve })
  class VisionAdapter extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      visionCalls++
      assert.equal(options.provider, 'fixture')
      assert.equal(options.model, 'vision')
      assert.equal(options.messages[0]?.content[1]?.type, 'image')
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ amountText: '200元', payee: '测试公司', paymentDate: '2026-04-03 12:34:56', transactionNo: 'FIXTURE-42' }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  try {
    for (const [i, value] of ['fixture-app', 'fixture-secret', 'fixture-template', 'fixture', 'vision'].entries()) process.env[envKeys[i]!] = value
    t.mock.method(DWClient.prototype, 'registerCallbackListener', function (this: DWClient, topic: string, callback: (value: DWClientDownStream) => void) { handlers.set(topic, callback); return this })
    t.mock.method(DWClient.prototype, 'connect', async function (this: DWClient) { this.connected = true; connected() })
    t.mock.method(DWClient.prototype, 'disconnect', function (this: DWClient) { this.connected = false })
    t.mock.method(DWClient.prototype, 'socketCallBackResponse', () => { acknowledge() })
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      assert.ok(typeof init?.body === 'string' || url.endsWith('/image'))
      const body = typeof init?.body === 'string' ? init.body : '{}'
      if (url.endsWith('/accessToken')) return Response.json({ accessToken: 'fixture-token' })
      if (url.endsWith('/messageFiles/download')) {
        assert.deepEqual(JSON.parse(body), { robotCode: 'fixture-app', downloadCode: 'fixture-code' })
        return Response.json({ downloadUrl: 'https://fixture.invalid/image' })
      }
      if (url.endsWith('/image')) return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64'), { headers: { 'content-type': 'image/png' } })
      if (url.endsWith('/reply')) replies.push((JSON.parse(body) as { text: { content: string } }).text.content)
      else frames.push(JSON.parse(body) as Record<string, unknown>)
      return Response.json({})
    })
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: llm', '- name: attachments', '  config:', `    dshHome: ${JSON.stringify(root)}`,
      '- name: vision-fixture', '- name: finance', '  config:', `    dbPath: ${JSON.stringify(join(root, 'finance.db'))}`, '    companyName: 测试公司',
      '- name: dingtalk', '',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['llm', LlmRuntime], ['attachments', LocalAttachmentStore], ['finance', finance], ['dingtalk', dingtalk],
      ['vision-fixture', { name: 'vision-fixture', inject: ['llm'], apply(scope: Context) { scope.llm.registerAdapter(['fixture'], new VisionAdapter()) } }],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) { assert.ok(modules.has(specifier)); return modules.get(specifier) } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    await connection
    const db = ctx.hyFinance.db()
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','商户法人','作业帮')")
    const dispatch = async (topic: string, id: string, data: unknown) => {
      const done = new Promise<void>((resolve) => { acknowledge = resolve })
      handlers.get(topic)!({ headers: { topic, messageId: id }, data: JSON.stringify(data) } as DWClientDownStream)
      await done
    }
    const message = { senderStaffId: 'u', senderId: 'u', conversationId: 'c', sessionWebhook: 'https://fixture.invalid/reply' }
    await dispatch(TOPIC_ROBOT, 'image', { ...message, msgId: 'image', msgtype: 'picture', content: { downloadCode: 'fixture-code' } })
    assert.equal(visionCalls, 1, replies.join('\n'))
    assert.match(replies[0] ?? '', /截图候选金额 200.00/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 0)
    await dispatch(TOPIC_ROBOT, 'text', { ...message, msgId: 'text', msgtype: 'text', text: { content: '作业帮 电费' } })
    const card = frames.find(frame => frame.cardTemplateId === 'fixture-template')!
    assert.ok(card)
    const cardData = card.cardData as { cardParamMap: Record<string, string> }
    assert.deepEqual(cardData, JSON.parse(await readFile(new URL('./expected/image-card.json', import.meta.url), 'utf8')))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
    const callback = { outTrackId: card.outTrackId, userId: 'u', content: { cardPrivateData: { params: { action: 'confirm', shopNo: '3F-3032' } } } }
    await dispatch(TOPIC_CARD, 'click', callback)
    await dispatch(TOPIC_CARD, 'replay', callback)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
    assert.equal(pendingPayments(db).length, 1)
    const submission = pendingPayments(db)[0]!
    decidePayment(db, submission.id, 'approve', { companyName: '测试公司' })
    decidePayment(db, submission.id, 'approve', { companyName: '测试公司' })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 1)
    assert.equal(db.prepare('SELECT txn_no FROM "transaction"').get()?.txn_no, 'FIXTURE-42')
    const activity = db.prepare('SELECT actor_kind,actor FROM activity_log').get()
    assert.equal(activity?.actor_kind, 'dingtalk')
    assert.equal(activity?.actor, 'u')
    assert.equal(db.prepare("SELECT actor_kind FROM activity_log WHERE action = 'approve_payment'").get()?.actor_kind, 'web')
    db.prepare("UPDATE activity_log SET at = ? WHERE action = 'approve_payment'").run('2026-09-15T08:33:55.000Z')
    await dispatch(TOPIC_ROBOT, 'repeat-image', { ...message, msgId: 'repeat-image', msgtype: 'picture', content: { downloadCode: 'fixture-code' } })
    assert.equal(replies.at(-1), (await readFile(new URL('./expected/duplicate-reply.txt', import.meta.url), 'utf8')).trim())
    assert.equal(pendingPayments(db).length, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 1)

  } finally {
    await ctx.fiber.dispose()
    for (const [i, key] of envKeys.entries()) {
      if (saved[i] === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = saved[i]
    }
    await rm(root, { recursive: true, force: true })
  }
})
