import * as API from './api.js';
import { isRecovery } from './supabase.js';
import { state } from './state.js';
import { $, $$, html, raw, mount, icon, avatar, timeAgo, richText, toast, go } from './util.js';
import { field, textarea, bindForm, bindImagePicker, paged, postCard, galleryItem, personRow, followBtn, likeBtn, hashtagLinks } from './components.js';

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
      <div class="page-head"><h1>Criar publicação</h1></div>
      <form class="card pad" id="f" enctype="multipart/form-data">${errBox}
        <label class="drop" id="drop">
          <input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
          <span id="drop-empty">${icon('image')}<strong>Escolher até 4 fotos (opcional)</strong><br><span class="hint">JPG, PNG, WEBP ou GIF</span></span>
        </label>
        <div class="image-previews" id="image-previews"></div>
        <label class="drop video-drop" id="video-drop">
          <input type="file" name="video" accept="video/mp4,video/webm,video/ogg">
          <span id="video-empty">${icon('video')}<strong>Ou escolha 1 vídeo</strong><br><span class="hint">MP4, WEBM ou OGG · você também pode publicar só texto</span></span>
        </label>
        <div id="video-preview" class="video-preview" hidden></div>
        <small class="err" data-err="video"></small>
        <small class="err" data-err="images"></small>
        ${field('title', 'Título', { attrs: 'required maxlength="100"' })}
          ${textarea('caption', 'Legenda', { attrs: 'maxlength="2000" placeholder="Conte oque está pensando"' })}
        <label class="check"><input type="checkbox" name="is_sensitive"> Esta publicação contém mídia sensível</label>
        <label class="field"><span>Feeling</span><input type="text" name="mood" placeholder="Como você está se sentindo? (opcional)" autocomplete="off"></label>
        ${field('tags', 'Hashtags', { attrs: 'placeholder="#paisagem #pordosol"' })}
        <button class="btn block" type="submit">Publicar</button>
      </form>
    </div>`);
  const form = $('#f', el);
  const imageInput = form.elements.images;
  const videoInput = form.elements.video;
  let selectedImages = [];
  let selectedVideo = null;
  const previewBox = $('#image-previews', el);
  const videoPreview = $('#video-preview', el);
  let previewUrls = [];
  let videoPreviewUrl = null;
  const renderPreviews = () => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = selectedImages.map((file) => URL.createObjectURL(file));
    previewBox.innerHTML = selectedImages.map((file, index) => `<div class="image-preview"><img src="${previewUrls[index]}" alt="Prévia ${index + 1}" loading="lazy"><button type="button" class="remove-preview" data-remove-image="${index}" aria-label="Remover foto">×</button></div>`).join('');
    $('#drop-empty', el).hidden = selectedImages.length > 0 || !!selectedVideo;
    $('#video-drop', el).hidden = selectedImages.length > 0;
  };
  const renderVideoPreview = () => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    videoPreviewUrl = selectedVideo ? URL.createObjectURL(selectedVideo) : null;
    videoPreview.innerHTML = selectedVideo
      ? `<video controls playsinline preload="metadata" src="${videoPreviewUrl}"></video><button type="button" class="btn ghost sm" data-remove-video>Remover vídeo</button>`
      : '';
    videoPreview.hidden = !selectedVideo;
    $('#drop-empty', el).hidden = selectedImages.length > 0 || !!selectedVideo;
    $('#video-drop', el).hidden = selectedImages.length > 0;
  };
  imageInput.addEventListener('change', () => {
    const incoming = [...imageInput.files];
    if (selectedVideo) {
      toast('Escolha fotos ou um vídeo por publicação, não os dois juntos.', 'error');
      imageInput.value = '';
      return;
    }
    if (selectedImages.length + incoming.length > 4) {
      toast('Você pode publicar no máximo 4 fotos por vez.', 'error');
      imageInput.value = '';
      return;
    }
    for (const file of incoming) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { toast('Formato inválido. Use JPG, PNG, WEBP ou GIF.', 'error'); continue; }
      selectedImages.push(file);
    }
    imageInput.value = '';
    renderPreviews();
  });
  videoInput.addEventListener('change', () => {
    const file = videoInput.files?.[0];
    videoInput.value = '';
    if (!file) return;
    if (selectedImages.length) {
      toast('Escolha fotos ou um vídeo por publicação, não os dois juntos.', 'error');
      return;
    }
    if (!/^video\/(mp4|webm|ogg)$/.test(file.type)) {
      toast('Formato inválido. Use MP4, WEBM ou OGG.', 'error');
      return;
    }
    selectedVideo = file;
    renderVideoPreview();
  });
  previewBox.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-image]');
    if (!button) return;
    selectedImages.splice(Number(button.dataset.removeImage), 1);
    renderPreviews();
  });
  videoPreview.addEventListener('click', (event) => {
    if (!event.target.closest('[data-remove-video]')) return;
    selectedVideo = null;
    renderVideoPreview();
  });
  bindForm(form, async (fd) => {
    const id = await API.posts.create({
      files: selectedImages, video: selectedVideo, title: fd.get('title'), caption: fd.get('caption'), tags: fd.get('tags'), mood: fd.get('mood'), is_sensitive: fd.get('is_sensitive') === 'on',
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
      ${(p.image_urls?.length || p.video_url) ? (p.is_sensitive && !state.me?.show_sensitive_media ? html`<div class="sensitive-cover"><b>Mídia sensível</b><span>Ative a exibição nas configurações para visualizar esta mídia.</span></div>` : (p.video_url ? html`<div class="media post-video-wrap"><video src="${p.video_url}" controls playsinline preload="metadata"></video></div>` : html`<div class="media media-gallery">${(p.image_urls?.length ? p.image_urls : [p.image_url]).slice(0,4).map((url) => html`<img src="${url}" alt="${p.title}" loading="lazy" decoding="async">`)}</div>`)) : ''}
      <aside class="card side-panel">
        <div class="post-head">
          <a href="#/u/${p.username}">${avatar(p)}</a>
          <div><a class="name" href="#/u/${p.username}">${p.name}</a><small>@${p.username} · ${timeAgo(p.created_at)}</small></div>
          ${mine ? html`<div class="owner"><button class="link" data-action="toggle-edit">Editar</button>
            <button class="link danger" data-action="delete-post" data-id="${p.id}">Excluir</button></div>` : ''}
        </div>
        <div class="post-body" id="post-view">
          ${p.mood ? html`<span class="mood">${p.mood}</span>` : ''}
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
  const locked = !!u.is_private && !mine && !u.is_following;
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
      ${locked ? html`<div class="card empty private-notice"><h3>Este perfil é privado</h3><p>Somente seguidores podem ver as publicações.</p></div>` : html`<div class="grid" id="list"></div>`}
      <div class="card empty" id="empty" hidden>
        <h3>${mine ? 'Você ainda não publicou' : 'Nenhuma publicação ainda'}</h3>
        ${mine ? html`<p>Compartilhe sua primeira fotografia com a comunidade.</p><a class="btn" href="#/new">Publicar fotografia</a>` : ''}
      </div>
      ${loadMore}
    </div>`);
  if (!locked) {
    const r = await paged({
      list: $('#list', el), more: $('#more', el),
      fetchPage: (p) => API.profile.posts(username, u.id, p),
      render: (items) => items.map(galleryItem),
    });
    $('#empty', el).hidden = r.items.length > 0;
  } else { $('#empty', el).hidden = true; $('#more', el).hidden = true; }
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
      <form class="card pad mb" id="privacy-form">
        <h2 class="h-sp">Privacidade e segurança</h2>
        <p class="hint">Controle como as pessoas encontram seu perfil e veem suas publicações.</p>
        <label class="privacy-option"><span><b>Perfil privado</b><small>Somente seguidores podem visualizar suas publicações.</small></span><input type="checkbox" name="is_private" ${me.is_private ? 'checked' : ''}></label>
        <label class="privacy-option"><span><b>Mostrar meu perfil na busca</b><small>Permite que outras pessoas encontrem seu perfil ao pesquisar no TheClick.</small></span><input type="checkbox" name="show_in_search" ${me.show_in_search !== false ? 'checked' : ''}></label>
        <label class="privacy-option"><span><b>Exibir mídia sensível</b><small>Permite exibir mídias que possam conter conteúdo sensível sem aviso adicional.</small></span><input type="checkbox" name="show_sensitive_media" ${me.show_sensitive_media ? 'checked' : ''}></label>
        <label class="privacy-option"><span><b>Receber notificações</b><small>Ativa notificações de curtidas, comentários e novos seguidores.</small></span><input type="checkbox" name="notifications_enabled" ${me.notifications_enabled !== false ? 'checked' : ''}></label>
        <button class="btn" type="submit">Salvar privacidade</button>
      </form>
      <div class="card pad mb settings-actions">
        <h2 class="h-sp">Conta</h2>
        <p class="muted">Ao sair, você precisará entrar novamente para acessar seu perfil.</p>
        <button class="btn danger" type="button" data-action="logout">${icon('logout')} Sair da conta</button>
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
  bindForm($('#privacy-form', el), async (fd) => {
    const row = await API.profile.savePrivacy({
      is_private: fd.get('is_private') === 'on',
      show_in_search: fd.get('show_in_search') === 'on',
      show_sensitive_media: fd.get('show_sensitive_media') === 'on',
      notifications_enabled: fd.get('notifications_enabled') === 'on',
    });
    state.me = { ...state.me, ...row };
    toast('Preferências de privacidade salvas.');
    settings(el);
  });
  bindForm($('#pwd', el), async (fd) => {
    await API.auth.changePassword(state.me.email, fd.get('current_password'), fd.get('new_password'));
    $('#pwd', el).reset();
    toast('Senha alterada.');
  });
}
