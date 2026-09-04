import { createHash } from "node:crypto";
import type { CapabilityCurationReport } from "./types.js";

export function capabilityCurationReportHash(report: CapabilityCurationReport): string {
  const body = {
    candidate: report.candidate,
    candidateContextBytes: report.candidateContextBytes,
    cases: report.cases,
    decision: report.decision,
    domain: report.domain,
    evaluatedAt: report.evaluatedAt,
    evidenceRefs: report.evidenceRefs,
    novelProcedureKeys: report.novelProcedureKeys,
    procedureKeys: report.procedureKeys,
    reasons: report.reasons,
    taskClasses: report.taskClasses,
    totalLiftBps: report.totalLiftBps,
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function hasValidCapabilityCurationReportHash(report: CapabilityCurationReport): boolean {
  return (
    /^[a-f0-9]{64}$/u.test(report.reportHash) &&
    report.reportHash === capabilityCurationReportHash(report)
  );
}
