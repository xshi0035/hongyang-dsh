import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePaymentImageExtraction, registerPaymentFromImage } from '../src/provider/register/image.ts'

void test('provider validates image payee before registering extracted fields', () => {
  assert.throws(() => registerPaymentFromImage({} as never, {
    amountText: '500元',
    payee: '其他公司',
  }, { companyName: '衡阳诚远商业管理有限公司' }), /收款方/)
})

void test('parses only the structured extraction contract', () => {
  assert.deepEqual(parsePaymentImageExtraction('{"amountText":"500元","merchantText":"围辣转转火锅","feeText":"电费"}'), {
    amountText: '500元', merchantText: '围辣转转火锅', feeText: '电费',
  })
  assert.throws(() => parsePaymentImageExtraction('{"amountText":500}'))
})
