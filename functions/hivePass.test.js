// node --test (from functions/). Hive passes for the app API.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, sign } = require('node:crypto')
const { verifyHivePass } = require('./hivePass')

const keys = generateKeyPairSync('ed25519')
const other = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const NOW = 1_800_000_000_000
const secs = NOW / 1000
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const pass = (claims = {}, key = keys.privateKey) => {
  const head = `${enc({ alg: 'EdDSA', typ: 'JWT' })}.${enc({ iss: 'hive', aud: 'wander', sub: 'h1', email: 'me@example.com', email_verified: true, iat: secs - 5, exp: secs + 115, ...claims })}`
  return `${head}.${sign(null, Buffer.from(head), key).toString('base64url')}`
}
const check = (p) => verifyHivePass(p, { now: NOW, publicKey })

test('a pass made for Wander checks out', () => {
  assert.equal(check(pass()).email, 'me@example.com')
  assert.equal(check(pass()).email_verified, true)
})

test('another app, another key, an expired pass, junk: refused', () => {
  assert.equal(check(pass({ aud: 'kitchenhub' })), null)
  assert.equal(check(pass({}, other.privateKey)), null)
  assert.equal(check(pass({ iat: secs - 400, exp: secs - 280 })), null)
  assert.equal(check('junk'), null)
})

test('the app id and public key built in are Wander and Hive', () => {
  const { HIVE_APP_ID, HIVE_PUBLIC_KEY } = require('./hivePass')
  assert.equal(HIVE_APP_ID, 'wander')
  assert.match(HIVE_PUBLIC_KEY, /^MCow/)
})
