import http from "node:http"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { networkInterfaces } from "node:os"
import { applyCorsHeaders, allowedOrigin } from "./http-policy.js"

const require = createRequire(import.meta.url)
const PAIRING_CLAIM_PATH = "/v1/pairing/claim"
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000

export function createPairingGrant({ now = Date.now(), ttlMs = DEFAULT_PAIRING_TTL_MS, token = randomBytes(32).toString("base64url") } = {}) {
  return { token, expiresAt: now + ttlMs, used: false }
}

function isPairingGrantValid(grant, now = Date.now()) {
  return Boolean(grant && !grant.used && typeof grant.token === "string" && now <= grant.expiresAt)
}

export function claimPairingGrant(grant, token, now = Date.now()) {
  if (!isPairingGrantValid(grant, now)) return false
  if (token !== grant.token) return false
  grant.used = true
  return true
}

function cleanHost(host) {
  return String(host ?? "").trim().replace(/^\[(.*)\]$/, "$1")
}

function endpointUrl(host, port) {
  const normalized = cleanHost(host)
  if (!normalized) return null
  const printable = normalized.includes(":") ? `[${normalized}]` : normalized
  return `http://${printable}:${port}`
}

function lanAddresses(interfaces = networkInterfaces()) {
  const candidates = []
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) candidates.push({ name, address: entry.address })
    }
  }
  const virtual = /^(docker|br-|veth|virbr|tun|tap|utun)/i
  const preferred = candidates.filter(({ name }) => !virtual.test(name))
  return [...new Set((preferred.length ? preferred : candidates).map(({ address }) => address))]
}

export function machinePairingLinks(config, grant, interfaces = networkInterfaces()) {
  if (!grant?.token) return []
  const hosts = cleanHost(config.host) === "0.0.0.0" ? lanAddresses(interfaces) : [config.host]
  return hosts
    .map((host) => endpointUrl(host, config.port))
    .filter(Boolean)
    .map((endpoint) => ({
      endpoint,
      uri: `harnessremote://pair?endpoint=${encodeURIComponent(endpoint)}&token=${encodeURIComponent(grant.token)}`
    }))
}

export function machinePairingPayload(config, machine, credentials) {
  return {
    machine: {
      id: machine.id,
      name: machine.name
    },
    connection: {
      host: config.host,
      port: config.port,
      username: credentials.username,
      password: credentials.password
    }
  }
}

function jsonBody(request, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error("request body too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8")
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}

/**
 * Keep QR rendering outside the pairing authority contract. A source checkout that has not installed
 * the optional presentation dependency still supports manual setup with the normal machine address
 * and credentials; npx and normal installs render the compact terminal QR because qrcode-terminal is
 * installed by package.json.
 */
export function renderPairingQRCode(uri, { load = () => require("qrcode-terminal") } = {}) {
  try {
    const qrcode = load()
    if (!qrcode || typeof qrcode.generate !== "function") return null
    let output = ""
    qrcode.generate(uri, { small: true }, (rendered) => {
      if (typeof rendered === "string") output = rendered
    })
    return output.trim() ? output : null
  } catch {
    return null
  }
}

/**
 * The one-time URI is an implementation detail of phone pairing, not useful terminal UI. Show a
 * single QR for the preferred reachable endpoint and keep manual machine setup as the fallback. In
 * particular, never dump raw deep links or alternate interface URLs below the QR.
 */
export function announceMachinePairing(config, grant, {
  write = (text) => process.stdout.write(text),
  interfaces,
  renderQR = renderPairingQRCode
} = {}) {
  const links = machinePairingLinks(config, grant, interfaces)
  if (!links.length) return []

  const qr = renderQR(links[0].uri)
  write("\nPhone pairing (optional, valid for 5 minutes)\n")
  if (qr) {
    write(`${qr}\n`)
    write("Scan this QR in Harness Remote to add the machine automatically.\n")
  } else {
    write("QR unavailable. Use Machines → Add machine with this machine's address and credentials.\n")
  }
  return links
}

/**
 * The pairing claim is the daemon's only unauthenticated bootstrap route. Everything else is passed
 * byte-for-byte to the existing authenticated server stack. The response returns the daemon's
 * existing Basic Auth credentials; it does not create a second authority model.
 */
export function createPairingServer({ innerServer, config, machine, grant, createServer = http.createServer }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    if (url.pathname !== PAIRING_CLAIM_PATH) {
      innerServer.emit("request", request, response)
      return
    }

    applyCorsHeaders(request, response, config)
    if (request.method === "OPTIONS") {
      response.writeHead(allowedOrigin(request, config) ? 204 : 403)
      response.end()
      return
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST, OPTIONS", "Cache-Control": "no-store" })
      response.end()
      return
    }

    try {
      const body = await jsonBody(request)
      if (!claimPairingGrant(grant, body?.token)) {
        response.writeHead(410, { "Content-Type": "application/json", "Cache-Control": "no-store" })
        response.end(JSON.stringify({ error: "pairing grant expired, used, or invalid" }))
        return
      }
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      response.end(JSON.stringify(machinePairingPayload(config, machine, {
        username: config.username,
        password: config.password
      })))
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      response.end(JSON.stringify({ error: error?.message ?? "invalid pairing request" }))
    }
  })
}
