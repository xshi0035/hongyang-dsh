import assert from 'node:assert/strict'
import test from 'node:test'
import { cardCallbackResponse, interactiveCardRequestBody, parseDingtalkCardCallback, sendDingtalkInteractiveCard, updateDingtalkCard } from '../src/stream-client.ts'

const config = { clientId: 'app', clientSecret: 'secret' }

interface RecordedCall { method: string; url: string; body: Record<string, unknown> }

/** Fetch stub that records every JSON request and answers the token endpoint. */
function recordingFetch(): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
  const calls: RecordedCall[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ method: init?.method ?? 'GET', url, body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown> })
    if (url.endsWith('/accessToken')) return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 })
    return new Response('{}', { status: 200 })
  }
  return { calls, fetchImpl }
}

void test('single-chat cards use the IM_ROBOT space with the robot deliver model', () => {
  const body = interactiveCardRequestBody(config, {
    templateId: 'tpl.schema', outTrackId: 'hy-1', userId: 'staff1', conversationId: 'cid1', conversationType: 'single',
    cardData: { summary: 's', merchantList: '[]' }, callbackRouteKey: 'route',
  })
  assert.deepEqual(body, {
    cardTemplateId: 'tpl.schema',
    outTrackId: 'hy-1',
    callbackType: 'STREAM',
    callbackRouteKey: 'route',
    cardData: { cardParamMap: { summary: 's', merchantList: '[]' } },
    userIdType: 1,
    openSpaceId: 'dtv1.card//IM_ROBOT.staff1',
    imRobotOpenSpaceModel: { supportForward: true },
    imRobotOpenDeliverModel: { spaceType: 'IM_ROBOT', robotCode: 'app' },
  })
})

void test('group cards address the conversation through the IM_GROUP space', () => {
  const body = interactiveCardRequestBody(config, { templateId: 't', outTrackId: 'hy-2', userId: 'staff1', conversationId: 'cidG', conversationType: 'group', cardData: {} })
  assert.equal(body.openSpaceId, 'dtv1.card//IM_GROUP.cidG')
  assert.deepEqual(body.imGroupOpenDeliverModel, { robotCode: 'app' })
  assert.equal(body.imRobotOpenDeliverModel, undefined)
  assert.equal(body.callbackRouteKey, undefined)
})

void test('card delivery posts the body with the access token and surfaces the API error text', async () => {
  const calls: { url: string; body: string; token: string | undefined }[] = []
  let status = 200
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers)
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '', token: headers.get('x-acs-dingtalk-access-token') ?? undefined })
    if (url.endsWith('/accessToken')) return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 })
    return new Response(JSON.stringify({ code: 'param.invalid', message: 'spaces of card is empty' }), { status })
  }
  const options = { templateId: 't', outTrackId: 'hy-3', userId: 'staff1', cardData: { summary: 's' } }
  await sendDingtalkInteractiveCard(config, options, fetchImpl)
  assert.deepEqual(calls.map(call => call.url), ['https://api.dingtalk.com/v1.0/oauth2/accessToken', 'https://api.dingtalk.com/v1.0/card/instances/createAndDeliver'])
  assert.equal(calls[1]?.token, 'token')
  assert.equal((JSON.parse(calls[1]?.body ?? '{}') as { openSpaceId: string }).openSpaceId, 'dtv1.card//IM_ROBOT.staff1')
  status = 400
  await assert.rejects(sendDingtalkInteractiveCard(config, options, fetchImpl), /400 .*spaces of card is empty/)
})

void test('AI-card delivery starts processing, streams the final text, and marks the card finished', async () => {
  const { calls, fetchImpl } = recordingFetch()
  await sendDingtalkInteractiveCard(config, {
    templateId: 't', outTrackId: 'hy-4', userId: 'staff1', cardData: { summary: 's', content: 'c' }, streaming: { key: 'content', content: 'c' },
  }, fetchImpl)
  assert.deepEqual(calls.map(call => [call.method, call.url]), [
    ['POST', 'https://api.dingtalk.com/v1.0/oauth2/accessToken'],
    ['POST', 'https://api.dingtalk.com/v1.0/card/instances/createAndDeliver'],
    ['PUT', 'https://api.dingtalk.com/v1.0/card/streaming'],
    ['PUT', 'https://api.dingtalk.com/v1.0/card/instances'],
  ])
  assert.deepEqual((calls[1]?.body.cardData as { cardParamMap: Record<string, string> }).cardParamMap, { summary: 's', content: 'c', flowStatus: '1' })
  const streaming = calls[2]?.body ?? {}
  assert.equal(streaming.outTrackId, 'hy-4')
  assert.equal(streaming.key, 'content')
  assert.equal(streaming.content, 'c')
  assert.deepEqual([streaming.isFull, streaming.isFinalize, streaming.isError], [true, true, false])
  assert.equal(typeof streaming.guid, 'string')
  assert.deepEqual(calls[3]?.body, { outTrackId: 'hy-4', cardData: { cardParamMap: { flowStatus: '3' } }, cardUpdateOptions: { updateCardDataByKey: true } })
})

void test('post-click card updates stream the new content, then rewrite the other variables and finish', async () => {
  const { calls, fetchImpl } = recordingFetch()
  await updateDingtalkCard(config, 'hy-5', { cardParamMap: { content: '已登记', summary: '已登记', merchantList: '[]' } }, fetchImpl)
  assert.deepEqual(calls.map(call => [call.method, call.url]), [
    ['POST', 'https://api.dingtalk.com/v1.0/oauth2/accessToken'],
    ['PUT', 'https://api.dingtalk.com/v1.0/card/streaming'],
    ['PUT', 'https://api.dingtalk.com/v1.0/card/instances'],
  ])
  assert.equal(calls[1]?.body.content, '已登记')
  assert.deepEqual(calls[2]?.body, {
    outTrackId: 'hy-5', cardData: { cardParamMap: { summary: '已登记', merchantList: '[]', flowStatus: '3' } }, cardUpdateOptions: { updateCardDataByKey: true },
  })
  calls.length = 0
  await updateDingtalkCard(config, 'hy-6', { cardParamMap: { summary: '仅摘要' } }, fetchImpl)
  assert.deepEqual(calls.map(call => call.url), ['https://api.dingtalk.com/v1.0/oauth2/accessToken', 'https://api.dingtalk.com/v1.0/card/instances'])
  assert.deepEqual((calls[1]?.body.cardData as { cardParamMap: Record<string, string> }).cardParamMap, { summary: '仅摘要' })
})

void test('card callbacks expose the pressed button parameters and the instance id', () => {
  const data = JSON.stringify({
    outTrackId: 'hy-9', userId: 'staff1', userIdType: 1, spaceType: 'IM_ROBOT', spaceId: 'staff1', corpId: 'corp',
    content: JSON.stringify({ cardPrivateData: { actionIds: ['confirm_1'], params: { action: 'confirm', shopNo: '3F-3032' } } }),
    extension: '{}',
  })
  const callback = parseDingtalkCardCallback('frame1', data)
  assert.equal(callback.deliveryId, 'frame1')
  assert.equal(callback.outTrackId, 'hy-9')
  assert.equal(callback.userId, 'staff1')
  assert.equal(callback.spaceType, 'IM_ROBOT')
  assert.deepEqual(callback.params, { action: 'confirm', shopNo: '3F-3032' })
  assert.deepEqual(callback.actionIds, ['confirm_1'])
  const malformed = parseDingtalkCardCallback('frame2', JSON.stringify({ outTrackId: 'hy-10', content: 'not json' }))
  assert.deepEqual([malformed.outTrackId, malformed.params, malformed.actionIds, malformed.userId], ['hy-10', {}, [], undefined])
  assert.deepEqual(cardCallbackResponse({ cardParamMap: { summary: '已登记' } }), {
    cardUpdateOptions: { updateCardDataByKey: true },
    cardData: { cardParamMap: { summary: '已登记' } },
  })
})
