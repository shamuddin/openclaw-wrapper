import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyReply } from 'fastify';
import { startLiveChannelTriggerBridge } from './channel-trigger-bridge.js';
import { startCronJobService } from './cron-job-service.js';
import { getDb } from './db/client.js';
import { reconcilePublishedFlowCronJobs } from './flow-cron-jobs.js';
import { env } from './env.js';
import {
  FLOW_TRIGGER_SECRET_HEADER,
  FlowTriggerSecurityError,
  authorizeFlowTriggerRequest,
} from './flow-trigger-security.js';
import { getGatewayConnectionManager } from './gateway-manager.js';
import { appRouter } from './routers/index.js';
import {
  RunLaunchError,
  executeRunInBackground,
  getRunLaunchErrorHttpStatus,
  startPublishedFlowRun,
} from './run-service.js';
import { createContext } from './trpc.js';
import { startWaitResumeService } from './wait-resume-service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function readTriggerSecret(headers: Record<string, unknown>): string | undefined {
  const explicitSecret = readHeader(headers, FLOW_TRIGGER_SECRET_HEADER);
  if (explicitSecret) return explicitSecret;

  const authorization = readHeader(headers, 'authorization');
  if (!authorization) return undefined;

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}

function sendTriggerSecurityError(reply: FastifyReply, error: FlowTriggerSecurityError) {
  switch (error.code) {
    case 'FLOW_NOT_FOUND':
      return reply.code(404).send({
        ok: false,
        error: 'flow_not_found',
        message: error.message,
      });
    case 'SECRET_NOT_CONFIGURED':
      return reply.code(412).send({
        ok: false,
        error: 'trigger_secret_not_configured',
        message: error.message,
      });
    case 'MISSING_SECRET':
      return reply.code(401).send({
        ok: false,
        error: 'missing_trigger_secret',
        message: error.message,
      });
    case 'INVALID_SECRET':
      return reply.code(401).send({
        ok: false,
        error: 'invalid_trigger_secret',
        message: error.message,
      });
    case 'SECRET_STORE_UNAVAILABLE':
      return reply.code(500).send({
        ok: false,
        error: 'trigger_secret_unavailable',
        message: error.message,
      });
  }
}

async function main() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    maxParamLength: 5_000,
  });

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }: { path?: string; error: Error }) {
        app.log.error({ path, err: error }, 'trpc error');
      },
    },
  });

  app.get('/health', async () => {
    return {
      ok: true,
      gatewayConnected: getGatewayConnectionManager().peekClient()?.isConnected() ?? false,
    };
  });

  app.get<{ Params: { deliveryId: string } }>(
    '/auth/outbox/:deliveryId',
    async (request, reply) => {
      const delivery = await getDb().query.emailDeliveries.findFirst({
        where: (table, { eq }) => eq(table.id, request.params.deliveryId),
      });

      if (!delivery) {
        return reply.code(404).type('text/plain').send('Email delivery not found');
      }

      return reply.type('text/html').send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${delivery.subject}</title>
          <style>
            body { font-family: sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
            pre { white-space: pre-wrap; background: #f5f5f5; padding: 12px; border-radius: 12px; }
            .meta { color: #666; font-size: 13px; margin-bottom: 16px; }
          </style>
        </head>
        <body>
          <h1>${delivery.subject}</h1>
          <div class="meta">To: ${delivery.toEmail} | Template: ${delivery.template}</div>
          ${
            delivery.htmlBody
              ? `<div>${delivery.htmlBody}</div>`
              : `<pre>${delivery.textBody}</pre>`
          }
          <hr />
          <pre>${delivery.textBody}</pre>
        </body>
      </html>
    `);
    },
  );

  app.post<{ Params: { flowId: string }; Body: unknown }>(
    '/webhooks/flows/:flowId',
    async (request, reply) => {
      if (!UUID.test(request.params.flowId)) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_flow_id',
          message: 'flowId must be a UUID',
        });
      }

      try {
        const authorizedFlow = await authorizeFlowTriggerRequest(
          getDb(),
          request.params.flowId,
          readTriggerSecret(request.headers),
        );
        const run = await startPublishedFlowRun(getDb(), {
          flowId: request.params.flowId,
          workspaceId: authorizedFlow.workspaceId,
          trigger: {
            type: 'webhook',
            label: 'Flow webhook',
            eventName: readHeader(request.headers, 'x-openclaw-event'),
            sourceId: readHeader(request.headers, 'x-openclaw-source-id') ?? request.ip,
          },
          input: request.body,
        });
        executeRunInBackground(getDb(), run.id, app.log);

        return reply.code(202).send({ ok: true, run });
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          return sendTriggerSecurityError(reply, error);
        }
        if (error instanceof RunLaunchError) {
          return reply.code(getRunLaunchErrorHttpStatus(error)).send({
            ok: false,
            error: error.code.toLowerCase(),
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { flowId: string; channelType: string }; Body: unknown }>(
    '/events/channels/:channelType/flows/:flowId',
    async (request, reply) => {
      if (!UUID.test(request.params.flowId)) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_flow_id',
          message: 'flowId must be a UUID',
        });
      }

      const channelType = request.params.channelType.trim();
      if (!channelType) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_channel_type',
          message: 'channelType is required',
        });
      }

      try {
        const authorizedFlow = await authorizeFlowTriggerRequest(
          getDb(),
          request.params.flowId,
          readTriggerSecret(request.headers),
        );
        const run = await startPublishedFlowRun(getDb(), {
          flowId: request.params.flowId,
          workspaceId: authorizedFlow.workspaceId,
          trigger: {
            type: 'channel',
            label: 'Channel event',
            channel: channelType,
            eventName: readHeader(request.headers, 'x-openclaw-event'),
            routeKey: readHeader(request.headers, 'x-openclaw-route-key'),
            accountId: readHeader(request.headers, 'x-openclaw-account-id'),
            sourceId: readHeader(request.headers, 'x-openclaw-source-id') ?? request.ip,
          },
          input: request.body,
        });
        executeRunInBackground(getDb(), run.id, app.log);

        return reply.code(202).send({ ok: true, run });
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          return sendTriggerSecurityError(reply, error);
        }
        if (error instanceof RunLaunchError) {
          return reply.code(getRunLaunchErrorHttpStatus(error)).send({
            ok: false,
            error: error.code.toLowerCase(),
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { flowId: string }; Body: unknown }>(
    '/events/cron/flows/:flowId',
    async (request, reply) => {
      if (!UUID.test(request.params.flowId)) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_flow_id',
          message: 'flowId must be a UUID',
        });
      }

      const schedule = readHeader(request.headers, 'x-openclaw-cron');
      if (!schedule) {
        return reply.code(400).send({
          ok: false,
          error: 'missing_cron_schedule',
          message: 'x-openclaw-cron header is required',
        });
      }

      try {
        const authorizedFlow = await authorizeFlowTriggerRequest(
          getDb(),
          request.params.flowId,
          readTriggerSecret(request.headers),
        );
        const run = await startPublishedFlowRun(getDb(), {
          flowId: request.params.flowId,
          workspaceId: authorizedFlow.workspaceId,
          trigger: {
            type: 'cron',
            label: 'Cron event',
            schedule,
            timezone: readHeader(request.headers, 'x-openclaw-timezone') ?? 'UTC',
            sourceId: readHeader(request.headers, 'x-openclaw-source-id') ?? request.id,
          },
          input: request.body,
        });
        executeRunInBackground(getDb(), run.id, app.log);

        return reply.code(202).send({ ok: true, run });
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          return sendTriggerSecurityError(reply, error);
        }
        if (error instanceof RunLaunchError) {
          return reply.code(getRunLaunchErrorHttpStatus(error)).send({
            ok: false,
            error: error.code.toLowerCase(),
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { flowId: string; hookName: string }; Body: unknown }>(
    '/events/hooks/:hookName/flows/:flowId',
    async (request, reply) => {
      if (!UUID.test(request.params.flowId)) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_flow_id',
          message: 'flowId must be a UUID',
        });
      }

      const hookName = request.params.hookName.trim();
      if (!hookName) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_hook_name',
          message: 'hookName is required',
        });
      }

      try {
        const authorizedFlow = await authorizeFlowTriggerRequest(
          getDb(),
          request.params.flowId,
          readTriggerSecret(request.headers),
        );
        const run = await startPublishedFlowRun(getDb(), {
          flowId: request.params.flowId,
          workspaceId: authorizedFlow.workspaceId,
          trigger: {
            type: 'hook',
            label: 'Hook event',
            hookName,
            filter: readHeader(request.headers, 'x-openclaw-hook-filter'),
            sourceId: readHeader(request.headers, 'x-openclaw-source-id') ?? request.id,
          },
          input: request.body,
        });
        executeRunInBackground(getDb(), run.id, app.log);

        return reply.code(202).send({ ok: true, run });
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          return sendTriggerSecurityError(reply, error);
        }
        if (error instanceof RunLaunchError) {
          return reply.code(getRunLaunchErrorHttpStatus(error)).send({
            ok: false,
            error: error.code.toLowerCase(),
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { flowId: string; taskType: string }; Body: unknown }>(
    '/events/tasks/:taskType/flows/:flowId',
    async (request, reply) => {
      if (!UUID.test(request.params.flowId)) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_flow_id',
          message: 'flowId must be a UUID',
        });
      }

      const taskType = request.params.taskType.trim();
      if (!taskType) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_task_type',
          message: 'taskType is required',
        });
      }

      try {
        const authorizedFlow = await authorizeFlowTriggerRequest(
          getDb(),
          request.params.flowId,
          readTriggerSecret(request.headers),
        );
        const run = await startPublishedFlowRun(getDb(), {
          flowId: request.params.flowId,
          workspaceId: authorizedFlow.workspaceId,
          trigger: {
            type: 'task',
            label: 'Task event',
            taskType,
            taskQueue: readHeader(request.headers, 'x-openclaw-task-queue'),
            taskPriority: readHeader(request.headers, 'x-openclaw-task-priority'),
            sourceId: readHeader(request.headers, 'x-openclaw-source-id') ?? request.id,
          },
          input: request.body,
        });
        executeRunInBackground(getDb(), run.id, app.log);

        return reply.code(202).send({ ok: true, run });
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          return sendTriggerSecurityError(reply, error);
        }
        if (error instanceof RunLaunchError) {
          return reply.code(getRunLaunchErrorHttpStatus(error)).send({
            ok: false,
            error: error.code.toLowerCase(),
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { flowId: string; standingOrderKey: string }; Body: unknown }>(
    '/events/standing-orders/:standingOrderKey/flows/:flowId',
    async (request, reply) => {
      if (!UUID.test(request.params.flowId)) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_flow_id',
          message: 'flowId must be a UUID',
        });
      }

      const standingOrderKey = request.params.standingOrderKey.trim();
      if (!standingOrderKey) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_standing_order_key',
          message: 'standingOrderKey is required',
        });
      }

      try {
        const authorizedFlow = await authorizeFlowTriggerRequest(
          getDb(),
          request.params.flowId,
          readTriggerSecret(request.headers),
        );
        const run = await startPublishedFlowRun(getDb(), {
          flowId: request.params.flowId,
          workspaceId: authorizedFlow.workspaceId,
          trigger: {
            type: 'standing-order',
            label: 'Standing-order event',
            standingOrderKey,
            standingOrderScope: readHeader(request.headers, 'x-openclaw-standing-order-scope'),
            sourceId: readHeader(request.headers, 'x-openclaw-source-id') ?? request.id,
          },
          input: request.body,
        });
        executeRunInBackground(getDb(), run.id, app.log);

        return reply.code(202).send({ ok: true, run });
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          return sendTriggerSecurityError(reply, error);
        }
        if (error instanceof RunLaunchError) {
          return reply.code(getRunLaunchErrorHttpStatus(error)).send({
            ok: false,
            error: error.code.toLowerCase(),
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  startLiveChannelTriggerBridge({ db: getDb(), logger: app.log });
  await reconcilePublishedFlowCronJobs({ db: getDb(), logger: app.log });
  startCronJobService({ db: getDb(), logger: app.log });
  startWaitResumeService({ db: getDb(), logger: app.log });

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`adapter listening on http://${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
