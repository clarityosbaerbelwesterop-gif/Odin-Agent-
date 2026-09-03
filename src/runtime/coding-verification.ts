import { createHash } from "node:crypto";
import { MissionDomainError, type MissionSnapshot } from "../mission/runtime.js";
import type { VerificationEvidence, VerificationRequest } from "../verification/types.js";
import {
  CHANGED_FILE_DEFINITION_PREFIX,
  QUALITY_DEFINITION_PREFIX,
  type RepositoryFileEvidence,
} from "./coding-contract.js";

export interface CodingVerificationInput {
  readonly evaluatedAt: string;
  readonly mission: MissionSnapshot;
  readonly observedFiles: readonly RepositoryFileEvidence[];
  readonly quality: {
    readonly commandId: string;
    readonly exitCode: number;
    readonly output: string;
  };
}

export function createCodingVerificationRequest(
  input: CodingVerificationInput,
): VerificationRequest {
  const evaluatedAt = canonicalTimestamp(input.evaluatedAt);
  const observedFiles = new Map(input.observedFiles.map((file) => [file.path, file]));
  const claims: VerificationRequest["claims"][number][] = [];
  const evidence = new Map<string, VerificationEvidence>();
  const bindings: VerificationRequest["bindings"][number][] = [];

  for (const task of [...input.mission.tasks].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    let qualityEvidenceId: string | undefined;
    for (const [index, definitionOfDone] of task.definitionOfDone.entries()) {
      const claimId = `claim:${digest(`${task.id}\u0000${index}\u0000${definitionOfDone}`).slice(0, 32)}`;
      const changedPath = definitionOfDone.startsWith(CHANGED_FILE_DEFINITION_PREFIX)
        ? definitionOfDone.slice(CHANGED_FILE_DEFINITION_PREFIX.length)
        : undefined;
      const kind = changedPath === undefined ? "quality_gate" : "changed_file";
      claims.push({
        definitionOfDone,
        id: claimId,
        missionId: input.mission.id,
        requiredAfter: evaluatedAt,
        requiredEvidenceKinds: [kind],
        taskId: task.id,
      });

      let evidenceId: string;
      if (changedPath !== undefined) {
        const file = observedFiles.get(changedPath);
        if (changedPath.trim() === "" || file === undefined || file.truncated) {
          throw new MissionDomainError(
            "M5 requires a complete post-change repository read for every changed-file claim.",
          );
        }
        evidenceId = `evidence:file:${digest(claimId).slice(0, 32)}`;
        evidence.set(evidenceId, {
          contentHash: digest(file.content),
          id: evidenceId,
          kind,
          missionId: input.mission.id,
          observedAt: evaluatedAt,
          producer: { class: "independent_tool", id: "repo.read@1" },
          status: "PASS",
          subject: changedPath,
          taskId: task.id,
        });
      } else {
        if (definitionOfDone.startsWith(QUALITY_DEFINITION_PREFIX)) {
          const declaredCommand = definitionOfDone.slice(QUALITY_DEFINITION_PREFIX.length);
          if (declaredCommand !== input.quality.commandId) {
            throw new MissionDomainError(
              "M5 quality evidence does not match the mission's registered command claim.",
            );
          }
        }
        qualityEvidenceId ??= `evidence:quality:${digest(task.id).slice(0, 32)}`;
        evidenceId = qualityEvidenceId;
        if (!evidence.has(evidenceId)) {
          evidence.set(evidenceId, {
            contentHash: digest(
              JSON.stringify({
                commandId: input.quality.commandId,
                exitCode: input.quality.exitCode,
                output: input.quality.output,
                taskId: task.id,
              }),
            ),
            id: evidenceId,
            kind,
            missionId: input.mission.id,
            observedAt: evaluatedAt,
            producer: { class: "independent_tool", id: "repo.quality@1" },
            status: input.quality.exitCode === 0 ? "PASS" : "FAIL",
            subject: `quality/${input.quality.commandId}/${task.id}`,
            taskId: task.id,
          });
        }
      }
      bindings.push({ claimId, evidenceIds: [evidenceId] });
    }
  }

  return {
    bindings: bindings.sort((left, right) => left.claimId.localeCompare(right.claimId)),
    claims: claims.sort((left, right) => left.id.localeCompare(right.id)),
    evaluatedAt,
    evidence: [...evidence.values()].sort((left, right) => left.id.localeCompare(right.id)),
    missionId: input.mission.id,
  };
}

function canonicalTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("M5 clock must return a valid timestamp.");
  return new Date(parsed).toISOString();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
