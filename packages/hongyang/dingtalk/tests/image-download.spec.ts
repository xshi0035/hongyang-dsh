import { expect, it } from 'vitest'
import { createDingtalkImageDownloader } from '../src/stream-client.ts'

it('downloads a DingTalk image through the token and message-file APIs', async () => {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, _init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    if (url.endsWith('/accessToken')) return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 })
    if (url.endsWith('/messageFiles/download')) return new Response(JSON.stringify({ downloadUrl: 'https://img.test/file' }), { status: 200 })
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const downloader = createDingtalkImageDownloader({ clientId: 'app', clientSecret: 'secret' }, fetchImpl)
  expect(await downloader.download('code')).toBe('data:image/png;base64,AQID')
  expect(calls).toEqual([
    'https://api.dingtalk.com/v1.0/oauth2/accessToken',
    'https://api.dingtalk.com/v1.0/robot/messageFiles/download',
    'https://img.test/file',
  ])
})
