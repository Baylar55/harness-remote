import assert from "node:assert/strict"
import test from "node:test"
import { announceMachinePairing, claimPairingGrant, createPairingGrant, machinePairingLinks, renderPairingQRCode } from "../src/pairing-server.js"

test("pairing grant is one-time and expires", () => {
  const grant = createPairingGrant({ now: 1_000, ttlMs: 5_000, token: "token" })
  assert.equal(claimPairingGrant(grant, "wrong", 2_000), false)
  assert.equal(claimPairingGrant(grant, "token", 2_000), true)
  assert.equal(claimPairingGrant(grant, "token", 2_001), false)

  const expired = createPairingGrant({ now: 1_000, ttlMs: 100, token: "expired" })
  assert.equal(claimPairingGrant(expired, "expired", 1_101), false)
})

test("pairing links prefer physical LAN addresses and keep the token out of the endpoint", () => {
  const grant = createPairingGrant({ token: "secret-token" })
  const links = machinePairingLinks({ host: "0.0.0.0", port: 4097 }, grant, {
    docker0: [{ family: "IPv4", internal: false, address: "172.17.0.1" }],
    wlan0: [{ family: "IPv4", internal: false, address: "192.168.1.42" }]
  })
  assert.deepEqual(links.map((link) => link.endpoint), ["http://192.168.1.42:4097"])
  assert.match(links[0].uri, /^harnessremote:\/\/pair\?/)
  assert.match(links[0].uri, /secret-token/)
  assert.equal(links[0].endpoint.includes("secret-token"), false)
})

test("QR renderer is optional", () => {
  const rendered = renderPairingQRCode("harnessremote://pair?token=x", {
    load: () => ({ generate: (_value, _options, callback) => callback("QR") })
  })
  assert.equal(rendered, "QR")
  assert.equal(renderPairingQRCode("x", { load: () => { throw new Error("missing") } }), null)
})

test("pairing announcement prints one QR without raw deep links or alternate endpoints", () => {
  const grant = createPairingGrant({ token: "secret-token" })
  let output = ""
  const links = announceMachinePairing({ host: "0.0.0.0", port: 4097 }, grant, {
    write: (text) => { output += text },
    interfaces: {
      wlan0: [{ family: "IPv4", internal: false, address: "192.168.1.42" }],
      eth0: [{ family: "IPv4", internal: false, address: "192.168.1.43" }]
    },
    renderQR: () => "QR"
  })
  assert.equal(links.length, 2)
  assert.match(output, /Phone pairing/)
  assert.match(output, /QR/)
  assert.doesNotMatch(output, /harnessremote:\/\//)
  assert.doesNotMatch(output, /secret-token/)
  assert.doesNotMatch(output, /192\.168\.1\.42|192\.168\.1\.43/)
})

test("pairing announcement falls back to manual machine address without leaking token", () => {
  const grant = createPairingGrant({ token: "secret-token" })
  let output = ""
  announceMachinePairing({ host: "0.0.0.0", port: 4097 }, grant, {
    write: (text) => { output += text },
    interfaces: { wlan0: [{ family: "IPv4", internal: false, address: "192.168.1.42" }] },
    renderQR: () => null
  })
  assert.match(output, /Machines → Add machine/)
  assert.match(output, /address and credentials/)
  assert.doesNotMatch(output, /secret-token|harnessremote:\/\//)
})
