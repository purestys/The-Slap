import { posts, comments, profile } from './api.js';
import { state } from './state.js';
import { $, $$, html, raw, icon, avatar, timeAgo, richText, toast, go } from './util.js';

// ---- Formulários --------------------------------------------------------------
export const field = (name, label, o = {}) => html`
  <label class="field"><span>${label}</span>
    <input name="${name}" type="${o.type || 'text'}" value="${o.value || ''}" ${raw(o.attrs || '')}>
    <small class="err" data-err="${name}"></small></label>`;

export const textarea = (name, label, o = {}) => html`
  <label class="field"><span>${label}</span>
    <textarea name="${name}" ${raw(o.attrs || '')}>${o.value || ''}</textarea>
    <small class="err" data-err="${name}"></small></label>`;

export function showErrors(form, message, fields = {}) {
  const box = $('.form-error', form);
  if (box) { box.textContent = message || ''; box.hidden = !message; }
  $$('[data-err]', form).forEach((el) => { el.textContent = (fields && fields[el.dataset.err]) || ''; });
}

export function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('[type=submit]', form);
    showErrors(form, '');
    btn.disabled = true;
    try {
      await handler(new FormData(form));
    } catch (err) {
      showErrors(form, err.message, err.fields);
    } finally {
      btn.disabled = false;
    }
  });
}

// Prévia de imagem + validação de formato e tamanho no navegador.
export function bindImagePicker(input, onPick, maxMb = Infinity) {
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      input.value = '';
      return toast('Formato inválido. Use JPG, PNG, WEBP ou GIF.', 'error');
    }
    if (file.size > maxMb * 1024 * 1024) {
      input.value = '';
      return toast(`A imagem excede ${maxMb} MB.`, 'error');
    }
    onPick(URL.createObjectURL(file));
  });
}

// ---- Listas paginadas -----------------------------------------------------------
export async function paged({ list, more, fetchPage, render }) {
  let page = 1;
  const load = async () => {
    const r = await fetchPage(page);
    const out = render(r.items);
    list.insertAdjacentHTML('beforeend', (Array.isArray(out) ? out : [out]).map((x) => x.s).join(''));
    more.hidden = !r.hasMore;
    return r;
  };
  more.addEventListener('click', async () => {
    page += 1;
    more.disabled = true;
    try { await load(); } catch (e) { page -= 1; toast(e.message, 'error'); }
    more.disabled = false;
  });
  return load();
}

// ---- Cartões -------------------------------------------------------------------
export const likeBtn = (p) => html`
  <button class="act ${p.liked ? 'on' : ''}" data-action="like" data-id="${p.id}" aria-pressed="${p.liked}" aria-label="Curtir">
    ${icon('heart')}<span class="count">${p.likes_count}</span></button>`;

export const hashtagLinks = (p) => (p.hashtags.length
  ? html`<div class="tags">${p.hashtags.map((t) => html`<a href="#/explore?q=%23${encodeURIComponent(t)}">#${t}</a>`)}</div>`
  : '');

export const postCard = (p) => html`
  <article class="card post">
    <div class="post-head">
      <a href="#/u/${p.username}">${avatar(p)}</a>
      <div><a class="name" href="#/u/${p.username}">${p.name}</a>
        <small>@${p.username} · ${timeAgo(p.created_at)}</small></div>
    </div>
    ${(p.image_urls?.length || p.video_url) ? (p.is_sensitive && !state.me?.show_sensitive_media ? html`<a class="sensitive-cover" href="#/post/${p.id}"><b>Mídia sensível</b><span>Abra a publicação para visualizar ou altere sua preferência nas configurações.</span></a>` : (p.video_url ? html`<div class="post-video-wrap"><video src="${p.video_url}" controls playsinline preload="metadata"></video></div>` : html`<a class="post-img post-gallery count-${(p.image_urls?.length || (p.image_url ? 1 : 0))}" href="#/post/${p.id}">${(p.image_urls?.length ? p.image_urls : [p.image_url]).slice(0,4).map((url) => html`<img src="${url}" alt="${p.title}" loading="lazy" decoding="async">`)}</a>`)) : ''}
    <div class="post-body">
      ${p.mood ? html`<span class="mood">${p.mood}</span>` : ''}
      <h3>${p.title}</h3>
      ${p.caption ? html`<p class="caption">${richText(p.caption)}</p>` : ''}
      ${hashtagLinks(p)}
    </div>
    <div class="post-actions">
      ${likeBtn(p)}
      <a class="act" href="#/post/${p.id}" aria-label="Comentar">${icon('comment')}<span>${p.comments_count}</span></a>
      <button class="act right" data-action="share" data-id="${p.id}" aria-label="Compartilhar">${icon('share')}</button>
    </div>
  </article>`;

export const galleryItem = (p) => {
  const image = p.image_url || p.image_urls?.[0] || null;
  if (!image && !p.video_url) return '';
  const sensitive = p.is_sensitive && !state.me?.show_sensitive_media;
  return html`
    <a class="g-item profile-post-tile ${p.video_url ? 'is-video' : ''} ${sensitive ? 'is-sensitive' : ''}" href="#/post/${p.id}" title="${p.title}" aria-label="Abrir publicação: ${p.title}">
      ${sensitive ? html`<span class="profile-sensitive">Mídia sensível</span>` : (p.video_url
        ? html`<video src="${p.video_url}" muted playsinline preload="metadata" aria-label="Prévia do vídeo"></video><span class="profile-video-mark" aria-hidden="true">▶</span>`
        : html`<img src="${image}" alt="${p.title}" loading="lazy" decoding="async">`)}
      <span class="g-over"><span>♥ ${p.likes_count}</span><span>💬 ${p.comments_count}</span></span>
    </a>`;
};

export const followBtn = (username, isFollowing) => html`
  <button class="btn sm ${isFollowing ? 'ghost' : ''}" data-action="follow" data-username="${username}" data-following="${isFollowing ? 1 : 0}">
    ${isFollowing ? 'Seguindo' : 'Seguir'}</button>`;

export const personRow = (u) => html`
  <div class="person">
    <a href="#/u/${u.username}">${avatar(u)}</a>
    <div class="who"><a class="name" href="#/u/${u.username}">${u.name}</a><small>@${u.username}</small></div>
    ${u.id !== state.me.id ? followBtn(u.username, !!u.is_following) : ''}
  </div>`;

// ---- Ações globais (delegação de eventos) -----------------------------------------
const actions = {
  async like(el) {
    const id = el.dataset.id;
    const r = await posts.like(id, !el.classList.contains('on'));
    $$(`[data-action="like"][data-id="${id}"]`).forEach((b) => {
      b.classList.toggle('on', r.liked);
      b.setAttribute('aria-pressed', r.liked);
      $('.count', b).textContent = r.likes_count;
    });
  },

  async share(el) {
    const url = `${location.origin}${location.pathname}#/post/${el.dataset.id}`;
    try {
      if (navigator.share) await navigator.share({ title: 'The Slap', url });
      else { await navigator.clipboard.writeText(url); toast('Link copiado.'); }
    } catch (e) {
      if (e.name !== 'AbortError') toast('Não foi possível compartilhar.', 'error');
    }
  },

  async follow(el) {
    const u = el.dataset.username;
    const r = await profile.follow(u, el.dataset.following !== '1');
    $$(`[data-action="follow"][data-username="${u}"]`).forEach((b) => {
      b.dataset.following = r.is_following ? 1 : 0;
      b.textContent = r.is_following ? 'Seguindo' : 'Seguir';
      b.classList.toggle('ghost', r.is_following);
    });
    const counter = $(`[data-followers-of="${u}"]`);
    if (counter) counter.textContent = r.followers_count;
  },

  async 'delete-post'(el) {
    if (!confirm('Excluir esta publicação? Curtidas e comentários também serão apagados.')) return;
    await posts.remove(el.dataset.id);
    toast('Publicação excluída.');
    go(`#/u/${state.me.username}`);
  },

  'toggle-edit'() {
    $('#post-view').hidden = !$('#post-view').hidden;
    $('#post-edit').hidden = !$('#post-edit').hidden;
  },

  reply(el) {
    const form = $('#comment-form');
    form.elements.parent_comment_id.value = el.dataset.id;
    $('#replying-name').textContent = '@' + el.dataset.username;
    $('#replying').hidden = false;
    const ta = form.elements.content;
    if (!ta.value) ta.value = `@${el.dataset.username} `;
    ta.focus();
  },

  'cancel-reply'() {
    const form = $('#comment-form');
    form.elements.parent_comment_id.value = '';
    $('#replying').hidden = true;
  },

  async 'delete-comment'(el) {
    if (!confirm('Excluir este comentário? As respostas dele também serão removidas.')) return;
    await comments.remove(el.dataset.id);
    document.dispatchEvent(new CustomEvent('comments:changed'));
  },
};

export function initActions() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    try {
      await actions[el.dataset.action](el, e);
    } catch (err) {
      if (err.status === 401) go('#/login');
      else toast(err.message, 'error');
    }
  });
}
