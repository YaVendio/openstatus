import { locales } from "@openstatus/locales";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import {
  statusReport,
  statusReportStatus,
  statusReportUpdate,
} from "./status_reports";

export const statusReportStatusSchema = z.enum(statusReportStatus);

const localizedText = z.partialRecord(z.enum(locales), z.string()).nullish();

export const insertStatusReportUpdateSchema = createInsertSchema(
  statusReportUpdate,
  {
    status: statusReportStatusSchema,
    messageI18n: localizedText,
  },
).extend({
  date: z.coerce.date().optional().prefault(new Date()),
});

export const insertStatusReportSchema = createInsertSchema(statusReport, {
  status: statusReportStatusSchema,
  titleI18n: localizedText,
})
  .extend({
    date: z.coerce.date().optional().prefault(new Date()),
    /**
     * relationship to monitors and pages
     */
    monitors: z.number().array().optional().prefault([]),
  })
  .extend({
    /**
     * message for the `InsertIncidentUpdate`
     */
    message: z.string(),
    messageI18n: localizedText,
  });

export const selectStatusReportSchema = createSelectSchema(statusReport, {
  status: statusReportStatusSchema,
  titleI18n: localizedText,
});

export const selectStatusReportUpdateSchema = createSelectSchema(
  statusReportUpdate,
  {
    status: statusReportStatusSchema,
    messageI18n: localizedText,
  },
);

export type InsertStatusReport = z.infer<typeof insertStatusReportSchema>;
export type StatusReport = z.infer<typeof selectStatusReportSchema>;
export type InsertStatusReportUpdate = z.infer<
  typeof insertStatusReportUpdateSchema
>;
export type StatusReportUpdate = z.infer<typeof selectStatusReportUpdateSchema>;
export type StatusReportStatus = z.infer<typeof statusReportStatusSchema>;
