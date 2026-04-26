import { eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { emailDeliveries } from './db/schema.js';
import { env } from './env.js';

export interface EmailDeliveryResult {
  deliveryId: string;
  mode: 'outbox' | 'webhook';
  previewUrl?: string;
}

function getDeliveryMode(): 'outbox' | 'webhook' {
  return env.EMAIL_DELIVERY_MODE === 'webhook' ? 'webhook' : 'outbox';
}

export async function sendTransactionalEmail(params: {
  db: Db;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  template: string;
  metadata?: Record<string, unknown>;
}): Promise<EmailDeliveryResult> {
  const now = new Date();
  const mode = getDeliveryMode();
  const [delivery] = await params.db
    .insert(emailDeliveries)
    .values({
      toEmail: params.toEmail.trim(),
      subject: params.subject,
      textBody: params.textBody,
      htmlBody: params.htmlBody,
      template: params.template,
      provider: mode,
      status: 'queued',
      metadata: params.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!delivery) {
    throw new Error('email delivery create failed');
  }

  if (mode === 'webhook') {
    if (!env.EMAIL_WEBHOOK_URL) {
      throw new Error('EMAIL_WEBHOOK_URL is required when EMAIL_DELIVERY_MODE=webhook');
    }

    const response = await fetch(env.EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.EMAIL_WEBHOOK_AUTH ? { authorization: `Bearer ${env.EMAIL_WEBHOOK_AUTH}` } : {}),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: params.toEmail.trim(),
        subject: params.subject,
        text: params.textBody,
        html: params.htmlBody,
        template: params.template,
        metadata: params.metadata ?? null,
      }),
    });

    if (!response.ok) {
      const errorMessage = `email webhook failed with ${response.status}`;
      await params.db
        .update(emailDeliveries)
        .set({
          status: 'failed',
          error: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(emailDeliveries.id, delivery.id));
      throw new Error(errorMessage);
    }

    const payload = (await response.json().catch(() => ({}))) as { messageId?: string };
    await params.db
      .update(emailDeliveries)
      .set({
        status: 'sent',
        providerMessageId: payload.messageId ?? null,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailDeliveries.id, delivery.id));

    return {
      deliveryId: delivery.id,
      mode,
    };
  }

  await params.db
    .update(emailDeliveries)
    .set({
      status: 'sent',
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(emailDeliveries.id, delivery.id));

  return {
    deliveryId: delivery.id,
    mode,
    previewUrl: `${env.ADAPTER_BASE_URL}/auth/outbox/${delivery.id}`,
  };
}
