from pathlib import Path

path = Path("src/chat/agent.ts")
text = path.read_text()
current = '''        } catch (error) {\n          signal.throwIfAborted();\n          const normalized = publicError(error);\n          failed = true;\n          output = JSON.stringify(normalized);\n          await publish("tool.end", {\n            name: tool.name,\n            toolId: tool.id,\n            status: "failed",\n            ...normalized,\n          });\n          const signature = hashText(`${tool.name}:${output}`);\n          repeatedErrors = signature === lastError ? repeatedErrors + 1 : 1;\n          lastError = signature;\n          if (repeatedErrors >= 3)\n            throw new ChatError(\n              "NO_PROGRESS",\n              "The same tool failure repeated three times. Change the approach before resuming.",\n              409,\n            );\n        }\n        await add({\n          role: "tool",\n          toolCallId: tool.id,\n          content: output.slice(0, 48_000),\n          isError: failed,\n        });'''
legacy_anchor = '''        } catch (error) {\n          signal.throwIfAborted();\n          const normalized = publicError(error);\n          failed = true;\n          output = JSON.stringify(normalized);\n          await publish("tool.end", { name: tool.name, status: "failed", ...normalized });\n          const signature = hashText(`${tool.name}:${output}`);\n          repeatedErrors = signature === lastError ? repeatedErrors + 1 : 1;\n          lastError = signature;\n          if (repeatedErrors >= 3)\n            throw new ChatError(\n              "NO_PROGRESS",\n              "The same tool failure repeated three times. Change the approach before resuming.",\n              409,\n            );\n        }\n        await add({\n          role: "tool",\n          toolCallId: tool.id,\n          content: output.slice(0, 48_000),\n          isError: failed,\n        });'''

if current in text:
    path.write_text(text.replace(current, legacy_anchor, 1))
elif legacy_anchor not in text:
    raise SystemExit("current ChatAgent tool failure block does not match the audited compatibility shapes")
