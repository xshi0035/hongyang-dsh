import { parsePaymentImageExtraction, type PaymentImageExtraction } from '@deepseek-ai/dsh-hy-finance'

export interface PaymentVisionRequest {
  readonly imageDataUrl: string
  readonly textHint?: string
}

export interface PaymentVisionClient {
  stream(request: PaymentVisionRequest): AsyncIterable<string>
}

/** Ask a configured vision route for extraction only; finance validates and books it. */
export async function extractPaymentFromImage(client: PaymentVisionClient, request: PaymentVisionRequest): Promise<PaymentImageExtraction> {
  const chunks: string[] = []
  for await (const chunk of client.stream(request)) chunks.push(chunk)
  return parsePaymentImageExtraction(chunks.join(''))
}
