/*
 * Wander's server functions, as they were in Firebase (functions/index.js),
 * now reading Hive's Supabase project:
 *
 *   GET /api/calendarFeed?token=…&type=…      the trip's calendar (ICS)
 *   GET /api/trackFlight?flight=…             live position (needs FR24_API_KEY)
 *   GET /api/nextSharedTrip?members=a,b       for Our Den
 *   GET /api/appTrips, /api/appTripTravel     for connected apps and Hive
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const handlers = require('../lib/wanderApi.cjs')

export const config = { path: '/api/:fn' }

export default async (request, context) => {
  const handler = handlers[context.params?.fn]
  if (typeof handler !== 'function') return new Response('Not found', { status: 404 })
  const url = new URL(request.url)
  const req = {
    method: request.method,
    query: Object.fromEntries(url.searchParams),
    get: (name) => request.headers.get(name),
    headers: Object.fromEntries(request.headers),
  }
  return new Promise((resolve) => {
    const out = { status: 200, headers: new Headers() }
    const res = {
      set: (k, v) => (out.headers.set(k, v), res),
      status: (code) => ((out.status = code), res),
      json: (body) => {
        out.headers.set('content-type', 'application/json')
        resolve(new Response(JSON.stringify(body), out))
        return res
      },
      send: (body) => (resolve(new Response(out.status === 204 || out.status === 304 ? null : body ?? '', out)), res),
    }
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error('[wander api]', err)
      resolve(new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'content-type': 'application/json' } }))
    })
  })
}
