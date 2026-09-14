from pathlib import Path

path = Path(".github/scripts/product-experience-build.py")
text = path.read_text()
start = text.index('replace(\n    "scripts/configure-vercel-production.mjs",')
end = text.index('\n\nreplace(\n    "web/landing.js",', start)
replacement = r'''replace(
    "scripts/configure-vercel-production.mjs",
    '    await ownerPool.query(developerMigration);',
    """    await ownerPool.query(developerMigration);

    for (const migration of [
      "012_product_m2_workspace_os.sql",
      "013_product_m3_memory_brain.sql",
      "014_product_m5_skills_os.sql",
    ]) {
      const productMigration = await readFile(`migrations/${migration}`, "utf8");
      await ownerPool.query(productMigration);
      report.checks.push(`Production schema reconciled: ${migration}`);
    }""",
)
replace(
    "scripts/configure-vercel-production.mjs",
    '[["accounts", "credentials", "github_connections", "oauth_states", "stripe_events"]]',
    '[["accounts", "credentials", "github_connections", "oauth_states", "stripe_events", "workspace_files", "workspace_context_items", "workspace_layouts", "memory_records", "memory_revisions", "memory_idempotency", "memory_product_signals", "skill_installations", "custom_skill_drafts"]]',
)
replace(
    "scripts/configure-vercel-production.mjs",
    'assert.equal(schema.rows.length, 5, "PRODUCT_SCHEMA_MISSING");',
    'assert.equal(schema.rows.length, 14, "PRODUCT_SCHEMA_MISSING");',
)'''
path.write_text(text[:start] + replacement + text[end:])
