from pathlib import Path

agent = Path("src/chat/agent.ts")
text = agent.read_text()
current = '''        } catch (error) {\n          signal.throwIfAborted();\n          const normalized = publicError(error);\n          failed = true;\n          output = JSON.stringify(normalized);\n          await publish("tool.end", {\n            name: tool.name,\n            toolId: tool.id,\n            status: "failed",\n            ...normalized,\n          });\n          const signature = hashText(`${tool.name}:${output}`);\n          repeatedErrors = signature === lastError ? repeatedErrors + 1 : 1;\n          lastError = signature;\n          if (repeatedErrors >= 3)\n            throw new ChatError(\n              "NO_PROGRESS",\n              "The same tool failure repeated three times. Change the approach before resuming.",\n              409,\n            );\n        }\n        await add({\n          role: "tool",\n          toolCallId: tool.id,\n          content: output.slice(0, 48_000),\n          isError: failed,\n        });'''
legacy_anchor = '''        } catch (error) {\n          signal.throwIfAborted();\n          const normalized = publicError(error);\n          failed = true;\n          output = JSON.stringify(normalized);\n          await publish("tool.end", { name: tool.name, status: "failed", ...normalized });\n          const signature = hashText(`${tool.name}:${output}`);\n          repeatedErrors = signature === lastError ? repeatedErrors + 1 : 1;\n          lastError = signature;\n          if (repeatedErrors >= 3)\n            throw new ChatError(\n              "NO_PROGRESS",\n              "The same tool failure repeated three times. Change the approach before resuming.",\n              409,\n            );\n        }\n        await add({\n          role: "tool",\n          toolCallId: tool.id,\n          content: output.slice(0, 48_000),\n          isError: failed,\n        });'''

if current in text:
    agent.write_text(text.replace(current, legacy_anchor, 1))
elif legacy_anchor not in text:
    raise SystemExit("current ChatAgent tool failure block does not match the audited compatibility shapes")

builder = Path(".github/scripts/mcp-platform-build.py")
builder_text = builder.read_text()
old_package_patch = '''    ''' + "'''scripts/product-experience-ui.test.mjs scripts/workspace-ui.test.mjs''',\n    '''scripts/product-experience-ui.test.mjs scripts/connectors-ui.test.mjs scripts/workspace-ui.test.mjs'''," + '''\n'''
new_package_patch = '''    ''' + "'''scripts/github-repo-oauth-callback.test.mjs scripts/product-experience-ui.test.mjs''',\n    '''scripts/github-repo-oauth-callback.test.mjs scripts/product-experience-ui.test.mjs scripts/connectors-ui.test.mjs'''," + '''\n'''
if old_package_patch in builder_text:
    builder.write_text(builder_text.replace(old_package_patch, new_package_patch, 1))
elif new_package_patch not in builder_text:
    raise SystemExit("MCP builder package.json test anchor does not match the current product test order")
