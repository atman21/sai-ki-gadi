alter table public.winners add column if not exists city text;
comment on column public.winners.city is 'Winner city displayed on Lucky Draw card; optional for legacy winners.';
