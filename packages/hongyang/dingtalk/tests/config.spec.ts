import { describe, expect, it } from 'vitest'
import { dingtalkConfigFromEnv } from '../src/stream-client.ts'

describe('dingtalkConfigFromEnv', () => {
  it('leaves DingTalk disabled when credentials are missing', () => {
    expect(dingtalkConfigFromEnv({})).toBeUndefined()
  })

  it('reads credentials from the deployment environment only', () => {
    expect(dingtalkConfigFromEnv({ DINGTALK_CLIENT_ID: ' app ', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_DEBUG: '1' })).toEqual({
      clientId: 'app',
      clientSecret: 'secret',
      debug: true,
    })
  })
})
