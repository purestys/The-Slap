-- =====================================================================
-- TheClick — esquema para Supabase (PostgreSQL + Auth + Storage)
-- Cole este arquivo inteiro no "SQL Editor" do Supabase e clique em Run.
-- É idempotente: pode ser executado novamente sem apagar dados.
--
-- Modelo de segurança:
--   * Só usuários logados leem dados (RLS com policy para "authenticated").
--   * O navegador NÃO escreve direto nas tabelas: toda escrita passa por
--     funções (RPC) que validam os dados e usam auth.uid() como autor.
--   * Notificações são geradas por triggers (não dá para forjá-las).
--   * Imagens ficam no Storage; cada usuário só grava na própria pasta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  name            varchar(80)  not null,
  username        varchar(30)  not null unique,
  profile_picture text,
  bio             varchar(300) not null default '',
  created_at      timestamptz  not null default now(),
  constraint profiles_username_fmt check (username ~ '^[a-z0-9_.]{3,30}$'),
  constraint profiles_name_len     check (char_length(btrim(name)) >= 2),
  constraint profiles_avatar_path  check (profile_picture is null or
    position('/storage/v1/object/public/avatars/' || id::text || '/' in profile_picture) > 0)
);

create table if not exists public.posts (
  id         integer generated always as identity primary key,
  user_id    uuid          not null references public.profiles (id) on delete cascade,
  image_url  text          not null,
  title      varchar(100)  not null,
  caption    varchar(2000) not null default '',
  created_at timestamptz   not null default now(),
  updated_at timestamptz   not null default now(),
  constraint posts_image_path check (
    position('/storage/v1/object/public/posts/' || user_id::text || '/' in image_url) > 0)
);

create table if not exists public.follows (
  id           integer generated always as identity primary key,
  follower_id  uuid        not null references public.profiles (id) on delete cascade,
  following_id uuid        not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint follows_unique  unique (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create table if not exists public.likes (
  id         integer generated always as identity primary key,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  post_id    integer     not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint likes_unique unique (user_id, post_id)
);

create table if not exists public.comments (
  id                   integer generated always as identity primary key,
  user_id              uuid          not null references public.profiles (id) on delete cascade,
  post_id              integer       not null references public.posts (id) on delete cascade,
  parent_comment_id    integer       references public.comments (id) on delete cascade,
  reply_to_comment_id  integer       references public.comments (id) on delete set null,
  content              varchar(1000) not null check (char_length(btrim(content)) > 0),
  created_at           timestamptz   not null default now()
);

create table if not exists public.notifications (
  id           integer generated always as identity primary key,
  recipient_id uuid        not null references public.profiles (id) on delete cascade,
  sender_id    uuid        not null references public.profiles (id) on delete cascade,
  type         varchar(20) not null check (type in ('like', 'comment', 'reply', 'follow')),
  post_id      integer     references public.posts (id) on delete cascade,
  is_read      boolean     not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.hashtags (
  id   integer generated always as identity primary key,
  name varchar(40) not null unique
);

create table if not exists public.post_hashtags (
  post_id    integer not null references public.posts (id)    on delete cascade,
  hashtag_id integer not null references public.hashtags (id) on delete cascade,
  primary key (post_id, hashtag_id)
);

-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
create index if not exists idx_posts_user_created on public.posts (user_id, created_at desc);
create index if not exists idx_posts_created      on public.posts (created_at desc);
create index if not exists idx_follows_following  on public.follows (following_id);
create index if not exists idx_likes_post         on public.likes (post_id);
create index if not exists idx_comments_post      on public.comments (post_id, created_at);
create index if not exists idx_comments_parent    on public.comments (parent_comment_id);
create index if not exists idx_notif_recipient    on public.notifications (recipient_id, is_read, created_at desc);
create index if not exists idx_post_hashtags_tag  on public.post_hashtags (hashtag_id);

-- Busca por texto (opcional: usa pg_trgm; se a extensão não puder ser criada, a busca continua funcionando).
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
  execute 'create index if not exists idx_profiles_username_trgm on public.profiles using gin (username extensions.gin_trgm_ops)';
  execute 'create index if not exists idx_profiles_name_trgm     on public.profiles using gin (name extensions.gin_trgm_ops)';
  execute 'create index if not exists idx_posts_title_trgm       on public.posts using gin (title extensions.gin_trgm_ops)';
  execute 'create index if not exists idx_posts_caption_trgm     on public.posts using gin (caption extensions.gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm indisponível — índices de busca ignorados (%).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- Cria o perfil automaticamente quando alguém se cadastra no Supabase Auth.
-- (nome, usuário e bio chegam em options.data do signUp)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  uname text  := lower(btrim(coalesce(meta->>'username', '')));
  nm    text  := btrim(coalesce(meta->>'name', ''));
begin
  if uname = '' then
    uname := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  if char_length(nm) < 2 then
    nm := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuário');
    if char_length(nm) < 2 then nm := 'Usuário'; end if;
  end if;

  insert into public.profiles (id, name, username, bio)
  values (new.id, left(nm, 80), uname, left(btrim(coalesce(meta->>'bio', '')), 300));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Triggers: notificações e respostas de comentários
-- ---------------------------------------------------------------------
create or replace function public.trg_like_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (recipient_id, sender_id, type, post_id)
    select p.user_id, new.user_id, 'like', new.post_id
      from posts p where p.id = new.post_id and p.user_id <> new.user_id;
    return new;
  end if;
  delete from notifications where type = 'like' and sender_id = old.user_id and post_id = old.post_id;
  return old;
end $$;

drop trigger if exists likes_notify on public.likes;
create trigger likes_notify after insert or delete on public.likes
  for each row execute function public.trg_like_notify();

create or replace function public.trg_follow_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (recipient_id, sender_id, type) values (new.following_id, new.follower_id, 'follow');
    return new;
  end if;
  delete from notifications where type = 'follow' and sender_id = old.follower_id and recipient_id = old.following_id;
  return old;
end $$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert or delete on public.follows
  for each row execute function public.trg_follow_notify();

-- Respostas ficam em um único nível: responder a uma resposta anexa ao comentário raiz,
-- guardando em reply_to_comment_id quem foi respondido (para a notificação).
create or replace function public.trg_comment_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare tgt record;
begin
  new.reply_to_comment_id := null;
  if new.parent_comment_id is not null then
    select id, parent_comment_id into tgt from comments
     where id = new.parent_comment_id and post_id = new.post_id;
    if not found then
      raise exception 'O comentário respondido não existe.' using errcode = 'PT400';
    end if;
    new.reply_to_comment_id := tgt.id;
    new.parent_comment_id   := coalesce(tgt.parent_comment_id, tgt.id);
  end if;
  return new;
end $$;

drop trigger if exists comments_before on public.comments;
create trigger comments_before before insert on public.comments
  for each row execute function public.trg_comment_before();

create or replace function public.trg_comment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare post_owner uuid; reply_owner uuid;
begin
  select user_id into post_owner from posts where id = new.post_id;
  if new.reply_to_comment_id is not null then
    select user_id into reply_owner from comments where id = new.reply_to_comment_id;
    if reply_owner is not null and reply_owner <> new.user_id then
      insert into notifications (recipient_id, sender_id, type, post_id)
      values (reply_owner, new.user_id, 'reply', new.post_id);
    end if;
  end if;
  if (reply_owner is null or reply_owner <> post_owner) and post_owner <> new.user_id then
    insert into notifications (recipient_id, sender_id, type, post_id)
    values (post_owner, new.user_id, 'comment', new.post_id);
  end if;
  return new;
end $$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.trg_comment_notify();

-- ---------------------------------------------------------------------
-- Funções auxiliares (internas)
-- ---------------------------------------------------------------------
create or replace function public.set_post_hashtags(p_post integer, p_tags text[])
returns void
language plpgsql security definer set search_path = public as $$
declare names text[];
begin
  delete from post_hashtags where post_id = p_post;
  select coalesce(array_agg(n), '{}') into names from (
    select distinct lower(regexp_replace(t, '^#+', '')) as n from unnest(coalesce(p_tags, '{}')) t
  ) x where n ~ '^[^[:space:]#,]{1,40}$';
  names := names[1:15];
  if coalesce(array_length(names, 1), 0) = 0 then return; end if;
  insert into hashtags (name) select unnest(names) on conflict (name) do nothing;
  insert into post_hashtags (post_id, hashtag_id)
    select p_post, id from hashtags where name = any (names) on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Funções públicas (RPC)
-- ---------------------------------------------------------------------

-- Login por @usuário: devolve o e-mail do usuário (ou o próprio texto, se já for e-mail).
create or replace function public.login_email(p_identifier text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare idf text := lower(btrim(coalesce(p_identifier, ''))); found_email text;
begin
  if position('@' in idf) > 1 then return idf; end if;
  select u.email into found_email
    from auth.users u join profiles p on p.id = u.id
   where p.username = ltrim(idf, '@');
  return coalesce(found_email, idf);
end $$;

create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where username = lower(btrim(coalesce(p_username, ''))));
$$;

-- Lista de posts (feed, perfil, explorar, detalhe). Retorna o viewer em "liked".
create or replace function public.list_posts(
  p_scope   text    default 'all',      -- 'all' | 'following'
  p_user_id uuid    default null,
  p_post_id integer default null,
  p_tag     text    default null,
  p_search  text    default null,
  p_sort    text    default 'recent',   -- 'recent' | 'popular'
  p_limit   integer default 12,
  p_offset  integer default 0
)
returns table (
  id integer, title text, caption text, image_url text, created_at timestamptz, updated_at timestamptz,
  user_id uuid, name text, username text, profile_picture text,
  likes_count integer, comments_count integer, liked boolean, hashtags text[]
)
language sql stable security invoker set search_path = public as $$
  with q as (
    select case when coalesce(btrim(p_search), '') = '' then null
                else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as pat,
           lower(regexp_replace(btrim(coalesce(p_search, '')), '^#+', '')) as tagname
  )
  select * from (
    select p.id, p.title::text, p.caption::text, p.image_url, p.created_at, p.updated_at,
           u.id as user_id, u.name::text, u.username::text, u.profile_picture,
           (select count(*)::int from likes l where l.post_id = p.id) as likes_count,
           (select count(*)::int from comments c where c.post_id = p.id) as comments_count,
           exists (select 1 from likes l where l.post_id = p.id and l.user_id = auth.uid()) as liked,
           coalesce((select array_agg(h.name::text order by h.name)
                       from post_hashtags ph join hashtags h on h.id = ph.hashtag_id
                      where ph.post_id = p.id), '{}') as hashtags
      from posts p
      join profiles u on u.id = p.user_id, q
     where (p_post_id is null or p.id = p_post_id)
       and (p_user_id is null or p.user_id = p_user_id)
       and (p_scope <> 'following'
            or p.user_id = auth.uid()
            or p.user_id in (select f.following_id from follows f where f.follower_id = auth.uid()))
       and (p_tag is null or exists (
              select 1 from post_hashtags ph join hashtags h on h.id = ph.hashtag_id
               where ph.post_id = p.id and h.name = lower(regexp_replace(btrim(p_tag), '^#+', ''))))
       and (q.pat is null or p.title ilike q.pat or p.caption ilike q.pat
            or u.username ilike q.pat or u.name ilike q.pat
            or exists (select 1 from post_hashtags ph join hashtags h on h.id = ph.hashtag_id
                        where ph.post_id = p.id and h.name = q.tagname))
  ) t
  order by case when p_sort = 'popular' then t.likes_count end desc nulls last,
           t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 12), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.create_post(p_image_url text, p_title text, p_caption text, p_tags text[] default '{}')
returns integer
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t text := btrim(coalesce(p_title, '')); c text := btrim(coalesce(p_caption, '')); new_id integer;
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  if t = '' or char_length(t) > 100 then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT400', hint = 'title|Dê um título de até 100 caracteres.';
  end if;
  if char_length(c) > 2000 then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT400', hint = 'caption|A legenda pode ter até 2000 caracteres.';
  end if;
  insert into posts (user_id, image_url, title, caption) values (uid, p_image_url, t, c) returning id into new_id;
  perform set_post_hashtags(new_id, p_tags);
  return new_id;
end $$;

create or replace function public.update_post(p_id integer, p_title text, p_caption text, p_tags text[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid; t text := btrim(coalesce(p_title, '')); c text := btrim(coalesce(p_caption, ''));
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  select user_id into owner from posts where id = p_id;
  if not found then raise exception 'Publicação não encontrada.' using errcode = 'PT404'; end if;
  if owner <> uid then raise exception 'Você só pode alterar suas próprias publicações.' using errcode = 'PT403'; end if;
  if t = '' or char_length(t) > 100 then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT400', hint = 'title|Dê um título de até 100 caracteres.';
  end if;
  if char_length(c) > 2000 then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT400', hint = 'caption|A legenda pode ter até 2000 caracteres.';
  end if;
  update posts set title = t, caption = c, updated_at = now() where id = p_id;
  perform set_post_hashtags(p_id, p_tags);
end $$;

-- Exclui a publicação (curtidas, comentários, hashtags e notificações saem por CASCADE) e devolve a URL da imagem.
create or replace function public.delete_post(p_id integer)
returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid; img text;
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  select user_id, image_url into owner, img from posts where id = p_id;
  if not found then raise exception 'Publicação não encontrada.' using errcode = 'PT404'; end if;
  if owner <> uid then raise exception 'Você só pode alterar suas próprias publicações.' using errcode = 'PT403'; end if;
  delete from posts where id = p_id;
  return img;
end $$;

create or replace function public.set_like(p_post_id integer, p_liked boolean)
returns table (likes_count integer, liked boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  if not exists (select 1 from posts where id = p_post_id) then
    raise exception 'Publicação não encontrada.' using errcode = 'PT404';
  end if;
  if p_liked then
    insert into likes (user_id, post_id) values (uid, p_post_id) on conflict do nothing;
  else
    delete from likes where user_id = uid and post_id = p_post_id;
  end if;
  return query select (select count(*)::int from likes l where l.post_id = p_post_id),
                      exists (select 1 from likes l where l.post_id = p_post_id and l.user_id = uid);
end $$;

create or replace function public.list_comments(p_post_id integer)
returns table (
  id integer, post_id integer, parent_comment_id integer, content text, created_at timestamptz,
  user_id uuid, name text, username text, profile_picture text
)
language sql stable security invoker set search_path = public as $$
  select c.id, c.post_id, c.parent_comment_id, c.content::text, c.created_at,
         u.id, u.name::text, u.username::text, u.profile_picture
    from comments c join profiles u on u.id = c.user_id
   where c.post_id = p_post_id
   order by c.created_at, c.id;
$$;

create or replace function public.add_comment(p_post_id integer, p_content text, p_parent_id integer default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c text := btrim(coalesce(p_content, '')); new_id integer;
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  if c = '' or char_length(c) > 1000 then
    raise exception 'Escreva um comentário de até 1000 caracteres.' using errcode = 'PT400', hint = 'content|Comentário vazio ou longo demais.';
  end if;
  if not exists (select 1 from posts where id = p_post_id) then
    raise exception 'Publicação não encontrada.' using errcode = 'PT404';
  end if;
  insert into comments (user_id, post_id, parent_comment_id, content) values (uid, p_post_id, p_parent_id, c)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.delete_comment(p_id integer)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  select user_id into owner from comments where id = p_id;
  if not found then raise exception 'Comentário não encontrado.' using errcode = 'PT404'; end if;
  if owner <> uid then raise exception 'Você só pode excluir seus próprios comentários.' using errcode = 'PT403'; end if;
  delete from comments where id = p_id; -- respostas saem por CASCADE
end $$;

create or replace function public.get_profile(p_username text)
returns table (
  id uuid, name text, username text, profile_picture text, bio text, created_at timestamptz,
  posts_count integer, followers_count integer, following_count integer, is_following boolean
)
language sql stable security invoker set search_path = public as $$
  select u.id, u.name::text, u.username::text, u.profile_picture, u.bio::text, u.created_at,
         (select count(*)::int from posts   where user_id = u.id),
         (select count(*)::int from follows where following_id = u.id),
         (select count(*)::int from follows where follower_id = u.id),
         exists (select 1 from follows where follower_id = auth.uid() and following_id = u.id)
    from profiles u
   where u.username = lower(btrim(coalesce(p_username, '')));
$$;

create or replace function public.update_profile(
  p_name text, p_username text, p_bio text,
  p_change_avatar boolean default false, p_avatar text default null
)
returns table (id uuid, name text, username text, profile_picture text, bio text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  nm  text := btrim(coalesce(p_name, ''));
  un  text := lower(regexp_replace(btrim(coalesce(p_username, '')), '^@', ''));
  bi  text := btrim(coalesce(p_bio, ''));
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  if char_length(nm) < 2 or char_length(nm) > 80 then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT400', hint = 'name|Informe seu nome (2 a 80 caracteres).';
  end if;
  if un !~ '^[a-z0-9_.]{3,30}$' then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT400', hint = 'username|Use 3 a 30 letras minúsculas, números, ponto ou _.';
  end if;
  if char_length(bi) > 300 then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT400', hint = 'bio|A biografia pode ter até 300 caracteres.';
  end if;
  begin
    update profiles p
       set name = nm, username = un, bio = bi,
           profile_picture = case when p_change_avatar then p_avatar else p.profile_picture end
     where p.id = uid;
  exception when unique_violation then
    raise exception 'Corrija os campos destacados.' using errcode = 'PT409', hint = 'username|Este nome de usuário já está em uso.';
  end;
  return query select p.id, p.name::text, p.username::text, p.profile_picture, p.bio::text, p.created_at
                 from profiles p where p.id = uid;
end $$;

create or replace function public.set_follow(p_username text, p_follow boolean)
returns table (followers_count integer, is_following boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare uid uuid := auth.uid(); target uuid;
begin
  if uid is null then raise exception 'Faça login para continuar.' using errcode = 'PT401'; end if;
  select id into target from profiles where username = lower(btrim(coalesce(p_username, '')));
  if not found then raise exception 'Perfil não encontrado.' using errcode = 'PT404'; end if;
  if target = uid then raise exception 'Você não pode seguir a si mesmo.' using errcode = 'PT400'; end if;
  if p_follow then
    insert into follows (follower_id, following_id) values (uid, target) on conflict do nothing;
  else
    delete from follows where follower_id = uid and following_id = target;
  end if;
  return query select (select count(*)::int from follows f where f.following_id = target),
                      exists (select 1 from follows f where f.follower_id = uid and f.following_id = target);
end $$;

-- Seguidores (p_which = 'followers') ou quem o usuário segue ('following').
create or replace function public.follow_list(p_username text, p_which text)
returns table (id uuid, name text, username text, profile_picture text, is_following boolean)
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
declare target uuid;
begin
  select pr.id into target from profiles pr where pr.username = lower(btrim(coalesce(p_username, '')));
  if not found then raise exception 'Perfil não encontrado.' using errcode = 'PT404'; end if;
  return query
    select u.id, u.name::text, u.username::text, u.profile_picture,
           exists (select 1 from follows f2 where f2.follower_id = auth.uid() and f2.following_id = u.id)
      from follows f
      join profiles u on u.id = case when p_which = 'followers' then f.follower_id else f.following_id end
     where (case when p_which = 'followers' then f.following_id else f.follower_id end) = target
     order by f.created_at desc
     limit 200;
end $$;

create or replace function public.search_users(p_q text)
returns table (id uuid, name text, username text, profile_picture text, is_following boolean)
language sql stable security invoker set search_path = public as $$
  with q as (
    select ltrim(btrim(coalesce(p_q, '')), '@') as term
  )
  select u.id, u.name::text, u.username::text, u.profile_picture,
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = u.id)
    from profiles u, q
   where q.term <> ''
     and (u.username ilike '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or u.name  ilike '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by (u.username = lower(q.term)) desc, u.username
   limit 12;
$$;

create or replace function public.suggested_users()
returns table (id uuid, name text, username text, profile_picture text, followers_count integer, is_following boolean)
language sql stable security invoker set search_path = public as $$
  select u.id, u.name::text, u.username::text, u.profile_picture,
         (select count(*)::int from follows where following_id = u.id) as followers_count,
         false as is_following
    from profiles u
   where u.id <> auth.uid()
     and not exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = u.id)
   order by followers_count desc, u.created_at desc
   limit 6;
$$;

-- Notificações: só o destinatário lê (a tabela não é acessível direto pelo navegador).
create or replace function public.list_notifications()
returns table (
  id integer, type text, is_read boolean, created_at timestamptz, post_id integer,
  name text, username text, profile_picture text, post_image text
)
language sql stable security definer set search_path = public as $$
  select n.id, n.type::text, n.is_read, n.created_at, n.post_id,
         s.name::text, s.username::text, s.profile_picture, p.image_url
    from notifications n
    join profiles s on s.id = n.sender_id
    left join posts p on p.id = n.post_id
   where n.recipient_id = auth.uid()
   order by n.created_at desc, n.id desc
   limit 100;
$$;

create or replace function public.unread_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications where recipient_id = auth.uid() and not is_read;
$$;

create or replace function public.mark_notifications_read(p_id integer default null)
returns void
language sql security definer set search_path = public as $$
  update notifications set is_read = true
   where recipient_id = auth.uid() and not is_read and (p_id is null or id = p_id);
$$;

-- ---------------------------------------------------------------------
-- RLS: leitura só para usuários logados; escrita só pelas funções acima
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.follows       enable row level security;
alter table public.likes         enable row level security;
alter table public.comments      enable row level security;
alter table public.notifications enable row level security;
alter table public.hashtags      enable row level security;
alter table public.post_hashtags enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','posts','follows','likes','comments','hashtags','post_hashtags'] loop
    execute format('drop policy if exists "leitura autenticada" on public.%I', t);
    execute format('create policy "leitura autenticada" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;
-- notifications: sem policy = ninguém lê direto (apenas via list_notifications()).

-- Privilégios das tabelas: tira tudo e devolve só SELECT onde precisa.
revoke all on public.profiles, public.posts, public.follows, public.likes, public.comments,
              public.notifications, public.hashtags, public.post_hashtags from anon, authenticated;
grant select on public.profiles, public.posts, public.follows, public.likes, public.comments,
                public.hashtags, public.post_hashtags to authenticated;

-- Privilégios das funções.
do $$
declare f record;
begin
  -- começa fechando tudo que é do app
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('handle_new_user','trg_like_notify','trg_follow_notify','trg_comment_before','trg_comment_notify',
                         'set_post_hashtags','login_email','username_available','list_posts','create_post','update_post',
                         'delete_post','set_like','list_comments','add_comment','delete_comment','get_profile',
                         'update_profile','set_follow','follow_list','search_users','suggested_users',
                         'list_notifications','unread_count','mark_notifications_read')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Usadas antes do login (cadastro / entrar com @usuário):
grant execute on function public.login_email(text)        to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

-- Usadas com o usuário logado:
grant execute on function
  public.list_posts(text, uuid, integer, text, text, text, integer, integer),
  public.create_post(text, text, text, text[]),
  public.update_post(integer, text, text, text[]),
  public.delete_post(integer),
  public.set_like(integer, boolean),
  public.list_comments(integer),
  public.add_comment(integer, text, integer),
  public.delete_comment(integer),
  public.get_profile(text),
  public.update_profile(text, text, text, boolean, text),
  public.set_follow(text, boolean),
  public.follow_list(text, text),
  public.search_users(text),
  public.suggested_users(),
  public.list_notifications(),
  public.unread_count(),
  public.mark_notifications_read(integer)
to authenticated;

-- ---------------------------------------------------------------------
-- Storage: buckets públicos de leitura; cada usuário grava só na sua pasta (<uid>/arquivo)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('posts',   'posts',   true, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('avatars', 'avatars', true, 3 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "theclick: enviar na propria pasta"  on storage.objects;
drop policy if exists "theclick: ver a propria pasta"      on storage.objects;
drop policy if exists "theclick: apagar da propria pasta"  on storage.objects;

create policy "theclick: enviar na propria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('posts', 'avatars') and (storage.foldername(name))[1] = auth.uid()::text);

create policy "theclick: ver a propria pasta" on storage.objects
  for select to authenticated
  using (bucket_id in ('posts', 'avatars') and (storage.foldername(name))[1] = auth.uid()::text);

create policy "theclick: apagar da propria pasta" on storage.objects
  for delete to authenticated
  using (bucket_id in ('posts', 'avatars') and (storage.foldername(name))[1] = auth.uid()::text);
