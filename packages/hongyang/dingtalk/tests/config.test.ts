import assert from 'node:assert/strict'
import test from 'node:test'
import { dingtalkConfigFromEnv } from '../src/stream-client.ts'

void test('missing credentials leave DingTalk disabled', () => {
  assert.equal(dingtalkConfigFromEnv({}), undefined)
})

void test('credentials are read from deployment environment only', () => {
  assert.deepEqual(dingtalkConfigFromEnv({ DINGTALK_CLIENT_ID: ' app ', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_DEBUG: '1' }), {
    clientId: 'app',
    clientSecret: 'secret',
    debug: true,
  })
})
