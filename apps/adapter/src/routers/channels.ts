import { Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { requireWorkspaceRole } from '../access-control.js';
import {
  applyChannelProfile,
  deleteChannelProfile,
  getChannelProfile,
  listChannelProfiles,
  loadChannelCatalog,
  logoutChannelProfile,
  saveChannelProfile,
  sendChannelProfileTest,
  startChannelProfilePairing,
  testTranscriptApiProfile,
  waitForChannelProfilePairing,
} from '../channel-profiles.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';
import { testYouTubeProfile } from '../youtube-service.js';

const Uuid = Type.String({ format: 'uuid', minLength: 36, maxLength: 36 });

const ChannelProfileIdInput = Type.Object({
  id: Uuid,
});

const ChannelProfileSaveInput = Type.Object({
  id: Type.Optional(Uuid),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  templateId: Type.String({ minLength: 1, maxLength: 120 }),
  channelType: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  accountId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  routeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  defaultTarget: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  secrets: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const ChannelProfilePairingInput = Type.Object({
  id: Uuid,
  force: Type.Optional(Type.Boolean()),
});

const ChannelProfileTestSendInput = Type.Object({
  id: Uuid,
  to: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  message: Type.String({ minLength: 1, maxLength: 4_000 }),
  threadId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

function rethrowChannelError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof Error) {
    if (
      error.message.includes('relation "channel_profiles" does not exist') ||
      error.message.includes("relation 'channel_profiles' does not exist")
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Channel storage is not set up yet. Run `pnpm db:migrate` once, then try again.',
      });
    }
    if (error.message.includes('not found')) {
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'unexpected channel error' });
}

export const channelsRouter = router({
  catalog: workspaceProcedure.query(async () => {
    return loadChannelCatalog();
  }),

  list: workspaceProcedure.query(async ({ ctx }) => {
    return listChannelProfiles(ctx.db, ctx.workspace.id);
  }),

  get: workspaceProcedure.input(parse(ChannelProfileIdInput)).query(async ({ ctx, input }) => {
    const profile = await getChannelProfile(ctx.db, input.id, ctx.workspace.id);
    if (!profile) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel profile not found' });
    }
    return profile;
  }),

  save: workspaceProcedure
    .input(parse(ChannelProfileSaveInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Saving channel profiles');
      try {
        return await saveChannelProfile(ctx.db, input, ctx.workspace.id);
      } catch (error) {
        rethrowChannelError(error);
      }
    }),

  applyProfile: workspaceProcedure
    .input(parse(ChannelProfileIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Setting preferred channel profiles');
      const profile = await applyChannelProfile(ctx.db, input.id, ctx.workspace.id);
      if (!profile) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel profile not found' });
      }
      return profile;
    }),

  delete: workspaceProcedure
    .input(parse(ChannelProfileIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Deleting channel profiles');
      const deleted = await deleteChannelProfile(ctx.db, input.id, ctx.workspace.id);
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel profile not found' });
      }
      return { ok: true as const, id: input.id };
    }),

  pairingStart: workspaceProcedure
    .input(parse(ChannelProfilePairingInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Starting channel pairing');
      try {
        return await startChannelProfilePairing(ctx.db, input.id, ctx.workspace.id, input.force);
      } catch (error) {
        rethrowChannelError(error);
      }
    }),

  pairingWait: workspaceProcedure
    .input(parse(ChannelProfileIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Waiting for channel pairing');
      try {
        return await waitForChannelProfilePairing(ctx.db, input.id, ctx.workspace.id);
      } catch (error) {
        rethrowChannelError(error);
      }
    }),

  logout: workspaceProcedure
    .input(parse(ChannelProfileIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Logging out channels');
      try {
        await logoutChannelProfile(ctx.db, input.id, ctx.workspace.id);
        return { ok: true as const, id: input.id };
      } catch (error) {
        rethrowChannelError(error);
      }
    }),

  testSend: workspaceProcedure
    .input(parse(ChannelProfileTestSendInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Sending test messages');
      try {
        return await sendChannelProfileTest(ctx.db, input, ctx.workspace.id);
      } catch (error) {
        rethrowChannelError(error);
      }
    }),

  testYouTube: workspaceProcedure
    .input(parse(ChannelProfileIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Testing YouTube API profiles');
      try {
        return await testYouTubeProfile(ctx.db, input.id, ctx.workspace.id);
      } catch (error) {
        rethrowChannelError(error);
      }
    }),

  testTranscriptApi: workspaceProcedure
    .input(parse(ChannelProfileIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Testing TranscriptAPI profiles');
      try {
        return await testTranscriptApiProfile(ctx.db, input.id, ctx.workspace.id);
      } catch (error) {
        rethrowChannelError(error);
      }
    }),
});
