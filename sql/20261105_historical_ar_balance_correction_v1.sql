-- BIG BROTHER — Audited correction of imported historical A/R opening balances.
-- Deploy identical SQL to Cloud and Local Brain. This changes no existing invoice data.
-- A corrected opening receivable is NOT a new sale, payment, cash receipt, or stock movement.
-- The underlying credit-invoice guard recalculates outstanding/status/credit_amount.
CREATE OR REPLACE FUNCTION public.bb_ar_migration_correct_invoice(
  p_invoice_id text,
  p_invoice_no text,
  p_invoice_date date,
  p_outstanding numeric,
  p_expected_invoice_no text,
  p_expected_invoice_date date,
  p_expected_outstanding numeric,
  p_expected_grand_total numeric,
  p_expected_amount_paid numeric,
  p_verified_original boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_number text := btrim(coalesce(p_invoice_no,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_new_total numeric;
  v_after public.invoices%ROWTYPE;
  v_before jsonb;
  v_after_json jsonb;
  v_has_photo boolean;
  v_has_payments boolean;
  v_balance_changed boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.bb_is_active_user()
     OR NOT public.bb_is_admin()
     OR NOT public.bb_has_module_access('route.ar-all','view')
     OR NOT public.bb_has_module_access('accounts_receivable','edit') THEN
    RAISE EXCEPTION 'Only an authorized administrator may correct historical A/R';
  END IF;
  IF p_invoice_id IS NULL OR p_invoice_id !~ '^AR-MIG-[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Only imported historical A/R invoice IDs may be corrected';
  END IF;
  IF v_number = '' OR length(v_number) > 80 OR v_number ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invoice number is required (maximum 80 characters, no control characters)';
  END IF;
  IF p_invoice_date IS NULL OR p_invoice_date > current_date THEN
    RAISE EXCEPTION 'Invoice date must be a valid historical date (not in the future)';
  END IF;
  IF length(v_reason) < 8 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Correction reason must contain 8 to 500 characters';
  END IF;
  IF p_outstanding IS NULL OR p_outstanding::text IN ('NaN','Infinity','-Infinity')
     OR p_outstanding < 0 OR p_outstanding > 999999999 THEN
    RAISE EXCEPTION 'Outstanding balance must be between zero and 999,999,999';
  END IF;
  IF p_expected_invoice_no IS NULL OR p_expected_invoice_date IS NULL
     OR p_expected_outstanding IS NULL OR p_expected_grand_total IS NULL
     OR p_expected_amount_paid IS NULL THEN
    RAISE EXCEPTION 'Original invoice and amount snapshots are required';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices i WHERE i.invoice_id = p_invoice_id FOR UPDATE;

  IF NOT FOUND
     OR coalesce(v_invoice.migration_note,'') NOT LIKE 'Historical opening A/R import.%'
     OR lower(coalesce(v_invoice.payment_method,'')) <> 'credit' THEN
    RAISE EXCEPTION 'Historical imported credit invoice not found';
  END IF;
  IF v_invoice.invoice_no IS DISTINCT FROM p_expected_invoice_no
     OR v_invoice.invoice_date IS DISTINCT FROM p_expected_invoice_date
     OR v_invoice.outstanding IS DISTINCT FROM p_expected_outstanding
     OR v_invoice.grand_total IS DISTINCT FROM p_expected_grand_total
     OR v_invoice.amount_paid IS DISTINCT FROM p_expected_amount_paid THEN
    RAISE EXCEPTION 'Invoice or balance changed since you opened it. Refresh and review again';
  END IF;
  IF coalesce(v_invoice.reversal_amount,0) <> 0 THEN
    RAISE EXCEPTION 'A reversed imported invoice must be reviewed separately before correcting its balance';
  END IF;
  IF v_invoice.amount_paid IS NULL OR v_invoice.amount_paid < 0 THEN
    RAISE EXCEPTION 'Existing amount paid is invalid; do not overwrite payment history';
  END IF;
  IF upper(coalesce(v_invoice.currency,'')) = 'USD' THEN
    IF p_outstanding <> round(p_outstanding,2) THEN
      RAISE EXCEPTION 'USD outstanding supports up to 2 decimal places';
    END IF;
  ELSIF upper(coalesce(v_invoice.currency,'')) = 'KHR' THEN
    IF p_outstanding <> trunc(p_outstanding) THEN
      RAISE EXCEPTION 'KHR outstanding must be a whole riel amount';
    END IF;
  ELSE
    RAISE EXCEPTION 'Imported invoice currency is unsupported';
  END IF;
  IF v_invoice.due_date IS NOT NULL AND p_invoice_date > v_invoice.due_date THEN
    RAISE EXCEPTION 'Invoice date cannot be later than its existing due date';
  END IF;

  v_balance_changed := p_outstanding IS DISTINCT FROM v_invoice.outstanding;
  IF v_number = v_invoice.invoice_no AND p_invoice_date = v_invoice.invoice_date
     AND NOT v_balance_changed THEN
    RAISE EXCEPTION 'Nothing to correct';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.bb_real_invoice_files f
    WHERE f.invoice_id = v_invoice.invoice_id AND f.retention_deleted_at IS NULL
  ) INTO v_has_photo;

  IF (v_has_photo OR v_balance_changed)
     AND coalesce(p_verified_original,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Verify the original paper invoice before correcting its financial balance or attached photo header';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.customer_id = v_invoice.customer_id
      AND i.invoice_id <> v_invoice.invoice_id
      AND lower(btrim(i.invoice_no)) = lower(v_number)
  ) THEN
    RAISE EXCEPTION 'Invoice number is already registered for this customer';
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.payments p WHERE p.invoice_id = v_invoice.invoice_id
  ) INTO v_has_payments;

  v_before := jsonb_build_object(
    'invoice_id',v_invoice.invoice_id,'invoice_no',v_invoice.invoice_no,
    'invoice_date',v_invoice.invoice_date,'due_date',v_invoice.due_date,
    'customer_id',v_invoice.customer_id,'location_code',v_invoice.location_code,
    'currency',v_invoice.currency,'grand_total',v_invoice.grand_total,
    'amount_paid',v_invoice.amount_paid,'outstanding',v_invoice.outstanding,
    'credit_amount',v_invoice.credit_amount,'status',v_invoice.status,
    'source_created_at',v_invoice.source_created_at
  );

  -- Preserve all collected cash/bank transactions and imported previously-paid amount.
  -- Changing the historical opening total is the correct way to change only what is due.
  -- The existing credit invoice trigger recalculates outstanding and status atomically.
  v_new_total := p_outstanding + v_invoice.amount_paid;
  UPDATE public.invoices i
  SET invoice_no = v_number,
      invoice_date = p_invoice_date,
      grand_total = v_new_total,
      source_created_at = CASE
        WHEN v_invoice.source_created_at IS NOT NULL
          AND (v_invoice.source_created_at AT TIME ZONE 'UTC')::date = v_invoice.invoice_date
        THEN (p_invoice_date::timestamp AT TIME ZONE 'UTC')
        ELSE v_invoice.source_created_at END
  WHERE i.invoice_id = v_invoice.invoice_id;

  SELECT * INTO STRICT v_after
  FROM public.invoices i WHERE i.invoice_id = v_invoice.invoice_id;
  IF v_after.amount_paid IS DISTINCT FROM v_invoice.amount_paid
     OR v_after.outstanding IS DISTINCT FROM p_outstanding
     OR v_after.grand_total IS DISTINCT FROM v_new_total
     OR v_after.customer_id IS DISTINCT FROM v_invoice.customer_id
     OR v_after.currency IS DISTINCT FROM v_invoice.currency THEN
    RAISE EXCEPTION 'Balance correction verification failed; all changes rolled back';
  END IF;

  v_after_json := jsonb_build_object(
    'invoice_id',v_after.invoice_id,'invoice_no',v_after.invoice_no,
    'invoice_date',v_after.invoice_date,'due_date',v_after.due_date,
    'customer_id',v_after.customer_id,'location_code',v_after.location_code,
    'currency',v_after.currency,'grand_total',v_after.grand_total,
    'amount_paid',v_after.amount_paid,'outstanding',v_after.outstanding,
    'credit_amount',v_after.credit_amount,'status',v_after.status,
    'source_created_at',v_after.source_created_at
  );

  INSERT INTO public.bb_audit_log(
    actor_user_id,actor_staff_id,actor_name,module,action,
    record_type,record_id,reference_no,reason,before_state,after_state,metadata
  ) VALUES (
    auth.uid(),public.bb_actor_staff_id(),public.bb_actor_name(),
    'accounts_receivable','historical_imported_ar_correction',
    'invoices',v_invoice.invoice_id,v_number,v_reason,v_before,v_after_json,
    jsonb_build_object(
      'hasPhoto',v_has_photo,'hasPayments',v_has_payments,
      'originalPaperVerified',coalesce(p_verified_original,false),
      'balanceChanged',v_balance_changed,'paymentEntriesUnchanged',true,
      'source','opening-ar-admin-correction','noSalesOrStockMovements',true)
  );

  RETURN jsonb_build_object(
    'success',true,'invoice_id',v_after.invoice_id,
    'invoice_no',v_after.invoice_no,'invoice_date',v_after.invoice_date,
    'customer_id',v_after.customer_id,'currency',v_after.currency,
    'grand_total',v_after.grand_total,'amount_paid',v_after.amount_paid,
    'outstanding',v_after.outstanding,'due_date',v_after.due_date,
    'has_photo',v_has_photo,'has_payments',v_has_payments,
    'balance_changed',v_balance_changed,'audit_recorded',true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bb_ar_migration_correct_invoice(
  text,text,date,numeric,text,date,numeric,numeric,numeric,boolean,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bb_ar_migration_correct_invoice(
  text,text,date,numeric,text,date,numeric,numeric,numeric,boolean,text
) TO authenticated,service_role;
