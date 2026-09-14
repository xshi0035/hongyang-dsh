import { parsePaymentImageExtraction, type PaymentImageExtraction } from '@deepseek-ai/dsh-hy-finance'

/**
 * Payment screenshot data URL with optional accompanying text.
 */
export interface PaymentVisionRequest {
  readonly imageDataUrl: string
  readonly textHint?: string
}

/**
 * Model adapter yielding extraction text for finance field validation.
 */
export interface PaymentVisionClient {
  stream(request: PaymentVisionRequest): AsyncIterable<string>
}

/**
 * Ask a configured vision route for extraction only; finance validates and books it.
 * @param client - Configured screenshot extraction adapter.
 * @param request - Screenshot data URL and optional accompanying text.
 * @returns Validated extraction fields; malformed output rejects.
 */
export async function extractPaymentFromImage(client: PaymentVisionClient, request: PaymentVisionRequest): Promise<PaymentImageExtraction> {
  const chunks: string[] = []
  for await (const chunk of client.stream(request)) chunks.push(chunk)
  return parsePaymentImageExtraction(chunks.join(''))
}
