-- SQLSTATE 40001 means a retryable serialization failure to database gateways.
-- A workout revision mismatch is instead an application-level HTTP conflict.
-- PostgREST maps PT409 to HTTP 409 without retrying the transaction.

begin;

do $migration$
declare
  target_function regprocedure;
  original_definition text;
  corrected_definition text;
begin
  foreach target_function in array array[
    'public.save_workout_session_draft(uuid,bigint,uuid,jsonb)'::regprocedure,
    'public.complete_workout_session_confirmed(uuid,bigint,uuid,numeric,text)'::regprocedure
  ]
  loop
    original_definition := pg_catalog.pg_get_functiondef(
      target_function::oid
    );

    if original_definition !~* 'errcode\s*=\s*''40001''' then
      raise exception 'Expected retryable revision conflict was not found in %',
        target_function::text;
    end if;

    corrected_definition := pg_catalog.regexp_replace(
      original_definition,
      'errcode\s*=\s*''40001''',
      'errcode = ''PT409''',
      'gi'
    );

    execute corrected_definition;
  end loop;
end;
$migration$;

commit;
