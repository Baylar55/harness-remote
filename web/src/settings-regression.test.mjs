import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('./i18n.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

const testConnection = app.match(/async function testConnection[\s\S]*?async function refreshSessions/)
assert.ok(testConnection, 'testConnection function should be present')
assert.equal(testConnection[0].includes('setView("sessions")'), false, 'Test Connection must not navigate away from settings')
assert.equal(testConnection[0].includes('setConfig(configToTest)'), false, 'Test Connection must not overwrite the current configuration')

const applyConfig = app.match(/function applyConfig[\s\S]*?async function testConnection/)
assert.ok(applyConfig, 'applyConfig function should persist the active configuration')
assert.equal(applyConfig[0].includes('setView("sessions")'), false, 'Saving must leave the user on settings')
assert.equal(app.includes('setTimeout(() => applyConfig(draftConfig), 500)'), false, 'Typing must not reconnect to a server through autosave')
assert.ok(app.includes('function saveConfig()'), 'Settings should expose an explicit save handler')
assert.ok(app.includes('onClick={saveConfig}'), 'Settings should require an explicit Save action')
assert.ok(app.includes("t('settings.draftHint')"), 'Settings should explain explicit saving')
assert.ok(i18n.includes("'settings.saved': 'Changes saved.'"), 'Save feedback should be translated')
assert.match(app, /event\.target === event\.currentTarget/, 'only direct backdrop clicks should close the settings modal')
assert.match(app, /id="port"[\s\S]*?type="text"[\s\S]*?value=\{draftConfig\.port \|\| ""\}/, 'the port field should be clearable instead of forcing a zero')
assert.match(app, /pattern="\[0-9\]\*"/, 'the port field should still accept only digits')
assert.ok(i18n.includes("'settings.testedNotSaved'"), 'Test success should remain distinct from connectivity state')
assert.ok(app.includes('function canTestConfig'), 'Settings should have a central testability check for required connection fields')
assert.ok(app.includes('disabled={testingConnection || !canTestDraft || testAlreadyPassedForDraft}'), 'Test button should be disabled when fields are missing, testing is active, or the unchanged configuration already passed')
assert.ok(app.includes('connection-help'), 'Settings should explain whether the current configuration can be tested')
assert.ok(app.includes('Full, versioned backend guides live in the Harness Remote repository'), 'Help should link out instead of duplicating every backend guide')
assert.ok(app.includes('"oh-my-pi-bridge-setup"') && app.includes('"pi-bridge-setup"') && app.includes('"opencode-server-setup"'), 'Help should select the repository guide for the active backend')
assert.ok(app.includes('<option value="pi">PI (ACP bridge)</option>'), 'Settings should expose the PI backend')
assert.ok(app.includes('health.backend && health.backend !== configToTest.backend'), 'Connection tests should reject a bridge for the wrong backend')
assert.ok(app.includes('https://github.com/giuliastro/harness-remote#'), 'Help should link to the canonical repository')
assert.equal(app.includes('https://github.com/gervaso-assistant/opencode-remote-android#'), false, 'Help must not link to the obsolete repository owner')

// The server picker used to caption itself with a visually-hidden span, but no rule ever hid it: the
// caption rendered as stray text above the header. Every class the picker and its actions rely on has
// to exist in the stylesheet, or the layout falls back to whatever the bare markup does.
for (const className of ['server-profile-picker', 'server-profile-actions', 'section-heading-text']) {
  assert.ok(app.includes(`className="${className}"`), `${className} should be used by the saved-server UI`)
  assert.ok(styles.includes(`.${className}`), `${className} should be styled instead of relying on default rendering`)
}
assert.equal(/className="sr-only"/.test(app), false, 'a caption the stylesheet cannot hide must not be rendered at all')

// Sized to their labels the two actions came out visibly different widths, and a full row of their own
// pushed a form that already fills the height cap into scrolling for a few pixels.
assert.match(styles, /\.server-profile-actions\s*\{[^}]*grid-auto-columns:\s*1fr/, 'the saved-server actions must be equal width')
assert.match(styles, /\.server-profile-actions\s*\{[^}]*align-self:\s*flex-end/, 'the saved-server actions must sit on the last line of the heading instead of taking a row')
assert.match(styles, /\.desktop-panel-modal\s*\{[^}]*max-height:\s*calc\(100vh - 2 \* var\(--modal-margin\) - 2px\)/, 'a panel modal must claim every pixel the backdrop margin leaves so a form that fits does not scroll')
assert.match(styles, /\.desktop-panel-modal > \.panel\s*\{[^}]*border:\s*0/, 'the panel inside a modal must not draw a second frame inside the card')

// Deleting a saved server discards a host, a username and a password with no way back.
assert.ok(app.includes('setProfileToDelete(profiles.find((profile) => profile.id === activeProfileID) ?? null)'), 'deleting a saved server must ask first')
assert.ok(app.includes('aria-labelledby="delete-server-title"'), 'the saved-server deletion must be confirmed in a dialog')
assert.ok(i18n.includes("'settings.deleteServerTitle'"), 'the deletion dialog needs a translated title')

console.log('settings regression tests passed')
