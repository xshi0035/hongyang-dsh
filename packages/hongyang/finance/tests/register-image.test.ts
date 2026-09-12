import assert from 'node:assert/strict'
import test from 'node:test'
import { registerPaymentFromImage } from '../src/provider/register/image.ts'

void test('provider validates image payee before registering extracted fields', () => {
  assert.throws(() => registerPaymentFromImage({} as never, {
    amountText: '500元',
    payee: '其他公司',
  }, { companyName: '衡阳诚远商业管理有限公司' }), /收款方/)
})
