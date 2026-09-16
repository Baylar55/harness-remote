# RC1 startup blocker: repeated local-runtime polling

RC1 (`a5695af0c874deeb2934f8308bc78f2196b5be1c`) exposed a desktop-only startup loop when the embedded local runtime was healthy while another saved machine endpoint was slow or unreachable.

The local runtime health poll runs every 4 seconds after startup. Electron IPC returns a fresh object for every `getLocalRuntimeState()` call even when the semantic state is unchanged. Feeding that fresh object into React rebuilt the composed `machines` array every 4 seconds. `NativeSessionsWorkspace` keys its machine-discovery effect by that array, so each poll cancelled and restarted any slower remote discovery before it could settle offline. The UI therefore remained on `Connecting to your machines…` indefinitely.

The fix keeps semantically unchanged local-runtime states referentially stable in the renderer bridge while still producing a new object when status, profile identity, endpoint, or PID actually changes. The behavioral desktop bridge regression test verifies both sides of that contract.

RC1 remains frozen as failed evidence. A new release candidate must be cut only after this fix passes the normal full PR gate.