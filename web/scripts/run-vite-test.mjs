import { createServer } from 'vite'

const modules = process.argv.slice(2)
if (modules.length === 0) {
  console.error('Usage: node scripts/run-vite-test.mjs <module> [module...]')
  process.exit(2)
}

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true }
})

try {
  for (const modulePath of modules) {
    const normalized = modulePath.startsWith('/') ? modulePath : `/${modulePath.replace(/^\.\//, '')}`
    await server.ssrLoadModule(normalized)
  }
} finally {
  await server.close()
}
