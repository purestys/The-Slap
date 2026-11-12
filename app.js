import { auth } from './api.js';
import { isConfigured, isRecovery, loadError } from './supabase.js';
import { state } from './state.js';
import { $, $$, html, mount, icon, go, toast } from './util.js';
import { initActions } from './components.js';
import { initTheme } from './theme.js';
import * as V from './views.js';

const routes = [
  [/^\/login$/, V.login, true], [/^\/register$/, V.register, true],
  [/^\/forgot$/, V.forgot, true], [/^\/reset$/, V.reset, 'any'],
  [/^\/$/, V.feed], [/^\/explore$/, V.explore], [/^\/new$/, V.newPost],
  [/^\/notifications$/, V.notifications], [/^\/settings$/, V.settings],
  [/^\/post\/(\d+)$/, V.postPage],
  [/^\/u\/([a-zA-Z0-9_.]+)$/, V.profile],
  [/^\/u\/([a-zA-Z0-9_.]+)\/(followers|following)$/, V.followList],
];

let shell = null; // 'app' | 'auth'

function buildShell(kind) {
  if (shell === kind) return;
  shell = kind;
  if (kind === 'auth') {
    $('#app').innerHTML = '<div class="auth-wrap"><main id="main"></main></div>';
    return;
  }
  const nav = [
    ['/', 'home', 'Início'], ['/explore', 'explore', 'Explorar'], ['/new', 'plus', 'Publicar'],
    ['/notifications', 'bell', 'Notificações'], [`/u/${state.me.username}`, 'user', 'Perfil'], ['/settings', 'settings', 'Configurações'],
  ];
  mount($('#app'), html`
    <div class="shell">
      <header class="topbar">
        <a class="logo" href="#/">${icon('logo')}<span>The Slap</span></a>
      </header>
      <aside class="sidebar">
        <a class="logo" href="#/">${icon('logo')}<span>The Slap</span></a>
        <nav class="nav" aria-label="Principal">
          ${nav.map(([href, ic, label]) => html`
            <a href="#${href}" data-route="${href}" aria-label="${label}">${icon(ic)}<span class="label">${label}</span>
              ${ic === 'bell' ? html`<span class="badge" data-badge hidden>0</span>` : ''}</a>`)}
        </nav>
        <div class="side-foot">
        </div>
      </aside>
      <main id="main"></main>
    </div>`);
  V.refreshBadge();
}

function setActive(path) {
  $$('.nav a').forEach((a) => {
    const r = a.dataset.route;
    a.classList.toggle('active', r === path);
    if (r === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const found = routes.map(([re, fn, isAuth]) => [re.exec(path), fn, isAuth]).find((r) => r[0]);
  if (!found) return go('#/');
  const [m, fn, isAuth] = found;

  const authShell = !!isAuth; // 'any' (redefinir senha) usa o layout de autenticação, logado ou não
  if (isAuth === true && state.me) return go('#/');
  if (!isAuth && !state.me) return go('#/login');

  buildShell(authShell ? 'auth' : 'app');
  if (!authShell) setActive(path);

  // Cada navegação usa um contêiner novo: respostas atrasadas da tela anterior não sobrescrevem a atual.
  const view = document.createElement('div');
  $('#main').replaceChildren(view);
  window.scrollTo(0, 0);
  try {
    await fn(view, { params: m.slice(1), query: new URLSearchParams(qs || '') });
  } catch (err) {
    if (err.status === 401 && state.me) { state.me = null; shell = null; return go('#/login'); }
    mount(view, html`<div class="col"><div class="card empty">
      <h3>${err.status === 404 ? 'Não encontramos isso' : 'Algo deu errado'}</h3><p>${err.message}</p>
      <a class="btn" href="#/">Voltar ao início</a></div></div>`);
  }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action="logout"]');
  if (!el) return;
  if (window.confirm('Deseja realmente sair da conta?')) {
    await auth.logout(); // o evento SIGNED_OUT limpa o estado e leva ao login
  }
});

document.addEventListener('me:changed', () => {
  const a = $('.nav a[data-route^="/u/"]');
  if (a) { a.dataset.route = `/u/${state.me.username}`; a.href = `#/u/${state.me.username}`; }
});

function setupScreen(title, text) {
  initTheme();
  mount($('#app'), html`
    <div class="auth-wrap"><main id="main"><div class="card auth-card">
      <div class="logo">${icon('logo')}<span>The Slap</span></div>
      <h1>${title}</h1>
      <p class="sub">${text}</p>
    </div></main></div>`);
}

// Erros de links do Supabase (ex.: link de e-mail expirado) chegam no # da URL.
function readLinkError() {
  const h = location.hash.slice(1);
  if (!/(^|&)error(_description|_code)?=/.test(h)) return;
  const p = new URLSearchParams(h);
  const expired = /expired|invalid/i.test(`${p.get('error_code')} ${p.get('error_description')}`);
  toast(expired ? 'Este link expirou ou já foi usado. Peça um novo.' : (p.get('error_description') || 'Não foi possível concluir.'), 'error');
  history.replaceState(null, '', location.pathname + '#/login');
}

async function boot() {
  if (loadError) return setupScreen('Não foi possível carregar o Supabase', 'O arquivo da biblioteca (cdn.jsdelivr.net) não carregou. Verifique a internet, bloqueadores de anúncios/rede e se o site está sendo aberto por http(s), não por file://. Detalhe: ' + (loadError.message || loadError));
  if (!isConfigured) return setupScreen('Falta conectar o Supabase', 'Abra config.js na raiz do projeto e preencha SUPABASE_URL e SUPABASE_ANON_KEY com os dados de Project Settings → API. Use somente a chave pública anon/publishable, nunca service_role. Consulte o LEIAME.md.');
  initTheme();
  initActions();
  state.me = await auth.me();
  // Remove ?code=… deixado pelo link de e-mail (confirmação / recuperação de senha).
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  readLinkError();
  if (isRecovery()) location.hash = '#/reset';
  auth.onSignedOut(() => {
    if (!state.me && !shell) return;
    state.me = null; shell = null;
    if (location.hash !== '#/login') go('#/login'); else route();
  });
  window.addEventListener('hashchange', route);
  setInterval(() => { if (state.me && !document.hidden) V.refreshBadge(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (state.me && !document.hidden) V.refreshBadge(); });
  route();
}
boot().catch((e) => setupScreen('Erro ao iniciar', String(e && e.message || e)));
