import { TRPCError } from '@trpc/server';
import { Type } from '@sinclair/typebox';
import { requireWorkspaceRole } from '../access-control.js';
import {
  YouTubeWebSubError,
  getYouTubeOverview,
  setYouTubeSubscriptionFlow,
  startYouTubeVideoArticleRun,
  subscribeYouTubeChannel,
  unsubscribeYouTubeChannel,
} from '../youtube-service.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const Uuid = Type.String({ format: 'uuid', minLength: 36, maxLength: 36 });

const SubscribeInput = Type.Object({
  profileId: Uuid,
  channelRef: Type.String({ minLength: 1, maxLength: 200 }),
  leaseSeconds: Type.Optional(Type.Integer({ minimum: 3_600, maximum: 864_000 })),
});

const SubscriptionIdInput = Type.Object({
  id: Uuid,
});

const LinkFlowInput = Type.Object({
  id: Uuid,
  flowId: Type.Optional(Uuid),
});

const ManualRunInput = Type.Object({
  flowId: Uuid,
  videoUrl: Type.String({ minLength: 1, maxLength: 500 }),
});

function rethrowYouTubeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof YouTubeWebSubError) {
    switch (error.code) {
      case 'SUBSCRIPTION_NOT_FOUND':
      case 'CHANNEL_NOT_FOUND':
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      case 'HUB_REJECTED':
      case 'TOPIC_MISMATCH':
      case 'MISSING_CHALLENGE':
      case 'INVALID_SIGNATURE':
      case 'INVALID_VIDEO':
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      case 'FLOW_NOT_FOUND':
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      case 'FLOW_NOT_PUBLISHED':
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
    }
  }
  if (error instanceof Error) {
    if (
      error.message.includes('relation "youtube_subscriptions" does not exist') ||
      error.message.includes("relation 'youtube_subscriptions' does not exist") ||
      error.message.includes('relation "youtube_video_ingestions" does not exist') ||
      error.message.includes("relation 'youtube_video_ingestions' does not exist")
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'YouTube automation storage is not set up yet. Run `pnpm db:migrate`, then try again.',
      });
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'unexpected YouTube error' });
}

export const youtubeRouter = router({
  overview: workspaceProcedure.query(async ({ ctx }) => {
    try {
      return await getYouTubeOverview(ctx.db, ctx.workspace.id);
    } catch (error) {
      rethrowYouTubeError(error);
    }
  }),

  subscribe: workspaceProcedure.input(parse(SubscribeInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Subscribing YouTube channels');
    try {
      return await subscribeYouTubeChannel(ctx.db, ctx.workspace.id, input);
    } catch (error) {
      rethrowYouTubeError(error);
    }
  }),

  renew: workspaceProcedure.input(parse(SubscriptionIdInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Renewing YouTube subscriptions');
    const overview = await getYouTubeOverview(ctx.db, ctx.workspace.id);
    const subscription = overview.subscriptions.find((entry) => entry.id === input.id);
    if (!subscription?.channelProfileId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Subscription must be linked to a YouTube profile before it can be renewed.',
      });
    }

    try {
      return await subscribeYouTubeChannel(ctx.db, ctx.workspace.id, {
        profileId: subscription.channelProfileId,
        channelRef: subscription.channelHandle ?? subscription.channelId,
      });
    } catch (error) {
      rethrowYouTubeError(error);
    }
  }),

  unsubscribe: workspaceProcedure
    .input(parse(SubscriptionIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Disabling YouTube subscriptions');
      try {
        return await unsubscribeYouTubeChannel(ctx.db, ctx.workspace.id, input.id);
      } catch (error) {
        rethrowYouTubeError(error);
      }
    }),

  linkFlow: workspaceProcedure.input(parse(LinkFlowInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Linking YouTube subscriptions to flows');
    try {
      return await setYouTubeSubscriptionFlow(ctx.db, ctx.workspace.id, {
        subscriptionId: input.id,
        ...(input.flowId ? { flowId: input.flowId } : {}),
      });
    } catch (error) {
      rethrowYouTubeError(error);
    }
  }),

  runVideoUrl: workspaceProcedure.input(parse(ManualRunInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Running YouTube video article flows');
    try {
      return await startYouTubeVideoArticleRun(ctx.db, ctx.workspace.id, input);
    } catch (error) {
      rethrowYouTubeError(error);
    }
  }),
});
