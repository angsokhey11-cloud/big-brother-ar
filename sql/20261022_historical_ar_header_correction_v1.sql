-- BIG BROTHER Historical Opening A/R: admin-only invoice header correction.
-- Purpose: correct an imported paper invoice number and/or invoice date only.
-- Existing customer, payment, currency, financial balances, due date and photo remain unchanged.
-- Deployment: Supabase Cloud migration + identical Local Brain migration through controller.

CREATE OR REPLACE FUNCTION public.bb_ar_migration_editable_list(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 75,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_total bigint;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.bb_is_active_user()
     OR NOT public.bb_is_admin()
     OR NOT public.bb_has_module_access('route.ar-all','view')
     OR NOT public.bb_has_module_access('accounts_receivable','edit') THEN
    RAISE EXCEPTION 'Historical A/R correction access denied';
  END IF;
  IF length(v_search)>120 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'Invalid historical A/R search or page size';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.invoices i
  WHERE i.invoice_id LIKE 'AR-MIG-%'
    AND i.migration_note LIKE 'Historical opening A/R import.%'
    AND (v_search = ''
      OR lower(i.invoice_no) LIKE '%'||v_search||'%'
      OR lower(coalesce(i.customer_name_snapshot,'')) LIKE '%'||v_search||'%'
      OR lower(coalesce(i.customer_id,'')) LIKE '%'||v_search||'%'
      OR lower(coalesce(i.location_code,'')) LIKE '%'||v_search||'%'
      OR i.invoice_date::text LIKE '%'||v_search||'%');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'invoice_id',s.invoice_id,'invoice_no',s.invoice_no,
    'invoice_date',s.invoice_date,'due_date',s.due_date,
    'customer_id',s.customer_id,'customer_name',s.customer_name_snapshot,
    'location_code',s.location_code,'currency',s.currency,
    'grand_total',s.grand_total,'amount_paid',s.amount_paid,'outstanding',s.outstanding,
    'has_photo',EXISTS (
      SELECT 1 FROM public.bb_real_invoice_files f
      WHERE f.invoice_id=s.invoice_id AND f.retention_deleted_at IS NULL),
    'has_payments',EXISTS (
      SELECT 1 FROM public.payments p WHERE p.invoice_id=s.invoice_id)
  ) ORDER BY s.created_at DESC,s.invoice_id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT i.invoice_id,i.invoice_no,i.invoice_date,i.due_date,
           i.customer_id,i.customer_name_snapshot,i.location_code,
           i.currency,i.grand_total,i.amount_paid,i.outstanding,i.created_at
    FROM public.invoices i
    WHERE i.invoice_id LIKE 'AR-MIG-%'
      AND i.migration_note LIKE 'Historical opening A/R import.%'
      AND (v_search = ''
        OR lower(i.invoice_no) LIKE '%'||v_search||'%'
        OR lower(coalesce(i.customer_name_snapshot,'')) LIKE '%'||v_search||'%'
        OR lower(coalesce(i.customer_id,'')) LIKE '%'||v_search||'%'
        OR lower(coalesce(i.location_code,'')) LIKE '%'||v_search||'%'
        OR i.invoice_date::text LIKE '%'||v_search||'%')
    ORDER BY i.created_at DESC,i.invoice_id
    LIMIT p_limit OFFSET p_offset
  ) s;

  RETURN jsonb_build_object(
    'rows',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bb_ar_migration_correct_header(
  p_invoice_id text,
  p_invoice_no text,
  p_invoice_date date,
  p_expected_invoice_no text,
  p_expected_invoice_date date,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_number text := btrim(coalesce(p_invoice_no,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_before jsonb;
  v_after jsonb;
  v_has_photo boolean;
  v_has_payments boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.bb_is_active_user()
     OR NOT public.bb_is_admin()
     OR NOT public.bb_has_module_access('route.ar-all','view')
     OR NOT public.bb_has_module_access('accounts_receivable','edit') THEN
    RAISE EXCEPTION 'Only an authorized administrator may correct historical A/R';
  END IF;
  IF p_invoice_id IS NULL
     OR p_invoice_id !~ '^AR-MIG-[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Only imported historical A/R invoice IDs may be corrected';
  END IF;
  IF v_number='' OR length(v_number)>80 OR v_number ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invoice number is required (maximum 80 characters, no control characters)';
  END IF;
  IF p_invoice_date IS NULL OR p_invoice_date > current_date THEN
    RAISE EXCEPTION 'Invoice date must be a valid historical date (not in the future)';
  END IF;
  IF length(v_reason)<8 OR length(v_reason)>500 THEN
    RAISE EXCEPTION 'Correction reason must contain 8 to 500 characters';
  END IF;
  IF p_expected_invoice_no IS NULL OR p_expected_invoice_date IS NULL THEN
    RAISE EXCEPTION 'Original invoice number and date are required for safe correction';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices i WHERE i.invoice_id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_invoice.migration_note,'') NOT LIKE 'Historical opening A/R import.%' THEN
    RAISE EXCEPTION 'Historical imported invoice not found';
  END IF;
  IF v_invoice.invoice_no IS DISTINCT FROM p_expected_invoice_no
     OR v_invoice.invoice_date IS DISTINCT FROM p_expected_invoice_date THEN
    RAISE EXCEPTION 'Invoice changed since you opened it. Refresh and review again';
  END IF;
  IF v_number = v_invoice.invoice_no AND p_invoice_date = v_invoice.invoice_date THEN
    RAISE EXCEPTION 'Nothing to correct; both invoice number and date are unchanged';
  END IF;
  IF v_invoice.due_date IS NOT NULL AND p_invoice_date > v_invoice.due_date THEN
    RAISE EXCEPTION 'Invoice date cannot be later than its existing due date';
  END IF;

  -- Preserve intended uniqueness: same number can exist at another
  -- customer, but never at the same customer (case/space insensitive).
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.customer_id=v_invoice.customer_id
      AND i.invoice_id<>v_invoice.invoice_id
      AND lower(btrim(i.invoice_no))=lower(v_number)
  ) THEN
    RAISE EXCEPTION 'Invoice number is already registered for this customer';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.bb_real_invoice_files f
    WHERE f.invoice_id=v_invoice.invoice_id AND f.retention_deleted_at IS NULL
  ) INTO v_has_photo;
  SELECT EXISTS(
    SELECT 1 FROM public.payments p WHERE p.invoice_id=v_invoice.invoice_id
  ) INTO v_has_payments;

  v_before := jsonb_build_object(
    'invoice_id',v_invoice.invoice_id,'invoice_no',v_invoice.invoice_no,
    'invoice_date',v_invoice.invoice_date,'due_date',v_invoice.due_date,
    'customer_id',v_invoice.customer_id,'location_code',v_invoice.location_code,
    'currency',v_invoice.currency,'grand_total',v_invoice.grand_total,
    'amount_paid',v_invoice.amount_paid,'outstanding',v_invoice.outstanding,
    'source_created_at',v_invoice.source_created_at);

  -- Source date was initialized from invoice_date by original opening importer.
  -- Keep these synthetic imported dates aligned only if they were aligned before.
  UPDATE public.invoices i
  SET invoice_no=v_number,
      invoice_date=p_invoice_date,
      source_created_at=CASE
        WHEN v_invoice.source_created_at IS NOT NULL
          AND (v_invoice.source_created_at AT TIME ZONE 'UTC')::date=v_invoice.invoice_date
        THEN (p_invoice_date::timestamp AT TIME ZONE 'UTC')
        ELSE v_invoice.source_created_at END
  WHERE i.invoice_id=v_invoice.invoice_id;

  SELECT jsonb_build_object(
    'invoice_id',i.invoice_id,'invoice_no',i.invoice_no,
    'invoice_date',i.invoice_date,'due_date',i.due_date,
    'customer_id',i.customer_id,'location_code',i.location_code,
    'currency',i.currency,'grand_total',i.grand_total,
    'amount_paid',i.amount_paid,'outstanding',i.outstanding,
    'source_created_at',i.source_created_at)
  INTO v_after FROM public.invoices i WHERE i.invoice_id=v_invoice.invoice_id;

  -- Atomic, immutable correction evidence: reason, actor, time, before/after.
  INSERT INTO public.bb_audit_log(
    actor_user_id,actor_staff_id,actor_name,module,action,
    record_type,record_id,reference_no,reason,before_state,after_state,metadata)
  VALUES (
    auth.uid(),public.bb_actor_staff_id(),public.bb_actor_name(),
    'accounts_receivable','historical_header_correction',
    'invoices',v_invoice.invoice_id,v_number,v_reason,v_before,v_after,
    jsonb_build_object('hasPhoto',v_has_photo,'hasPayments',v_has_payments,
      'source','opening-ar-admin-correction','financialFieldsUnchanged',true));

  RETURN jsonb_build_object(
    'success',true,'invoice_id',v_invoice.invoice_id,
    'invoice_no',v_number,'invoice_date',p_invoice_date,
    'due_date',v_invoice.due_date,'has_photo',v_has_photo,
    'has_payments',v_has_payments,'customer_id',v_invoice.customer_id,
    'customer_name',v_invoice.customer_name_snapshot,
    'location_code',v_invoice.location_code,
    'financial_fields_unchanged',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.bb_ar_migration_editable_list(text,integer,integer)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bb_ar_migration_correct_header(text,text,date,text,date,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bb_ar_migration_editable_list(text,integer,integer)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bb_ar_migration_correct_header(text,text,date,text,date,text)
  TO authenticated,service_role;
