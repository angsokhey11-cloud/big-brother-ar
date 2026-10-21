-- BIG BROTHER A/R: include partially paid invoice remainders.
-- 2026-10-21. Read-only list logic + existing authorized payment-request eligibility.
-- Does NOT update invoice balances, payments, cash, stock or existing A/R requests.
-- Eligible invoice payment methods: Credit, Partially Paid in Cash, Partially Paid in Bank.
-- All existing outstanding>0 and staff/location permission gates are preserved.
-- Additional payment collection remains restricted to the CURRENT outstanding.


-- Update only method eligibility in bb_ar_list; original permissions and output retained.
CREATE OR REPLACE FUNCTION public.bb_ar_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rows jsonb; v_access jsonb;
begin
  if not public.bb_has_module_access('accounts_receivable','view') then
    raise exception 'Accounts Receivable access denied';
  end if;

  v_access:=public.bb_ar_access_profile();

  select coalesce(jsonb_agg(q.row_json order by q.invoice_date,q.invoice_no),'[]'::jsonb)
  into v_rows
  from (
    select i.invoice_date,i.invoice_no,
      jsonb_build_object(
        'invoiceId',i.invoice_id,
        'invoiceNo',i.invoice_no,
        'invoiceDate',i.invoice_date::text,
        'dueDate',coalesce(i.due_date::text,''),
        'customerId',coalesce(i.customer_id,''),
        'customer',coalesce(i.customer_name_snapshot,''),
        'customerPhone',coalesce(c.phone,''),
        'customerAddress',coalesce(c.address,''),
        'locationCode',coalesce(i.location_code,''),
        'locationName',coalesce(l.location_name,i.location_code,''),
        'salespersonStaffId',coalesce(i.salesperson_staff_id,''),
        'salesperson',coalesce(i.salesperson_name_snapshot,''),
        'receivableOwnerStaffId',coalesce(l.salesperson_staff_id,''),
        'receivableOwner',coalesce(l.salesperson_name,''),
        'currency',coalesce(i.currency,'USD'),
        'exchangeRate',coalesce(i.exchange_rate,1),
        'grandTotal',coalesce(i.grand_total,0),
        'amountPaid',coalesce(i.amount_paid,0),
        'outstanding',coalesce(i.outstanding,0),
        'arStatus',case
          when pr.request_id is not null then 'Processing'
          when i.due_date is not null and i.due_date<current_date then 'Overdue'
          else 'Outstanding'
        end,
        'requestId',coalesce(pr.request_id,''),
        'requestedBy',coalesce(pr.requested_by_name_snapshot,'')
      ) row_json
    from public.invoices i
    left join public.customers c on c.customer_id=i.customer_id
    left join public.locations l on l.location_code=i.location_code
    left join lateral (
      select r.request_id,r.requested_by_name_snapshot
      from public.ar_request_allocations a
      join public.ar_payment_requests r on r.request_id=a.request_id
      where a.invoice_id=i.invoice_id and lower(coalesce(r.status,''))='processing'
      order by r.created_at desc
      limit 1
    ) pr on true
    where coalesce(i.outstanding,0)>0
      and lower(btrim(coalesce(i.payment_method,''))) in ('credit','partially paid in cash','partially paid in bank')
      and (
        public.bb_is_admin()
        or private.bb_is_current_receivable_owner(i.location_code)
      )
  ) q;

  return jsonb_build_object(
    'success',true,
    'revision',public.bb_ar_revision(),
    'receivables',v_rows,
    'access',v_access
  );
end;
$function$;

-- Update only method eligibility in bb_ar_list_all; original permissions and output retained.
CREATE OR REPLACE FUNCTION public.bb_ar_list_all()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows jsonb;
  v_access jsonb;
begin
  if not public.bb_has_module_access('route.ar-all','view') then
    raise exception 'All Receivable access denied';
  end if;

  if not public.bb_has_module_access('accounts_receivable','view') then
    raise exception 'Accounts Receivable access denied';
  end if;

  v_access:=public.bb_ar_access_profile_all();

  select coalesce(
    jsonb_agg(q.row_json order by q.invoice_date,q.invoice_no),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      i.invoice_date,
      i.invoice_no,
      jsonb_build_object(
        'invoiceId',i.invoice_id,
        'invoiceNo',i.invoice_no,
        'invoiceDate',i.invoice_date::text,
        'dueDate',coalesce(i.due_date::text,''),
        'customerId',coalesce(i.customer_id,''),
        'customer',coalesce(i.customer_name_snapshot,''),
        'customerPhone',coalesce(c.phone,''),
        'customerAddress',coalesce(c.address,''),
        'locationCode',coalesce(i.location_code,''),
        'locationName',coalesce(l.location_name,i.location_code,''),
        'salespersonStaffId',coalesce(i.salesperson_staff_id,''),
        'salesperson',coalesce(i.salesperson_name_snapshot,''),
        'receivableOwnerStaffId',coalesce(l.salesperson_staff_id,''),
        'receivableOwner',coalesce(l.salesperson_name,''),
        'currency',coalesce(i.currency,'USD'),
        'exchangeRate',coalesce(i.exchange_rate,1),
        'grandTotal',coalesce(i.grand_total,0),
        'amountPaid',coalesce(i.amount_paid,0),
        'outstanding',coalesce(i.outstanding,0),
        'arStatus',case
          when pr.request_id is not null then 'Processing'
          when i.due_date is not null and i.due_date<current_date then 'Overdue'
          else 'Outstanding'
        end,
        'requestId',coalesce(pr.request_id,''),
        'requestedBy',coalesce(pr.requested_by_name_snapshot,'')
      ) row_json
    from public.invoices i
    left join public.customers c
      on c.customer_id=i.customer_id
    left join public.locations l
      on l.location_code=i.location_code
    left join lateral (
      select r.request_id,r.requested_by_name_snapshot
      from public.ar_request_allocations a
      join public.ar_payment_requests r
        on r.request_id=a.request_id
      where a.invoice_id=i.invoice_id
        and lower(coalesce(r.status,''))='processing'
      order by r.created_at desc
      limit 1
    ) pr on true
    where coalesce(i.outstanding,0)>0
      and lower(btrim(coalesce(i.payment_method,''))) in ('credit','partially paid in cash','partially paid in bank')
      and public.bb_has_location_access(i.location_code)
  ) q;

  return jsonb_build_object(
    'success',true,
    'revision',public.bb_ar_revision(),
    'receivables',v_rows,
    'access',v_access,
    'scope','ASSIGNED_LOCATIONS_COMPANY_RECEIVABLE'
  );
end;
$function$;

-- Update only method eligibility in bb_ar_create_request_v2; original permissions and output retained.
CREATE OR REPLACE FUNCTION public.bb_ar_create_request_v2(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids text[]:=array[]::text[];
  v_id text;
  v_inv public.invoices%rowtype;
  v_first public.invoices%rowtype;
  v_request_id text;
  v_count int:=0;
  v_total numeric:=0;
  v_amount numeric;
  v_idx int:=0;
  v_date date:=coalesce(nullif(p_payload->>'paymentDate','')::date,current_date);
  v_note text:=nullif(trim(coalesce(p_payload->>'note','')),'');
  v_actor text:=public.bb_actor_name();
  v_staff_id text:=public.bb_actor_staff_id();
  v_single_amount numeric:=greatest(coalesce(nullif(p_payload->>'amount','')::numeric,0),0);
  v_customer_count int:=0;
begin
  if not public.bb_has_module_access('accounts_receivable','create') then
    raise exception 'Accounts Receivable request access denied';
  end if;

  if jsonb_typeof(p_payload->'invoiceIds')='array' then
    select coalesce(array_agg(value),array[]::text[]) into v_ids
    from jsonb_array_elements_text(p_payload->'invoiceIds');
  elsif nullif(trim(coalesce(p_payload->>'invoiceId','')),'') is not null then
    v_ids:=array[trim(p_payload->>'invoiceId')];
  end if;

  if coalesce(array_length(v_ids,1),0)=0 then
    raise exception 'No invoices selected';
  end if;

  foreach v_id in array v_ids loop
    select * into v_inv
    from public.invoices
    where invoice_id=trim(v_id)
    for update;

    if not found then raise exception 'Invoice record % was not found',v_id; end if;
    if coalesce(v_inv.outstanding,0)<=0 then raise exception 'Invoice % is already fully paid',v_inv.invoice_no; end if;
    if lower(btrim(coalesce(v_inv.payment_method,''))) not in ('credit','partially paid in cash','partially paid in bank') then raise exception 'Invoice % is not an eligible outstanding receivable',v_inv.invoice_no; end if;

    if not public.bb_is_admin()
       and not public.bb_has_module_access('route.ar-all','create')
       and not private.bb_is_current_receivable_owner(v_inv.location_code) then
      raise exception 'Receivable responsibility access denied for invoice %',v_inv.invoice_no;
    end if;

    if exists(
      select 1
      from public.ar_request_allocations a
      join public.ar_payment_requests r on r.request_id=a.request_id
      where a.invoice_id=v_inv.invoice_id
        and lower(coalesce(r.status,''))='processing'
    ) then
      raise exception 'Invoice % already has a Processing request',v_inv.invoice_no;
    end if;

    if v_count=0 then
      v_first:=v_inv;
    else
      if upper(coalesce(v_inv.currency,'USD'))<>upper(coalesce(v_first.currency,'USD')) then
        raise exception 'Selected invoices must use one currency';
      end if;
    end if;

    v_count:=v_count+1;
  end loop;

  select count(distinct coalesce(customer_id,''))
    into v_customer_count
  from public.invoices
  where invoice_id=any(v_ids);

  if v_count=1 and v_single_amount>0 then
    if v_single_amount>v_first.outstanding+0.000001 then
      raise exception 'Requested amount cannot exceed outstanding balance';
    end if;
  end if;

  v_request_id:=public.bb_next_prefixed_id(
    'public.ar_payment_requests'::regclass,'request_id','ARR',5
  );

  insert into public.ar_payment_requests(
    request_id,request_date,customer_id,customer_name_snapshot,currency,
    request_type,payment_method,note,requested_by_staff_id,
    requested_by_name_snapshot,requested_by_user_id,status
  ) values (
    v_request_id,v_date,
    case when v_customer_count=1 then v_first.customer_id else null end,
    case when v_customer_count=1 then v_first.customer_name_snapshot else 'Multiple Customers' end,
    v_first.currency,
    coalesce(nullif(trim(coalesce(p_payload->>'requestType','')),''),'Direct Request'),
    'Direct Request',v_note,v_staff_id,v_actor,auth.uid(),'Processing'
  );

  foreach v_id in array v_ids loop
    select * into v_inv
    from public.invoices
    where invoice_id=trim(v_id);

    v_idx:=v_idx+1;
    v_amount:=case
      when v_count=1 and v_single_amount>0 then v_single_amount
      else v_inv.outstanding
    end;

    insert into public.ar_request_allocations(
      request_allocation_id,request_id,invoice_id,invoice_no_snapshot,
      requested_amount,currency
    ) values (
      v_request_id||'-'||lpad(v_idx::text,2,'0'),
      v_request_id,v_inv.invoice_id,v_inv.invoice_no,v_amount,v_inv.currency
    );

    v_total:=v_total+v_amount;
  end loop;

  return jsonb_build_object(
    'success',true,
    'requestId',v_request_id,
    'invoiceCount',v_count,
    'totalAmount',v_total,
    'currency',v_first.currency,
    'requestedBy',v_actor,
    'customerCount',v_customer_count
  );
end;
$function$;

-- Align All Receivable EXECUTE with the existing authenticated-only A/R RPCs.
-- Existing module and location checks inside the RPC remain mandatory.
REVOKE ALL ON FUNCTION public.bb_ar_list_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bb_ar_list_all() TO authenticated, service_role;

-- Read-only post-install verification. Fail atomically if source permissions drift.
DO $bb_ar_partpaid_verify$
BEGIN
 IF position('partially paid in cash' in pg_get_functiondef('public.bb_ar_list()'::regprocedure))=0
 OR position('partially paid in bank' in pg_get_functiondef('public.bb_ar_list_all()'::regprocedure))=0
 OR position('partially paid in cash' in pg_get_functiondef('public.bb_ar_create_request_v2(jsonb)'::regprocedure))=0
 THEN RAISE EXCEPTION 'A/R partial-paid eligibility did not install in all three RPCs'; END IF;
 IF position('private.bb_is_current_receivable_owner' in pg_get_functiondef('public.bb_ar_list()'::regprocedure))=0
 OR position('public.bb_has_location_access' in pg_get_functiondef('public.bb_ar_list_all()'::regprocedure))=0
 OR position('public.bb_has_module_access' in pg_get_functiondef('public.bb_ar_create_request_v2(jsonb)'::regprocedure))=0
 THEN RAISE EXCEPTION 'A/R permissions guard missing after patch'; END IF;
 IF has_function_privilege('anon','public.bb_ar_list_all()','EXECUTE')
 THEN RAISE EXCEPTION 'All Receivable must not be directly executable by anon'; END IF;
END;
$bb_ar_partpaid_verify$;
