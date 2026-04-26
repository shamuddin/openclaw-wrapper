import { ping } from '@openclaw-wrapper/openclaw-client';
import { authenticatedProcedure, router } from '../trpc.js';

export const pingRouter = router({
  gateway: authenticatedProcedure.mutation(async ({ ctx }) => {
    return ping(ctx.openclaw);
  }),
});
