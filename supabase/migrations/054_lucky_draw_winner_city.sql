alter table public.winners add column if not exists city text;
alter table public.winners add column if not exists winner_text text;
alter table public.winners alter column user_id drop not null;
alter table public.winners alter column slot drop not null;
alter table public.winners add constraint winners_text_or_user_chk check (nullif(btrim(winner_text),'') is not null or user_id is not null);
comment on column public.winners.winner_text is 'Multiline freeform winner announcement; newlines preserved.';
