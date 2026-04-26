import { FormatRegistry } from '@sinclair/typebox';

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (v) => ISO_DATE_TIME.test(v));
}
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (v) => UUID.test(v));
}
