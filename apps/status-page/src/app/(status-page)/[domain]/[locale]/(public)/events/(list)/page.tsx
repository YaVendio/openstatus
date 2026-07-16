"use client";

import { resolveLocalized } from "@openstatus/locales";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openstatus/ui/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useExtracted, useLocale } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { StatusBlankEvents } from "../../../../../../../components/status-page/status-blank";
import {
  StatusEvent,
  StatusEventAffected,
  StatusEventAffectedBadge,
  StatusEventAside,
  StatusEventContent,
  StatusEventDate,
  StatusEventGroup,
  StatusEventTimelineMaintenance,
  StatusEventTimelineReport,
  StatusEventTitle,
  StatusEventTitleCheck,
} from "../../../../../../../components/status-page/status-events";
import { updatesWithImpactChanges } from "../../../../../../../lib/report-impacts";
import { useTRPC } from "../../../../../../../lib/trpc/client";
import { searchParamsParsers } from "./search-params";

export default function Page() {
  const t = useExtracted();
  const locale = useLocale();
  const [{ tab }, setSearchParams] = useQueryStates(searchParamsParsers);
  const { domain } = useParams<{ domain: string }>();
  const trpc = useTRPC();
  const { data: page } = useQuery(
    trpc.statusPage.get.queryOptions({ slug: domain }),
  );

  // The query omits `locale` to keep the queryKey matching the server prefetch,
  // so resolve to the visitor's locale here off the raw i18n maps.
  const statusReports = useMemo(
    () =>
      page?.statusReports.map((report) => ({
        ...report,
        title: resolveLocalized(report.titleI18n, report.title, locale),
        statusReportUpdates: report.statusReportUpdates.map((update) => ({
          ...update,
          message: resolveLocalized(update.messageI18n, update.message, locale),
        })),
      })) ?? [],
    [page, locale],
  );

  if (!page) return null;

  const { maintenances } = page;

  return (
    <Tabs
      defaultValue={tab}
      onValueChange={(value) =>
        setSearchParams({ tab: value as "reports" | "maintenances" })
      }
      className="gap-4"
    >
      <TabsList>
        <TabsTrigger value="reports">{t("Reports")}</TabsTrigger>
        <TabsTrigger value="maintenances">{t("Maintenances")}</TabsTrigger>
      </TabsList>
      <TabsContent value="reports">
        <StatusEventGroup>
          {statusReports.length > 0 ? (
            statusReports.map((report) => {
              const updates = report.statusReportUpdates.sort(
                (a, b) => b.date.getTime() - a.date.getTime(),
              );
              const firstUpdate = updates[updates.length - 1];
              const lastUpdate = updates[0];
              // NOTE: updates are sorted descending by date
              const startedAt =
                firstUpdate?.date ?? report.createdAt ?? new Date();
              // HACKY: LEGACY: only resolved via report and not via report update
              const isReportResolvedOnly =
                report.status === "resolved" &&
                lastUpdate?.status !== "resolved";
              return (
                <StatusEvent key={report.id}>
                  <StatusEventAside>
                    <StatusEventDate date={startedAt} />
                  </StatusEventAside>
                  <Link
                    href={`./events/report/${report.id}`}
                    className="rounded-lg"
                  >
                    <StatusEventContent>
                      <StatusEventTitle className="inline-flex gap-1">
                        {report.title}
                        {isReportResolvedOnly ? (
                          <StatusEventTitleCheck />
                        ) : null}
                      </StatusEventTitle>
                      {report.statusReportsToPageComponents.length > 0 ? (
                        <StatusEventAffected>
                          {report.statusReportsToPageComponents.map(
                            (affected) => (
                              <StatusEventAffectedBadge
                                key={affected.pageComponent.id}
                              >
                                {affected.pageComponent.name}
                              </StatusEventAffectedBadge>
                            ),
                          )}
                        </StatusEventAffected>
                      ) : null}
                      <StatusEventTimelineReport
                        updates={updatesWithImpactChanges(report)}
                      />
                    </StatusEventContent>
                  </Link>
                </StatusEvent>
              );
            })
          ) : (
            <StatusBlankEvents />
          )}
        </StatusEventGroup>
      </TabsContent>
      <TabsContent value="maintenances">
        <StatusEventGroup>
          {maintenances.length > 0 ? (
            maintenances.map((maintenance) => {
              return (
                <StatusEvent key={maintenance.id}>
                  <StatusEventAside>
                    <StatusEventDate date={maintenance.from} />
                  </StatusEventAside>
                  <Link
                    href={`./events/maintenance/${maintenance.id}`}
                    className="rounded-lg"
                  >
                    <StatusEventContent>
                      <StatusEventTitle>{maintenance.title}</StatusEventTitle>
                      {maintenance.maintenancesToPageComponents.length > 0 ? (
                        <StatusEventAffected>
                          {maintenance.maintenancesToPageComponents.map(
                            (affected) => (
                              <StatusEventAffectedBadge
                                key={affected.pageComponent.id}
                              >
                                {affected.pageComponent.name}
                              </StatusEventAffectedBadge>
                            ),
                          )}
                        </StatusEventAffected>
                      ) : null}
                      <StatusEventTimelineMaintenance
                        maintenance={maintenance}
                      />
                    </StatusEventContent>
                  </Link>
                </StatusEvent>
              );
            })
          ) : (
            <StatusBlankEvents
              title={t("No maintenances found")}
              description={t("No maintenances found for this status page.")}
            />
          )}
        </StatusEventGroup>
      </TabsContent>
    </Tabs>
  );
}
