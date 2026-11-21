/*
# Make billing functions SECURITY DEFINER

create_bill and cancel_bill must update bill_counters, which is intentionally
invisible to client roles. Switching them to SECURITY DEFINER lets them run as
the table owner; combined with `SET search_path = ''` and fully-qualified table
names this is the safe definer pattern. Direct grants on bill_counters stay
revoked, so clients still cannot touch the counter except through these functions.
*/

ALTER FUNCTION public.create_bill(jsonb, uuid, text, text, numeric, text, text) SECURITY DEFINER;
ALTER FUNCTION public.cancel_bill(uuid) SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.create_bill(jsonb, uuid, text, text, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_bill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_bill(jsonb, uuid, text, text, numeric, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_bill(uuid) TO anon, authenticated;