import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ATTACHMENT_MAX_EDGE, attachmentPart, attachmentTargetSize } from './attachments.ts'

assert.deepEqual(attachmentTargetSize(4032, 3024), { width: ATTACHMENT_MAX_EDGE, height: 1176 })
assert.deepEqual(attachmentTargetSize(3024, 4032), { width: 1176, height: ATTACHMENT_MAX_EDGE })
assert.deepEqual(attachmentTargetSize(800, 600), { width: 800, height: 600 })
assert.deepEqual(attachmentTargetSize(ATTACHMENT_MAX_EDGE, ATTACHMENT_MAX_EDGE), { width: ATTACHMENT_MAX_EDGE, height: ATTACHMENT_MAX_EDGE })
const scaled = attachmentTargetSize(1569, 1000)
assert.ok(Number.isInteger(scaled.width) && Number.isInteger(scaled.height))

assert.deepEqual(
  attachmentPart('image/jpeg', 'erro.jpg', 'data:image/jpeg;base64,AAAA'),
  { type: 'file', mime: 'image/jpeg', filename: 'erro.jpg', url: 'data:image/jpeg;base64,AAAA' }
)
assert.throws(() => attachmentPart('image/jpeg', 'erro.jpg', 'https://example.com/erro.jpg'), /data URL/)

const defaults = readFileSync(new URL('./backendCapabilities.ts', import.meta.url), 'utf8')
assert.equal((defaults.match(/attachments:/g) ?? []).length, 5, 'every backend default must state attachment support')

const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')
assert.ok(api.includes('...attachments'), 'the lower-level prompt API must preserve attachment parts when supplied')

console.log('attachment helper and transport tests passed')
