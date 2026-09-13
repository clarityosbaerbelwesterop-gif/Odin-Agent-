import type { ActorDatabase } from "./neon-database.js";
import type {
  CustomSkillDraft,
  ProductSkillInstallation,
  ProductSkillScope,
} from "./skills-product.js";
import { ChatError } from "./types.js";

interface InstallationRow {
  installation_id: string;
  skill_id: string;
  version: string;
  content_hash: string;
  scope: ProductSkillScope;
  project_id: string | null;
  enabled: boolean;
  previous_version: string | null;
  previous_content_hash: string | null;
  installed_at: Date | string;
  updated_at: Date | string;
}

export class SkillProductStore {
  constructor(readonly db: ActorDatabase) {}

  async requireProject(projectId: string): Promise<void> {
    const found = await this.db.transaction(
      async (client) =>
        (await client.query("SELECT 1 FROM odin_api.conversations WHERE id=$1", [projectId])).rows
          .length,
    );
    if (!found) throw new ChatError("NOT_FOUND", "Project not found.", 404);
  }

  async installations(projectId: string | null): Promise<readonly ProductSkillInstallation[]> {
    return this.db.transaction(async (client) => {
      const rows = (
        await client.query(
          `SELECT installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                  previous_version,previous_content_hash,installed_at,updated_at
             FROM odin_api.skill_installations
            WHERE scope='global' OR ($1::uuid IS NOT NULL AND scope='project' AND project_id=$1::uuid)
            ORDER BY scope,skill_id`,
          [projectId],
        )
      ).rows as InstallationRow[];
      return Object.freeze(rows.map(mapInstallation));
    });
  }

  async installation(
    skillId: string,
    scope: ProductSkillScope,
    projectId: string | null,
  ): Promise<ProductSkillInstallation | undefined> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                  previous_version,previous_content_hash,installed_at,updated_at
             FROM odin_api.skill_installations
            WHERE skill_id=$1 AND scope=$2
              AND (($2='global' AND project_id IS NULL) OR ($2='project' AND project_id=$3::uuid))`,
          [skillId, scope, projectId],
        )
      ).rows[0] as InstallationRow | undefined;
      return row ? mapInstallation(row) : undefined;
    });
  }

  async install(input: {
    skillId: string;
    version: string;
    contentHash: string;
    scope: ProductSkillScope;
    projectId: string | null;
  }): Promise<ProductSkillInstallation> {
    return this.db.transaction(async (client) => {
      const existing = (
        await client.query(
          `SELECT installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                  previous_version,previous_content_hash,installed_at,updated_at
             FROM odin_api.skill_installations
            WHERE skill_id=$1 AND scope=$2
              AND (($2='global' AND project_id IS NULL) OR ($2='project' AND project_id=$3::uuid))
            FOR UPDATE`,
          [input.skillId, input.scope, input.projectId],
        )
      ).rows[0] as InstallationRow | undefined;
      if (existing) {
        if (existing.version !== input.version || existing.content_hash !== input.contentHash)
          throw new ChatError(
            "SKILL_UPDATE_REQUIRED",
            "A different Skill version is already installed. Use the explicit update action.",
            409,
          );
        return mapInstallation(existing);
      }
      const row = (
        await client.query(
          `INSERT INTO odin_api.skill_installations(skill_id,version,content_hash,scope,project_id,enabled)
           VALUES($1,$2,$3,$4,$5::uuid,true)
           RETURNING installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                     previous_version,previous_content_hash,installed_at,updated_at`,
          [input.skillId, input.version, input.contentHash, input.scope, input.projectId],
        )
      ).rows[0] as InstallationRow;
      return mapInstallation(row);
    });
  }

  async setEnabled(
    skillId: string,
    scope: ProductSkillScope,
    projectId: string | null,
    enabled: boolean,
  ): Promise<ProductSkillInstallation> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `UPDATE odin_api.skill_installations
              SET enabled=$4,updated_at=now()
            WHERE skill_id=$1 AND scope=$2
              AND (($2='global' AND project_id IS NULL) OR ($2='project' AND project_id=$3::uuid))
          RETURNING installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                    previous_version,previous_content_hash,installed_at,updated_at`,
          [skillId, scope, projectId, enabled],
        )
      ).rows[0] as InstallationRow | undefined;
      if (!row) throw new ChatError("SKILL_NOT_INSTALLED", "Skill is not installed.", 404);
      return mapInstallation(row);
    });
  }

  async update(input: {
    skillId: string;
    version: string;
    contentHash: string;
    scope: ProductSkillScope;
    projectId: string | null;
    expectedContentHash: string;
  }): Promise<ProductSkillInstallation> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `UPDATE odin_api.skill_installations
              SET previous_version=version,
                  previous_content_hash=content_hash,
                  version=$4,
                  content_hash=$5,
                  updated_at=now()
            WHERE skill_id=$1 AND scope=$2
              AND (($2='global' AND project_id IS NULL) OR ($2='project' AND project_id=$3::uuid))
              AND content_hash=$6
          RETURNING installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                    previous_version,previous_content_hash,installed_at,updated_at`,
          [
            input.skillId,
            input.scope,
            input.projectId,
            input.version,
            input.contentHash,
            input.expectedContentHash,
          ],
        )
      ).rows[0] as InstallationRow | undefined;
      if (!row)
        throw new ChatError(
          "SKILL_INTEGRITY",
          "Skill installation changed before update could be applied.",
          409,
        );
      return mapInstallation(row);
    });
  }

  async rollback(
    skillId: string,
    scope: ProductSkillScope,
    projectId: string | null,
    expectedContentHash: string,
  ): Promise<ProductSkillInstallation> {
    return this.db.transaction(async (client) => {
      const current = (
        await client.query(
          `SELECT installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                  previous_version,previous_content_hash,installed_at,updated_at
             FROM odin_api.skill_installations
            WHERE skill_id=$1 AND scope=$2
              AND (($2='global' AND project_id IS NULL) OR ($2='project' AND project_id=$3::uuid))
            FOR UPDATE`,
          [skillId, scope, projectId],
        )
      ).rows[0] as InstallationRow | undefined;
      if (!current) throw new ChatError("SKILL_NOT_INSTALLED", "Skill is not installed.", 404);
      if (current.content_hash !== expectedContentHash)
        throw new ChatError("SKILL_INTEGRITY", "Skill installation changed before rollback.", 409);
      if (!current.previous_version || !current.previous_content_hash)
        throw new ChatError("SKILL_ROLLBACK_UNAVAILABLE", "No verified previous version is stored.", 409);
      const row = (
        await client.query(
          `UPDATE odin_api.skill_installations
              SET version=previous_version,
                  content_hash=previous_content_hash,
                  previous_version=$4,
                  previous_content_hash=$5,
                  updated_at=now()
            WHERE installation_id=$1
          RETURNING installation_id,skill_id,version,content_hash,scope,project_id,enabled,
                    previous_version,previous_content_hash,installed_at,updated_at`,
          [
            current.installation_id,
            current.scope,
            current.project_id,
            current.version,
            current.content_hash,
          ],
        )
      ).rows[0] as InstallationRow;
      return mapInstallation(row);
    });
  }

  async remove(skillId: string, scope: ProductSkillScope, projectId: string | null): Promise<void> {
    await this.db.transaction(async (client) => {
      const result = await client.query(
        `DELETE FROM odin_api.skill_installations
          WHERE skill_id=$1 AND scope=$2
            AND (($2='global' AND project_id IS NULL) OR ($2='project' AND project_id=$3::uuid))`,
        [skillId, scope, projectId],
      );
      if (!result.rowCount) throw new ChatError("SKILL_NOT_INSTALLED", "Skill is not installed.", 404);
    });
  }

  async saveDraft(draft: CustomSkillDraft): Promise<Record<string, unknown>> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO odin_api.custom_skill_drafts(
             name,version,purpose,procedure,inputs,outputs,required_tools,required_connections,
             verification_plan,scope,project_id,content_hash,status
           ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::uuid,$12,'DRAFT')
           RETURNING draft_id,name,version,purpose,procedure,inputs,outputs,required_tools,
                     required_connections,verification_plan,scope,project_id,content_hash,status,created_at`,
          [
            draft.name,
            draft.version,
            draft.purpose,
            JSON.stringify(draft.procedure),
            JSON.stringify(draft.inputs),
            JSON.stringify(draft.outputs),
            JSON.stringify(draft.requiredTools),
            JSON.stringify(draft.requiredConnections),
            JSON.stringify(draft.verificationPlan),
            draft.scope,
            draft.projectId,
            draft.contentHash,
          ],
        )
      ).rows[0];
      return normalizeDraftRow(row);
    });
  }

  async drafts(projectId: string | null): Promise<readonly Record<string, unknown>[]> {
    return this.db.transaction(async (client) => {
      const rows = (
        await client.query(
          `SELECT draft_id,name,version,purpose,procedure,inputs,outputs,required_tools,
                  required_connections,verification_plan,scope,project_id,content_hash,status,created_at
             FROM odin_api.custom_skill_drafts
            WHERE scope='global' OR ($1::uuid IS NOT NULL AND scope='project' AND project_id=$1::uuid)
            ORDER BY created_at DESC
            LIMIT 100`,
          [projectId],
        )
      ).rows;
      return Object.freeze(rows.map(normalizeDraftRow));
    });
  }
}

function mapInstallation(row: InstallationRow): ProductSkillInstallation {
  return Object.freeze({
    installationId: String(row.installation_id),
    skillId: String(row.skill_id),
    version: String(row.version),
    contentHash: String(row.content_hash),
    scope: row.scope,
    projectId: row.project_id ? String(row.project_id) : null,
    enabled: Boolean(row.enabled),
    previousVersion: row.previous_version ? String(row.previous_version) : null,
    previousContentHash: row.previous_content_hash ? String(row.previous_content_hash) : null,
    installedAt: new Date(row.installed_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function normalizeDraftRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.freeze({
    draftId: String(row.draft_id),
    name: String(row.name),
    version: String(row.version),
    purpose: String(row.purpose),
    procedure: row.procedure,
    inputs: row.inputs,
    outputs: row.outputs,
    requiredTools: row.required_tools,
    requiredConnections: row.required_connections,
    verificationPlan: row.verification_plan,
    scope: String(row.scope),
    projectId: row.project_id ? String(row.project_id) : null,
    contentHash: String(row.content_hash),
    status: String(row.status),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    executionAuthority: "NONE_UNTIL_VERIFIED_AND_SELECTED_BY_M23",
  });
}
