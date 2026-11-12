import * as API from './api.js';
import { isRecovery } from './supabase.js';
import { state } from './state.js';
import { $, $$, html, raw, mount, icon, avatar, timeAgo, richText, toast, go } from './util.js';
import { field, textarea, bindForm, bindImagePicker, paged, postCard, galleryItem, personRow, followBtn, likeBtn, hashtagLinks } from './components.js';
import { toggleTheme, currentTheme } from './theme.js';

const errBox = html`<div class="form-error" role="alert" hidden></div>`;

export async function refreshBadge() {
  try {
    const count = await API.notifications.unreadCount();
    $$('[data-badge]').forEach((b) => { b.textContent = count > 99 ? '99+' : count; b.hidden = !count; });
  } catch { /* sem sessão ou offline */ }
}

// ============ Autenticação ====================================================
const authCard = (title, sub, body) => html`
  <div class="card auth-card">
    <div class="logo">${icon('logo')}<span>TheClick</span></div>
    <h1>${title}</h1><p class="sub">${sub}</p>${body}
  </div>`;

function entered(user) {
  state.me = user;
  go('#/');
}

export function login(el) {
  mount(el, authCard('Entrar', 'Veja o que a comunidade está fotografando.', html`
    <form id="f">${errBox}
      ${field('identifier', 'Usuário ou e-mail', { attrs: 'required autocomplete="username"' })}
      ${field('password', 'Senha', { type: 'password', attrs: 'required autocomplete="current-password"' })}
      <label class="check"><input type="checkbox" name="remember"> Permanecer conectado</label>
      <button class="btn block" type="submit">Entrar</button>
    </form>
    <p class="auth-alt"><a href="#/forgot">Esqueci minha senha</a></p>
    <p class="auth-alt">Ainda não tem conta? <a href="#/register">Criar conta</a></p>`));
  bindForm($('#f', el), async (fd) => {
    entered(await API.auth.login({
      identifier: fd.get('identifier'), password: fd.get('password'), remember: fd.get('remember') === 'on',
    }));
  });
}

export function register(el) {
  mount(el, authCard('Criar conta', 'Publique suas fotografias e descubra novos olhares.', html`
    <form id="f" enctype="multipart/form-data">${errBox}
      <div class="avatar-pick">
        <img class="avatar xl" id="preview" alt="" hidden>
        <div class="avatar xl ph" id="ph" aria-hidden="true">?</div>
        <label class="btn ghost sm">Foto de perfil (opcional)
          <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label>
      </div>
      <small class="err" data-err="avatar"></small>
      ${field('name', 'Nome completo', { attrs: 'required minlength="2" maxlength="80" autocomplete="name"' })}
      ${field('username', 'Nome de usuário', { attrs: 'required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_.]+" autocapitalize="none" autocomplete="username" placeholder="ex.: maria.lima"' })}
      ${field('email', 'E-mail', { type: 'email', attrs: 'required autocomplete="email"' })}
      ${field('password', 'Senha (mín. 8 caracteres)', { type: 'password', attrs: 'required minlength="8" autocomplete="new-password"' })}
      ${field('password2', 'Repita a senha', { type: 'password', attrs: 'required autocomplete="new-password"' })}
      ${textarea('bio', 'Biografia (opcional)', { attrs: 'maxlength="300"' })}
      <button class="btn block" type="submit">Criar conta</button>
    </form>
    <p class="auth-alt">Já tem conta? <a href="#/login">Entrar</a></p>`));
  const form = $('#f', el);
  bindImagePicker(form.elements.avatar, (url) => {
    $('#preview', el).src = url; $('#preview', el).hidden = false; $('#ph', el).hidden = true;
  }, 3);
  bindForm(form, async (fd) => {
    if (fd.get('password') !== fd.get('password2')) {
      const e = new Error('Corrija os campos destacados.');
      e.fields = { password2: 'As senhas não coincidem.' };
      throw e;
    }
    const photo = fd.get('avatar');
    const r = await API.auth.register({
      name: fd.get('name'), username: fd.get('username'), email: fd.get('email'),
      password: fd.get('password'), bio: fd.get('bio'), avatar: photo && photo.size ? photo : null,
    });
    if (r.needsConfirmation) {
      mount(el, authCard('Confirme seu e-mail', 'Quase lá!', html`
        <div class="form-ok">Enviamos um link de confirmação para <b>${fd.get('email')}</b>.
          Abra o e-mail, clique no link e depois entre na sua conta. Se quiser, adicione sua foto de perfil em Configurações.</div>
        <p class="auth-alt"><a href="#/login">Ir para o login</a></p>`));
      return;
    }
    entered(r.user);
  });
}

export function forgot(el) {
  mount(el, authCard('Recuperar senha', 'Informe seu e-mail e enviaremos um link para criar uma nova senha.', html`
    <form id="f">${errBox}<div class="form-ok" id="ok" hidden></div>
      ${field('email', 'E-mail', { type: 'email', attrs: 'required autocomplete="email"' })}
      <button class="btn block" type="submit">Enviar link</button>
    </form>
    <p class="auth-alt"><a href="#/login">Voltar para o login</a></p>`));
  bindForm($('#f', el), async (fd) => {
    const r = await API.auth.forgot(fd.get('email'));
    $('#ok', el).textContent = r.message;
    $('#ok', el).hidden = false;
  });
}

export function reset(el) {
  if (!state.me || !isRecovery()) {
    mount(el, authCard('Link inválido', 'Este link de recuperação é inválido ou expirou.', html`
      <p class="auth-alt"><a href="#/forgot">Pedir um novo link</a></p>
      <p class="auth-alt"><a href="#/login">Voltar para o login</a></p>`));
    return;
  }
  mount(el, authCard('Nova senha', 'Escolha uma senha nova para sua conta.', html`
    <form id="f">${errBox}
      ${field('password', 'Nova senha (mín. 8 caracteres)', { type: 'password', attrs: 'required minlength="8" autocomplete="new-password"' })}
      <button class="btn block" type="submit">Salvar senha</button>
    </form>
    <p class="auth-alt"><a href="#/login">Voltar para o login</a></p>`));
  bindForm($('#f', el), async (fd) => {
    const r = await API.auth.resetPassword(fd.get('password'));
    toast(r.message);
  });
}

// ============ Feed ============================================================
const loadMore = html`<button class="btn ghost more" id="more" hidden>Carregar mais</button>`;

export async function feed(el, { query }) {
  const scope = query.get('scope') === 'following' ? 'following' : 'all';
  mount(el, html`
    <div class="col">
      <div class="page-head"><h1>Início</h1>
        <nav class="tabs" aria-label="Filtro do feed">
          <a href="#/" class="${scope === 'all' ? 'on' : ''}">Todos</a>
          <a href="#/?scope=following" class="${scope === 'following' ? 'on' : ''}">Seguindo</a>
        </nav></div>
      <div class="feed" id="list"></div>
      <div class="card empty" id="empty" hidden>
        <h3>${scope === 'following' ? 'Nada por aqui ainda' : 'Nenhuma fotografia publicada'}</h3>
        <p>${scope === 'following' ? 'Siga outros fotógrafos para ver o trabalho deles aqui.' : 'Seja o primeiro a compartilhar um clique.'}</p>
        <a class="btn" href="${scope === 'following' ? '#/explore' : '#/new'}">${scope === 'following' ? 'Explorar perfis' : 'Publicar fotografia'}</a>
      </div>
      ${loadMore}
    </div>`);
  const r = await paged({
    list: $('#list', el), more: $('#more', el),
    fetchPage: (p) => API.posts.list({ scope, page: p }),
    render: (items) => items.map(postCard),
  });
  $('#empty', el).hidden = r.items.length > 0;
}

// ============ Explorar ========================================================
export async function explore(el, { query }) {
  const q = query.get('q') || '';
  const sort = query.get('sort') === 'popular' ? 'popular' : 'recent';
  const link = (s) => `#/explore?${new URLSearchParams({ ...(q && { q }), sort: s })}`;
  mount(el, html`
    <div class="col-wide">
      <div class="page-head"><h1>Explorar</h1>
        <nav class="tabs" aria-label="Ordenação">
          <a href="${link('recent')}" class="${sort === 'recent' ? 'on' : ''}">Recentes</a>
          <a href="${link('popular')}" class="${sort === 'popular' ? 'on' : ''}">Populares</a>
        </nav></div>
      <form class="search" id="search" role="search">
        <input type="search" name="q" value="${q}" placeholder="Buscar fotos, @usuários ou #hashtags" aria-label="Buscar" maxlength="80">
        <button class="btn" type="submit">Buscar</button>
      </form>
      <div id="sug"></div><div id="users"></div>
      <div class="masonry" id="list"></div>
      <div class="card empty" id="empty" hidden><h3>Nenhum resultado</h3><p>Tente outras palavras, uma #hashtag ou o @ de alguém.</p></div>
      ${loadMore}
    </div>`);
  $('#search', el).addEventListener('submit', (e) => {
    e.preventDefault();
    go(`#/explore?${new URLSearchParams({ q: new FormData(e.target).get('q').trim(), sort })}`);
  });

  if (!q) {
    API.profile.suggestions().then((users) => {
      if (!users.length) return;
      mount($('#sug', el), html`<h2 class="sub-head">Sugestões para seguir</h2>
        <div class="chips">${users.map((u) => html`<div class="card">${personRow(u)}</div>`)}</div>
        <h2 class="sub-head">Fotografias</h2>`);
    }).catch(() => {});
  }
  const r = await paged({
    list: $('#list', el), more: $('#more', el),
    fetchPage: (p) => API.explore.search({ q, sort, page: p }).then((d) => {
      if (p === 1 && d.users.length) {
        mount($('#users', el), html`<h2 class="sub-head">Pessoas</h2><div class="card people">${d.users.map(personRow)}</div>
          ${d.items.length ? html`<h2 class="sub-head">Fotografias</h2>` : ''}`);
      }
      return d;
    }),
    render: (items) => items.map(galleryItem),
  });
  $('#empty', el).hidden = r.items.length > 0 || r.users.length > 0;
}

// ============ Publicar ========================================================
export function newPost(el) {
  mount(el, html`
    <div class="col">
      <div class="page-head"><h1>Publicar fotografia</h1></div>
      <form class="card pad" id="f" enctype="multipart/form-data">${errBox}
        <label class="drop" id="drop">
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required>
          <span id="drop-empty">${icon('image')}<strong>Escolher fotografia</strong><br><span class="hint">JPG, PNG, WEBP ou GIF · até 8 MB</span></span>
          <img id="preview" alt="Prévia da fotografia" hidden>
        </label>
        <small class="err" data-err="image"></small>
        ${field('title', 'Título', { attrs: 'required maxlength="100"' })}
        ${textarea('caption', 'Legenda', { attrs: 'maxlength="2000" placeholder="Conte a história por trás do clique"' })}
        ${field('tags', 'Hashtags', { attrs: 'placeholder="#paisagem #pordosol"' })}
        <button class="btn block" type="submit">Publicar</button>
      </form>
    </div>`);
  const form = $('#f', el);
  bindImagePicker(form.elements.image, (url) => {
    $('#preview', el).src = url; $('#preview', el).hidden = false; $('#drop-empty', el).hidden = true;
  }, 8);
  bindForm(form, async (fd) => {
    const id = await API.posts.create({
      file: fd.get('image'), title: fd.get('title'), caption: fd.get('caption'), tags: fd.get('tags'),
    }, state.me.id);
    toast('Publicado!');
    go(`#/post/${id}`);
  });
}

// ============ Publicação + comentários ========================================
let commentsListener = null;

const commentHtml = (c, isReply) => html`
  <div class="comment">
    <a href="#/u/${c.username}">${avatar(c, 'sm')}</a>
    <div class="c-body">
      <div><a class="name" href="#/u/${c.username}">${c.name}</a> <span class="muted">· ${timeAgo(c.created_at)}</span></div>
      <p>${c.content}</p>
      <div class="c-actions">
        <button class="link" data-action="reply" data-id="${c.id}" data-username="${c.username}">Responder</button>
        ${c.user_id === state.me.id ? html`<button class="link danger" data-action="delete-comment" data-id="${c.id}">Excluir</button>` : ''}
      </div>
    </div>
  </div>`;

function commentTree(list) {
  const top = list.filter((c) => !c.parent_comment_id);
  if (!top.length) return html`<p class="muted">Seja o primeiro a comentar.</p>`;
  return html`${top.map((c) => html`${commentHtml(c)}
    <div class="replies">${list.filter((r) => r.parent_comment_id === c.id).map((r) => commentHtml(r, true))}</div>`)}`;
}

export async function postPage(el, ctx) {
  const id = ctx.params[0];
  const p = await API.posts.get(id);
  const mine = p.user_id === state.me.id;
  mount(el, html`
    <div class="col-wide post-page">
      <div class="media"><img src="${p.image_url}" alt="${p.title}"></div>
      <aside class="card side-panel">
        <div class="post-head">
          <a href="#/u/${p.username}">${avatar(p)}</a>
          <div><a class="name" href="#/u/${p.username}">${p.name}</a><small>@${p.username} · ${timeAgo(p.created_at)}</small></div>
          ${mine ? html`<div class="owner"><button class="link" data-action="toggle-edit">Editar</button>
            <button class="link danger" data-action="delete-post" data-id="${p.id}">Excluir</button></div>` : ''}
        </div>
        <div class="post-body" id="post-view">
          <h2>${p.title}</h2>
          ${p.caption ? html`<p class="caption">${richText(p.caption)}</p>` : ''}
          ${hashtagLinks(p)}
        </div>
        ${mine ? html`<form class="post-body" id="post-edit" hidden>${errBox}
          ${field('title', 'Título', { value: p.title, attrs: 'required maxlength="100"' })}
          ${textarea('caption', 'Legenda', { value: p.caption, attrs: 'maxlength="2000"' })}
          ${field('tags', 'Hashtags', { value: p.hashtags.map((t) => '#' + t).join(' ') })}
          <button class="btn sm" type="submit">Salvar</button>
          <button class="btn ghost sm" type="button" data-action="toggle-edit">Cancelar</button></form>` : ''}
        <div class="post-actions">${likeBtn(p)}
          <button class="act right" data-action="share" data-id="${p.id}" aria-label="Compartilhar">${icon('share')}</button></div>
        <section class="comments">
          <h3>Comentários</h3>
          <div id="comment-list"></div>
          <form class="comment-form" id="comment-form">
            <div class="replying" id="replying" hidden><span>Respondendo a <b id="replying-name"></b></span>
              <button class="link" type="button" data-action="cancel-reply">Cancelar</button></div>
            ${errBox}
            <input type="hidden" name="parent_comment_id" value="">
            <textarea name="content" required maxlength="1000" placeholder="Adicione um comentário" aria-label="Comentário"></textarea>
            <button class="btn sm" type="submit">Comentar</button>
          </form>
        </section>
      </aside>
    </div>`);

  async function loadComments() {
    mount($('#comment-list', el), commentTree(await API.comments.list(id)));
  }
  if (commentsListener) document.removeEventListener('comments:changed', commentsListener);
  commentsListener = () => loadComments().catch((e) => toast(e.message, 'error'));
  document.addEventListener('comments:changed', commentsListener);
  await loadComments();

  const cform = $('#comment-form', el);
  bindForm(cform, async (fd) => {
    await API.comments.add(id, fd.get('content'), fd.get('parent_comment_id') || null);
    cform.reset();
    $('#replying', el).hidden = true;
    await loadComments();
  });

  if (mine) {
    bindForm($('#post-edit', el), async (fd) => {
      await API.posts.update(id, { title: fd.get('title'), caption: fd.get('caption'), tags: fd.get('tags') });
      toast('Alterações salvas.');
      await postPage(el, ctx);
    });
  }
}

// ============ Perfil ==========================================================
export async function profile(el, { params }) {
  const username = params[0];
  const u = await API.profile.get(username);
  const mine = u.id === state.me.id;
  mount(el, html`
    <div class="col-wide">
      <header class="profile-head">
        ${avatar(u, 'xl')}
        <div class="profile-info">
          <div class="profile-top"><h1>${u.name}</h1>
            ${mine ? html`<a class="btn ghost sm" href="#/settings">Editar perfil</a>` : followBtn(u.username, u.is_following)}</div>
          <div class="muted">@${u.username}</div>
          <div class="stats">
            <span><b>${u.posts_count}</b> publicações</span>
            <a href="#/u/${u.username}/followers"><b data-followers-of="${u.username}">${u.followers_count}</b> seguidores</a>
            <a href="#/u/${u.username}/following"><b>${u.following_count}</b> seguindo</a>
          </div>
          ${u.bio ? html`<p class="bio">${u.bio}</p>` : ''}
        </div>
      </header>
      <div class="grid" id="list"></div>
      <div class="card empty" id="empty" hidden>
        <h3>${mine ? 'Você ainda não publicou' : 'Nenhuma publicação ainda'}</h3>
        ${mine ? html`<p>Compartilhe sua primeira fotografia com a comunidade.</p><a class="btn" href="#/new">Publicar fotografia</a>` : ''}
      </div>
      ${loadMore}
    </div>`);
  const r = await paged({
    list: $('#list', el), more: $('#more', el),
    fetchPage: (p) => API.profile.posts(username, u.id, p),
    render: (items) => items.map(galleryItem),
  });
  $('#empty', el).hidden = r.items.length > 0;
}

export async function followList(el, { params }) {
  const [username, which] = params;
  const { user, users } = await API.profile.followList(username, which);
  mount(el, html`
    <div class="col">
      <div class="page-head"><div><h1>${which === 'followers' ? 'Seguidores' : 'Seguindo'}</h1>
        <a class="muted" href="#/u/${user.username}">@${user.username}</a></div></div>
      ${users.length ? html`<div class="card people">${users.map(personRow)}</div>`
        : html`<div class="card empty"><h3>Ninguém por aqui ainda</h3></div>`}
    </div>`);
}

// ============ Notificações ====================================================
const NOTIF_TEXT = {
  like: 'curtiu sua fotografia.', comment: 'comentou na sua fotografia.',
  reply: 'respondeu ao seu comentário.', follow: 'começou a seguir você.',
};

export async function notifications(el) {
  const list = await API.notifications.list();
  const unread = list.filter((n) => !n.is_read).length;
  mount(el, html`
    <div class="col">
      <div class="page-head"><h1>Notificações</h1>
        ${unread ? html`<button class="btn ghost sm" id="read-all">Marcar todas como lidas</button>` : ''}</div>
      ${list.length ? html`<div class="card" id="nlist">${list.map((n) => html`
        <a class="notif ${n.is_read ? '' : 'unread'}" data-notif="${n.id}"
           href="${n.type === 'follow' ? `#/u/${n.username}` : `#/post/${n.post_id}`}">
          ${avatar(n, 'sm')}
          <div class="txt"><b>${n.name}</b> ${NOTIF_TEXT[n.type]} <span class="muted">${timeAgo(n.created_at)}</span></div>
          ${n.post_image ? html`<img class="thumb" src="${n.post_image}" alt="">` : ''}
          ${n.is_read ? '' : html`<span class="dot" aria-label="Não lida"></span>`}
        </a>`)}</div>`
        : html`<div class="card empty"><h3>Sem notificações</h3><p>Curtidas, comentários e novos seguidores aparecem aqui.</p></div>`}
    </div>`);
  refreshBadge();
  $('#read-all', el)?.addEventListener('click', async () => {
    await API.notifications.markAllRead();
    await notifications(el);
  });
  $('#nlist', el)?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-notif]');
    if (item) API.notifications.markRead(item.dataset.notif).then(refreshBadge).catch(() => {});
  });
}

// ============ Configurações ===================================================
export function settings(el) {
  const me = state.me;
  mount(el, html`
    <div class="col">
      <div class="page-head"><h1>Configurações</h1></div>
      <form class="card pad mb" id="profile" enctype="multipart/form-data">
        <h2 class="h-sp">Perfil</h2>${errBox}
        <div class="avatar-pick">
          <span id="cur">${avatar(me, 'xl')}</span><img class="avatar xl" id="preview" alt="" hidden>
          <div><label class="btn ghost sm">Trocar foto
            <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label>
            ${me.profile_picture ? html`<label class="check mt"><input type="checkbox" name="remove_avatar"> Remover foto atual</label>` : ''}</div>
        </div>
        ${field('name', 'Nome completo', { value: me.name, attrs: 'required minlength="2" maxlength="80"' })}
        ${field('username', 'Nome de usuário', { value: me.username, attrs: 'required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_.]+" autocapitalize="none"' })}
        ${textarea('bio', 'Biografia', { value: me.bio, attrs: 'maxlength="300"' })}
        <button class="btn" type="submit">Salvar perfil</button>
      </form>
      <form class="card pad mb" id="pwd">
        <h2 class="h-sp">Senha</h2>${errBox}
        ${field('current_password', 'Senha atual', { type: 'password', attrs: 'required autocomplete="current-password"' })}
        ${field('new_password', 'Nova senha (mín. 8 caracteres)', { type: 'password', attrs: 'required minlength="8" autocomplete="new-password"' })}
        <button class="btn" type="submit">Alterar senha</button>
      </form>
      <div class="card pad row">
        <button class="btn ghost" data-action="toggle-theme">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')} Alternar modo claro/escuro</button>
        <button class="btn danger" data-action="logout">${icon('logout')} Sair da conta</button>
      </div>
    </div>`);
  const form = $('#profile', el);
  bindImagePicker(form.elements.avatar, (url) => {
    $('#preview', el).src = url; $('#preview', el).hidden = false; $('#cur', el).hidden = true;
  }, 3);
  bindForm(form, async (fd) => {
    const row = await API.profile.update({
      name: fd.get('name'), username: fd.get('username'), bio: fd.get('bio'),
      avatar: fd.get('avatar'), removeAvatar: fd.get('remove_avatar') === 'on',
    }, state.me);
    state.me = { ...state.me, ...row };
    document.dispatchEvent(new CustomEvent('me:changed'));
    toast('Perfil atualizado.');
    settings(el);
  });
  bindForm($('#pwd', el), async (fd) => {
    await API.auth.changePassword(state.me.email, fd.get('current_password'), fd.get('new_password'));
    $('#pwd', el).reset();
    toast('Senha alterada.');
  });
}
