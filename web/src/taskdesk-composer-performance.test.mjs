import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("Session composer typing does not rerender every Markdown message", () => {
  const workspace = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")

  assert.match(workspace, /import \{ memo, useCallback/)
  assert.match(workspace, /const MessageBubble = memo\(function MessageBubble/)
  assert.match(workspace, /<ReactMarkdown remarkPlugins=\{REMARK_PLUGINS\}>\{text\}<\/ReactMarkdown>/)
  assert.match(workspace, /value=\{composer\}[\s\S]*?onChange=\{\(event\) => setComposer\(event\.target\.value\)\}/)
})
