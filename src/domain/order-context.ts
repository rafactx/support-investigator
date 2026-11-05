import { z } from 'zod';
import type { RawOrder } from './order-record.ts';

/**
 * `get_order_context`'s normalized, PII-free output. Never carries name,
 * email, phone, address, documents, tokens, or payment detail — see
 * `toOrderContext` below, which is the single place that boundary is
 * enforced (CONTEXT.md).
 */
export const OrderContextSchema = z.object({
  orderId: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  invoiceStatus: z.enum(['invoiced', 'pending']),
  timeline: z.array(
    z.object({
      status: z.string(),
      date: z.string(),
    })
  ),
  warnings: z.array(z.string()),
});

export type OrderContext = z.infer<typeof OrderContextSchema>;

/**
 * Maps a raw platform order (provider-shaped, carries PII) to the PII-free
 * `OrderContext` the Support MCP tool returns. This is the only place PII
 * stripping happens — everything downstream of this function never sees
 * `customer`, `shippingAddress`, or payment-instrument detail.
 */
export function toOrderContext(raw: RawOrder): OrderContext {
  const firstPayment = raw.payments[0];
  const paymentStatus = firstPayment?.status ?? 'unknown';
  const invoiceStatus = raw.shipments.some((shipment) => shipment.invoice)
    ? 'invoiced'
    : 'pending';

  const warnings: string[] = [];
  if (paymentStatus === 'denied') {
    warnings.push('payment-denied');
  }
  if (raw.status === 'canceled') {
    warnings.push('order-canceled');
  }

  return {
    orderId: raw.id,
    status: raw.status,
    paymentStatus,
    invoiceStatus,
    timeline: raw.events.map(({ status, at }) => ({ status, date: at })),
    warnings,
  };
}
