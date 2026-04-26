import { Type } from '@sinclair/typebox';
import { installClawHubSkill, searchClawHubSkills } from '../clawhub.js';
import { authenticatedProcedure, router } from '../trpc.js';
import { parse } from '../validate.js';

const SearchSkillsInput = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 120 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
});

const InstallSkillInput = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 120 }),
  version: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
});

export const skillsRouter = router({
  searchCatalog: authenticatedProcedure
    .input(parse(SearchSkillsInput))
    .query(async ({ input }) => searchClawHubSkills(input.query, input.limit ?? 12)),

  installFromCatalog: authenticatedProcedure
    .input(parse(InstallSkillInput))
    .mutation(async ({ input }) => installClawHubSkill(input)),
});
