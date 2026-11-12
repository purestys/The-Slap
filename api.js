// Camada de dados: tudo que o app lê/grava no Supabase passa por aqui.
// Os erros saem sempre como Error com { status, fields } (mesmo formato usado pelas telas).
import { sb, setRemember, clearRecovery } from './supabase.js';

// ---- Erros ---------------------------------------------------------------------
const AUTH_MESSAGES = {
  invalid_credentials: 'Usuário ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail pelo link que enviamos antes de entrar.',
  user_already_exists: 'Este e-mail já está cadastrado.',
  email_exists: 'Este e-mail já está cadastrado.',
  weak_password: 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  over_email_send_rate_limit: 'Muitos e-mails enviados. Aguarde alguns minutos e tente de novo.',
  email_address_invalid: 'Informe um e-mail válido.',
  signup_disabled: 'Cadastros estão desativados neste projeto.',
  session_not_found: 'Sua sessão expirou. Entre novamente.',
  no_authorization: 'Sua sessão expirou. Entre novamente.',
};
const PT_STATUS = { PT400: 400, PT401: 401, PT403: 403, PT404: 404, PT409: 409 };

function fail(error) {
  if (error instanceof Error && error.fromApi) return error;
  const msg = String(error?.message || '');
  let status = PT_STATUS[error?.code] || error?.status || 500;
  let message = AUTH_MESSAGES[error?.code];
  let fields;

  if (!message && /failed to fetch|networkerror|load failed|network request/i.test(msg)) {
    message = 'Sem conexão com o servidor. Verifique sua internet.';
    status = 0;
  }
  if (!message && (error?.code === 'PGRST301' || /jwt (expired|invalid)/i.test(msg))) {
    message = 'Sua sessão expirou. Entre novamente.';
    status = 401;
  }
  if (!message && error?.code === '42501') { message = 'Você não tem permissão para isso.'; status = 403; }
  if (!message && error?.code === '23514') { message = 'Dados inválidos. Revise e tente de novo.'; status = 400; }
  if (!message && PT_STATUS[error?.code]) message = msg;
  if (!message && /rate limit/i.test(msg)) message = AUTH_MESSAGES.over_request_rate_limit;
  if (!message && /already registered/i.test(msg)) message = AUTH_MESSAGES.user_already_exists;
  if (!message) message = 'Algo deu errado. Tente novamente.';

  // As funções SQL mandam "campo|mensagem" no HINT para apontar qual campo do formulário errou.
  const hint = String(error?.hint || '');
  if (hint.includes('|')) {
    const [field, ...rest] = hint.split('|');
    fields = { [field]: rest.join('|') };
  }
  const err = new Error(message);
  err.fromApi = true;
  err.status = status;
  err.fields = fields;
  return err;
}

const bad = (message, fields) => Object.assign(new Error(message), { fromApi: true, status: 400, fields });

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw fail(error);
  return data;
}

const page = (rows, limit) => ({ items: rows.slice(0, limit), hasMore: rows.length > limit });
const clampPage = (p) => Math.min(Math.max(parseInt(p, 10) || 1, 1), 500);

// ---- Utilidades ------------------------------------------------------------------
export const USERNAME = /^[a-z0-9_.]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const baseUrl = () => location.origin + location.pathname; // sem o #/rota: o Supabase acrescenta ?code=…

// Hashtags da legenda + campo de tags (únicas, minúsculas, até 15).
export function extractHashtags(caption = '', tagsField = '') {
  const fromCaption = caption.match(/#[\p{L}\p{N}_]{1,40}/gu) || [];
  const fromField = String(tagsField).split(/[\s,]+/).filter(Boolean);
  const names = [...fromCaption, ...fromField]
    .map((t) => t.replace(/^#+/, '').toLowerCase())
    .filter((t) => /^[\p{L}\p{N}_]{1,40}$/u.test(t));
  return [...new Set(names)].slice(0, 15);
}

// Confere o conteúdo real do arquivo (não só a extensão/tipo declarado).
async function sniffImage(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const hex = (...i) => i.every((n, k) => b[k] === n);
  if (hex(0xff, 0xd8, 0xff)) return 'jpg';
  if (hex(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (hex(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (hex(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const VIDEO_MIME = { mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg' };

async function uploadVideo(bucket, file, uid) {
  const type = String(file.type || '').toLowerCase();
  const ext = Object.keys(VIDEO_MIME).find((key) => VIDEO_MIME[key] === type);
  if (!ext) throw bad('Corrija os campos destacados.', { video: 'Arquivo inválido. Use MP4, WEBM ou OGG.' });
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: VIDEO_MIME[ext], cacheControl: '31536000' });
  if (error) throw fail(error);
  return { path, url: sb.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}

async function uploadImage(bucket, file, uid, maxMb, field) {
  if (Number.isFinite(maxMb) && file.size > maxMb * 1024 * 1024) throw bad('Corrija os campos destacados.', { [field]: `A imagem excede ${maxMb} MB.` });
  const ext = await sniffImage(file);
  if (!ext) throw bad('Corrija os campos destacados.', { [field]: 'Arquivo inválido. Use JPG, PNG, WEBP ou GIF.' });
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: MIME[ext], cacheControl: '31536000' });
  if (error) throw fail(error);
  return { path, url: sb.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}

function storagePath(url, bucket) {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = String(url || '').indexOf(marker);
  return i < 0 ? null : decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
}
const removeFile = async (bucket, url) => {
  const path = storagePath(url, bucket);
  if (path) await sb.storage.from(bucket).remove([path]).catch(() => {});
};

async function signPostRows(rows) {
  const source = (rows || []).map((row) => ({
    ...row,
    image_urls: row.image_urls?.length ? row.image_urls : (row.image_url ? [row.image_url] : []),
  }));
  const paths = [...new Set(source.flatMap((row) => [
    ...row.image_urls.map((url) => storagePath(url, 'posts')),
    storagePath(row.video_url, 'posts'),
  ].filter(Boolean)))];
  if (!paths.length) return source.map((row) => ({ ...row, image_url: null, image_urls: [], video_url: null }));
  const { data, error } = await sb.storage.from('posts').createSignedUrls(paths, 3600);
  if (error) throw fail(error);
  const signed = new Map((data || []).map((item) => [item.path, item.signedUrl]));
  return source.map((row) => {
    const urls = row.image_urls.map((url) => signed.get(storagePath(url, 'posts'))).filter(Boolean);
    const videoPath = storagePath(row.video_url, 'posts');
    return { ...row, image_urls: urls, image_url: urls[0] || null, video_url: videoPath ? (signed.get(videoPath) || null) : null };
  });
}

// ---- Autenticação ---------------------------------------------------------------
const PROFILE_COLS = 'id, name, username, profile_picture, bio, created_at, is_private, show_in_search, show_sensitive_media, notifications_enabled';

async function loadMe(user) {
  const { data, error } = await sb.from('profiles').select(PROFILE_COLS).eq('id', user.id).maybeSingle();
  if (error) throw fail(error);
  return data ? { ...data, email: user.email } : null;
}

export const auth = {
  // Retorna o usuário logado (perfil) ou null.
  async me() {
    const { data, error } = await sb.auth.getSession();
    if (error || !data.session) return null;
    try { return await loadMe(data.session.user); } catch { return null; }
  },

  async login({ identifier, password, remember }) {
    const id = String(identifier || '').trim();
    if (!id || !password) throw bad('Informe seu usuário ou e-mail e a senha.');
    setRemember(remember);
    const email = String(await rpc('login_email', { p_identifier: id }));
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw fail(error);
    const me = await loadMe(data.user);
    if (!me) throw bad('Perfil não encontrado para esta conta.');
    return me;
  },

  async register({ name, username, email, password, bio, avatar }) {
    name = String(name || '').trim();
    username = String(username || '').trim().replace(/^@/, '').toLowerCase();
    email = String(email || '').trim().toLowerCase();
    bio = String(bio || '').trim();
    const f = {};
    if (name.length < 2 || name.length > 80) f.name = 'Informe seu nome completo (2 a 80 caracteres).';
    if (!USERNAME.test(username)) f.username = 'Use 3 a 30 letras minúsculas, números, ponto ou _.';
    if (!EMAIL.test(email) || email.length > 255) f.email = 'Informe um e-mail válido.';
    if (password.length < 8 || password.length > 100) f.password = 'A senha precisa ter de 8 a 100 caracteres.';
    if (bio.length > 300) f.bio = 'A biografia pode ter até 300 caracteres.';
    if (Object.keys(f).length) throw bad('Corrija os campos destacados.', f);

    setRemember(true);
    if (!(await rpc('username_available', { p_username: username }))) {
      throw bad('Corrija os campos destacados.', { username: 'Este nome de usuário já está em uso.' });
    }
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { name, username, bio }, emailRedirectTo: baseUrl() },
    });
    if (error) {
      if (/database error saving/i.test(error.message || '')) {
        throw bad('Corrija os campos destacados.', { username: 'Este nome de usuário já está em uso.' });
      }
      const e = fail(error);
      if (error.code === 'user_already_exists' || error.code === 'email_exists' || /already registered/i.test(error.message || '')) {
        e.fields = { email: 'Este e-mail já está cadastrado.' };
        e.message = 'Corrija os campos destacados.';
        e.status = 409;
      }
      throw e;
    }
    // E-mail já cadastrado (com confirmação ligada, o Supabase devolve usuário sem identidades).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw Object.assign(bad('Corrija os campos destacados.', { email: 'Este e-mail já está cadastrado.' }), { status: 409 });
    }
    // Com "Confirm email" ligado não há sessão até o usuário clicar no link.
    if (!data.session) return { needsConfirmation: true };

    let me = await loadMe(data.user);
    if (avatar) {
      try { me = { ...me, ...(await profile.update({ name, username, bio, avatar }, me)) }; } catch { /* a foto pode ser enviada depois, em Configurações */ }
    }
    return { user: me };
  },

  async logout() {
    await sb.auth.signOut().catch(() => {});
  },

  async forgot(email) {
    email = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw bad('Informe um e-mail válido.', { email: 'E-mail inválido.' });
    setRemember(true); // o código PKCE precisa sobreviver até o usuário abrir o link do e-mail
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: baseUrl() });
    if (error && error.code !== 'user_not_found') throw fail(error);
    // Mesma resposta exista ou não a conta (evita descobrir e-mails cadastrados).
    return { message: 'Se o e-mail estiver cadastrado, enviaremos um link para criar uma nova senha.' };
  },

  // Usado depois que o link do e-mail abriu uma sessão de recuperação.
  async resetPassword(password) {
    if (password.length < 8 || password.length > 100) {
      throw bad('Corrija os campos destacados.', { password: 'A senha precisa ter de 8 a 100 caracteres.' });
    }
    const { data } = await sb.auth.getSession();
    if (!data.session) throw bad('Este link é inválido ou expirou. Peça um novo.');
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw fail(error);
    clearRecovery();
    await sb.auth.signOut({ scope: 'global' }).catch(() => {}); // encerra as demais sessões
    return { message: 'Senha atualizada. Você já pode entrar.' };
  },

  async changePassword(email, current, next) {
    if (next.length < 8 || next.length > 100) {
      throw bad('Corrija os campos destacados.', { new_password: 'A nova senha precisa ter de 8 a 100 caracteres.' });
    }
    const { error: e1 } = await sb.auth.signInWithPassword({ email, password: current });
    if (e1) throw bad('Corrija os campos destacados.', { current_password: 'Senha atual incorreta.' });
    const { error } = await sb.auth.updateUser({ password: next });
    if (error) throw fail(error);
  },

  onSignedOut(cb) {
    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') setTimeout(cb, 0); });
  },
};

// ---- Publicações ----------------------------------------------------------------
const first = (rows) => (Array.isArray(rows) ? rows[0] : rows);

export const posts = {
  async list({ scope = 'all', userId = null, tag = null, search = null, sort = 'recent', page: p = 1, limit = 12 } = {}) {
    const pg = clampPage(p);
    const rows = await rpc('list_posts', {
      p_scope: scope, p_user_id: userId, p_tag: tag, p_search: search, p_sort: sort,
      p_limit: limit + 1, p_offset: (pg - 1) * limit,
    });
    return page(await signPostRows(rows), limit);
  },

  async get(id) {
    const rows = await rpc('list_posts', { p_post_id: Number(id), p_limit: 1 });
    if (!rows[0]) throw Object.assign(new Error('Publicação não encontrada.'), { fromApi: true, status: 404 });
    return (await signPostRows(rows))[0];
  },

  async create({ files = [], file = null, video = null, title, caption, tags, mood, is_sensitive = false }, uid) {
    title = String(title || '').trim();
    caption = String(caption || '').trim();
    const selected = [...(files || [])];
    if (!selected.length && file && file.size) selected.push(file);
    const f = {};
    if (!title || title.length > 100) f.title = 'Dê um título de até 100 caracteres.';
    if (caption.length > 2000) f.caption = 'A legenda pode ter até 2000 caracteres.';
    if (selected.length > 4) f.images = 'Escolha no máximo 4 fotos por publicação.';
    if (selected.length && video) f.video = 'Escolha até 4 fotos ou 1 vídeo por publicação.';
    if (video && !/^video\/(mp4|webm|ogg)$/.test(String(video.type || '').toLowerCase())) f.video = 'Use um vídeo MP4, WEBM ou OGG.';
    if (Object.keys(f).length) throw bad('Corrija os campos destacados.', f);

    const uploaded = [];
    let uploadedVideo = null;
    try {
      for (const image of selected) uploaded.push(await uploadImage('posts', image, uid, Infinity, 'images'));
      if (video) uploadedVideo = await uploadVideo('posts', video, uid);
      return await rpc('create_post', {
        p_image_url: uploaded[0]?.url || null,
        p_title: title, p_caption: caption, p_tags: extractHashtags(caption, tags), p_mood: mood || null,
        p_image_urls: uploaded.map((item) => item.url), p_is_sensitive: !!is_sensitive,
        p_video_url: uploadedVideo?.url || null,
      });
    } catch (err) {
      if (uploaded.length) await sb.storage.from('posts').remove(uploaded.map((item) => item.path)).catch(() => {});
      if (uploadedVideo) await sb.storage.from('posts').remove([uploadedVideo.path]).catch(() => {});
      throw err;
    }
  },

  async update(id, { title, caption, tags }) {
    title = String(title || '').trim();
    caption = String(caption || '').trim();
    await rpc('update_post', { p_id: Number(id), p_title: title, p_caption: caption, p_tags: extractHashtags(caption, tags) });
  },

  async remove(id) {
    const urls = await rpc('delete_post', { p_id: Number(id) });
    for (const url of (Array.isArray(urls) ? urls : [urls])) await removeFile('posts', url);
  },

  async like(id, liked) {
    return first(await rpc('set_like', { p_post_id: Number(id), p_liked: liked }));
  },
};

export const comments = {
  list: (postId) => rpc('list_comments', { p_post_id: Number(postId) }),
  add: (postId, content, parentId) => rpc('add_comment', {
    p_post_id: Number(postId), p_content: content, p_parent_id: parentId ? Number(parentId) : null,
  }),
  remove: (id) => rpc('delete_comment', { p_id: Number(id) }),
};

// ---- Perfis / seguir -----------------------------------------------------------
export const profile = {
  async get(username) {
    const row = first(await rpc('get_profile', { p_username: username }));
    if (!row) throw Object.assign(new Error('Perfil não encontrado.'), { fromApi: true, status: 404 });
    return row;
  },

  posts: (username, userId, p) => posts.list({ userId, page: p, limit: 18 }),

  async follow(username, follow) {
    return first(await rpc('set_follow', { p_username: username, p_follow: follow }));
  },

  async followList(username, which) {
    const users = await rpc('follow_list', { p_username: username, p_which: which });
    return { user: { username: username.toLowerCase() }, users };
  },

  // Edita nome/usuário/bio e (opcionalmente) troca ou remove a foto.
  async update({ name, username, bio, avatar, removeAvatar }, current) {
    name = String(name ?? current.name).trim();
    username = String(username ?? current.username).trim().replace(/^@/, '').toLowerCase();
    bio = String(bio ?? current.bio).trim();
    const f = {};
    if (name.length < 2 || name.length > 80) f.name = 'Informe seu nome (2 a 80 caracteres).';
    if (!USERNAME.test(username)) f.username = 'Use 3 a 30 letras minúsculas, números, ponto ou _.';
    if (bio.length > 300) f.bio = 'A biografia pode ter até 300 caracteres.';
    if (Object.keys(f).length) throw bad('Corrija os campos destacados.', f);

    let up = null;
    if (avatar && avatar.size) up = await uploadImage('avatars', avatar, current.id, 3, 'avatar');
    const change = !!up || !!removeAvatar;
    try {
      const row = first(await rpc('update_profile', {
        p_name: name, p_username: username, p_bio: bio, p_change_avatar: change, p_avatar: up ? up.url : null,
      }));
      if (change) await removeFile('avatars', current.profile_picture);
      return row;
    } catch (err) {
      if (up) await sb.storage.from('avatars').remove([up.path]).catch(() => {});
      throw err;
    }
  },

  async savePrivacy(values) {
    const row = first(await rpc('update_privacy_settings', {
      p_is_private: !!values.is_private, p_show_in_search: !!values.show_in_search,
      p_show_sensitive_media: !!values.show_sensitive_media, p_notifications_enabled: !!values.notifications_enabled,
    }));
    return row;
  },

  suggestions: () => rpc('suggested_users'),
};

// ---- Explorar -------------------------------------------------------------------
// q vazio: galeria geral · "#tag": hashtag · "@nome": só perfis · texto: perfis + fotos
export const explore = {
  async search({ q = '', sort = 'recent', page: p = 1 }) {
    q = String(q).trim().slice(0, 80);
    const pg = clampPage(p);
    let users = [];
    if (q && !q.startsWith('#') && pg === 1) users = await rpc('search_users', { p_q: q });
    if (q.startsWith('@')) return { items: [], hasMore: false, users };
    const args = { sort, page: pg, limit: 18 };
    if (q.startsWith('#')) args.tag = q;
    else if (q) args.search = q;
    return { ...(await posts.list(args)), users };
  },
};

// ---- Notificações ---------------------------------------------------------------
export const notifications = {
  async list() {
    const rows = await rpc('list_notifications');
    const signed = await signPostRows(rows.map((row) => ({ ...row, image_url: row.post_image, image_urls: row.post_image ? [row.post_image] : [] })));
    return rows.map((row, index) => ({ ...row, post_image: signed[index]?.image_url || null }));
  },
  unreadCount: async () => Number(await rpc('unread_count')) || 0,
  markRead: (id) => rpc('mark_notifications_read', { p_id: Number(id) }),
  markAllRead: () => rpc('mark_notifications_read', {}),
};
