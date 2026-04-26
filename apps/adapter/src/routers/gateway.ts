import { type Static, Type } from '@sinclair/typebox';
import { requireWorkspaceRole } from '../access-control.js';
import { getGatewayConnectionManager } from '../gateway-manager.js';
import { authenticatedProcedure, router } from '../trpc.js';
import { parse } from '../validate.js';

const GatewaySettingsInput = Type.Object({
  url: Type.String({ minLength: 1 }),
  token: Type.Optional(Type.String()),
  bootstrapToken: Type.Optional(Type.String()),
  deviceToken: Type.Optional(Type.String()),
  password: Type.Optional(Type.String()),
});

type GatewaySettingsInput = Static<typeof GatewaySettingsInput>;

export const gatewayRouter = router({
  settings: authenticatedProcedure.query(async ({ ctx }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Viewing gateway settings');
    return getGatewayConnectionManager().getSettings();
  }),

  saveSettings: authenticatedProcedure
    .input(parse(GatewaySettingsInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Updating gateway settings');
      return getGatewayConnectionManager().updateSettings(input);
    }),

  status: authenticatedProcedure.query(async () => {
    return getGatewayConnectionManager().probeStatus();
  }),
});
