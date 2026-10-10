-- Freeform announcements coexist with legacy user-linked winners.
alter table public.winners add column if not exists winner_text text;
alter table public.winners alter column user_id drop not null;
alter table public.winners alter column slot drop not null;
comment on column public.winners.winner_text is 'Winner announcement text; preserve line breaks.';
