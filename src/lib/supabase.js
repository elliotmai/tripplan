import { createBrowserClient } from '@supabase/ssr';

/*
 * Wander lives in Hive's Supabase project (schema wander), so it
 * shares one sign-in with Hive and every app under flyingdoublemranch.com:
 * the session is a cookie for the whole domain, the same as Hive's. Both
 * values are public by design; the database's row-level security decides who
 * reads what.
 */
export const SUPABASE_URL = 'https://fcjiummxpacwriwopcho.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S';
export const HIVE_ORIGIN = 'https://hive.flyingdoublemranch.com';

const SHARED_DOMAIN = 'flyingdoublemranch.com';
const host = window.location.hostname;
const shared = host === SHARED_DOMAIN || host.endsWith(`.${SHARED_DOMAIN}`);

export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  cookieOptions: {
    name: 'hive-auth', path: '/', sameSite: 'lax', secure: window.location.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 400,
    ...(shared ? { domain: `.${SHARED_DOMAIN}` } : {}),
  },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export const wander = supabase.schema('wander');
