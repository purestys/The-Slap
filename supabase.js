import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Import dinâmico: se o CDN estiver bloqueado/fora do ar, o app mostra o motivo em vez de tela em branco.
let createClient = null;
export let loadError = null;
try { ({ createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')); } catch (e) { loadError = e; }

const validProjectUrl = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(String(SUPABASE_URL || '').trim());
const validPublicKey = /^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)$/.test(String(SUPABASE_ANON_KEY || '').trim());
export const isConfigured = validProjectUrl && validPublicKey;

// "Permanecer conectado": marcado → sessão em localStorage (persiste); desmarcado → sessionStorage (some ao fechar a aba).
const REMEMBER = 'theclick-remember';
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
export const setRemember = (v) => safe(() => localStorage.setItem(REMEMBER, v ? '1' : '0'));
const remembered = () => safe(() => localStorage.getItem(REMEMBER) !== '0', true);

const storage = {
  getItem: (k) => safe(() => sessionStorage.getItem(k) ?? localStorage.getItem(k)),
  setItem: (k, v) => safe(() => {
    const [use, other] = remembered() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    use.setItem(k, v);
    other.removeItem(k);
  }),
  removeItem: (k) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }),
};

export const sb = isConfigured && createClient
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage,
        flowType: 'pkce',          // links de e-mail voltam com ?code=…, sem conflitar com as rotas #/…
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// O evento de recuperação de senha chega durante a inicialização; registramos já na criação do cliente.
let recovery = false;
if (sb) sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') recovery = true; });
export const isRecovery = () => recovery;
export const clearRecovery = () => { recovery = false; };
