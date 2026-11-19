// functions/hivePass.js
// Hive passes: how Hive (the home-screen app in the Fridge-Board repo) vouches
// for whoever is signed in to it, so the fridge reads Wander as that
// person and no token has to be stored anywhere.
//
// A pass is a JWT signed with Ed25519 by Hive's server, made for one app
// (aud), good for two minutes, carrying an email Hive has confirmed. Sent as
// `Authorization: Hive <pass>`. The public key below only checks passes; it
// can't make them, so it isn't secret.
//
// Port of Fridge-Board netlify/lib/hiveAssertion.mjs (the verify half).

const { createPublicKey, verify } = require('node:crypto');

const HIVE_APP_ID = 'wander';
const HIVE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAD+9fPYhGN9ftY8MGu8oQZdgfSMZL7coC6pZ812weWVE=';

const ISSUER = 'hive';
const PASS_SECONDS = 120;
const LEEWAY = 30;

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * The pass's claims, or null for anything wrong with it.
 * @returns {{ sub: string, email: string|null, email_verified: boolean, name: string|null } | null}
 */
const verifyHivePass = (
  pass,
  { now = Date.now(), app = process.env.HIVE_APP_ID || HIVE_APP_ID, publicKey = process.env.HIVE_PUBLIC_KEY || HIVE_PUBLIC_KEY } = {},
) => {
  const parts = String(pass || '').split('.');
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = decode(parts[0]);
    claims = decode(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'EdDSA') return null;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) return null;
  } catch {
    return null;
  }
  const secs = Math.floor(now / 1000);
  if (claims.iss !== ISSUER || claims.aud !== app) return null;
  if (!(claims.exp + LEEWAY > secs) || !(claims.iat - LEEWAY <= secs) || claims.exp - claims.iat > PASS_SECONDS) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) return null;
  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    email_verified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name : null,
  };
};

module.exports = { HIVE_APP_ID, HIVE_PUBLIC_KEY, verifyHivePass };
