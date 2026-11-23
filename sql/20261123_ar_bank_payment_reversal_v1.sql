-- BIG BROTHER A/R Payment Reversal V1 | deployed on 23-Nov-2026
-- Scope: admin-only, direct bank payment clearings. Preserves sales/stock.
-- Bank-wallet, closed requests/deposits, cash and compound bank references are NOT eligible.
-- All mutations in the RPC are atomic; preserves original snapshot in Sales History and Audit Log.
CREATE OR REPLACE FUNCTION public.bb_ar_payment_reversal_v1(p_action text, p_search text DEFAULT NULL::text, p_payment_id text DEFAULT NULL::text, p_token text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_action text := lower(btrim(coalesce(p_action,'')));
 v_query text := btrim(coalesce(p_search,''));
 v_id text := btrim(coalesce(p_payment_id,''));
 v_payment public.payments%ROWTYPE;
 v_invoice public.invoices%ROWTYPE;
 v_alloc record;
 v_alloc_count integer;
 v_total numeric;
 v_tol numeric;
 v_block text := '';
 v_invoices jsonb := '[]'::jsonb;
 v_snapshot jsonb;
 v_token text;
 v_before jsonb;
 v_after jsonb;
 v_audit text;
 v_actor text;
 v_sum numeric;
 v_rows integer;
 v_new_paid numeric;
 v_new_out numeric;
 v_new_status text;
 v_tx text;
 v_reason text := btrim(coalesce(p_reason,''));
BEGIN
 IF auth.uid() IS NULL OR NOT public.bb_is_admin()
   OR NOT public.bb_has_module_access('accounts_receivable','edit')
 THEN RAISE EXCEPTION 'Admin A/R edit permission required'; END IF;

 IF v_action='search' THEN
  IF length(v_query)<2 OR length(v_query)>140 THEN
   RETURN jsonb_build_object('rows','[]'::jsonb,'hint','Enter a payment ID, transaction ID, invoice or customer (at least 2 characters).');
  END IF;
  RETURN jsonb_build_object('rows',coalesce((
    SELECT jsonb_agg(to_jsonb(y) ORDER BY y.created_at DESC)
    FROM (
      SELECT p.payment_id,p.customer_id,p.customer_name_snapshot,p.invoice_no_snapshot,
        p.payment_date,p.amount,p.currency,p.transaction_id,p.created_at,p.payment_method,
        p.invoice_id
      FROM public.payments p
      WHERE p.payment_source='Receivable' AND p.payment_method='Bank'
        AND (p.payment_id ILIKE '%'||v_query||'%'
          OR p.transaction_id ILIKE '%'||v_query||'%'
          OR p.invoice_no_snapshot ILIKE '%'||v_query||'%'
          OR p.customer_name_snapshot ILIKE '%'||v_query||'%'
          OR p.customer_id ILIKE '%'||v_query||'%')
      ORDER BY p.created_at DESC,p.payment_id DESC LIMIT 40
    ) y
  ),'[]'::jsonb));
 ELSIF v_action NOT IN ('preview','reverse') THEN
  RAISE EXCEPTION 'Unsupported reversal action';
 END IF;

 IF v_id = '' OR length(v_id)>90 THEN RAISE EXCEPTION 'Select one valid A/R bank payment'; END IF;
 SELECT * INTO v_payment FROM public.payments WHERE payment_id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found or already reversed. Refresh the list.'; END IF;
 IF NOT public.bb_authorized('accounts_receivable','edit',v_payment.location_code)
 THEN RAISE EXCEPTION 'A/R location edit permission required'; END IF;

 v_tx := upper(btrim(coalesce(v_payment.transaction_id,'')));
 IF v_tx<>'' THEN PERFORM pg_advisory_xact_lock(hashtext('BB_BANK_TX_'||v_tx)); END IF;
 IF v_payment.payment_source<>'Receivable' OR v_payment.payment_method<>'Bank'
    OR v_tx='' OR length(v_tx)>160 OR v_payment.amount<=0
    OR v_payment.currency NOT IN ('USD','KHR')
    OR coalesce(v_payment.migration_review_required,false)
 THEN v_block:='Only an active direct bank A/R payment with a real transaction ID can be reversed.'; END IF;

 v_tol:=CASE WHEN v_payment.currency='KHR' THEN 0.5 ELSE 0.005 END;
 SELECT count(*),coalesce(sum(a.applied_amount),0)
 INTO v_alloc_count,v_total
 FROM public.payment_allocations a WHERE a.payment_id=v_id;
 IF v_block='' AND (v_alloc_count<1 OR abs(v_total-v_payment.amount)>v_tol)
 THEN v_block:='Payment allocations do not reconcile; use a reviewed accounting correction.'; END IF;
 IF v_block='' AND v_alloc_count<>(SELECT count(DISTINCT a.invoice_id) FROM public.payment_allocations a WHERE a.payment_id=v_id)
 THEN v_block:='Multiple allocations to the same invoice must be reconciled manually.'; END IF;
 IF v_block='' AND v_tx ~ '[,;]'
 THEN v_block:='Combined multiple bank references need manual verification before reversal.'; END IF;

 -- A registered/allocated wallet receipt must use its own wallet reversal process.
 -- Releasing the payment ID alone would NOT free the verified bank registration.
 IF v_block='' AND (
    EXISTS(SELECT 1 FROM public.bb_bank_balance_allocations a WHERE a.payment_id=v_id OR upper(btrim(a.transaction_id))=v_tx)
    OR EXISTS(SELECT 1 FROM public.bb_verified_bank_transactions t WHERE t.used_payment_id=v_id OR upper(btrim(t.transaction_id))=v_tx)
    OR EXISTS(SELECT 1 FROM public.bb_bank_balance_snapshot s WHERE upper(btrim(s.transaction_id))=v_tx)
    OR EXISTS(SELECT 1 FROM public.bb_bank_outlet_shares s WHERE upper(btrim(s.transaction_id))=v_tx)
 ) THEN v_block:='This payment uses a registered bank wallet/share. Use the wallet-specific audited reversal instead.'; END IF;

 IF v_block='' AND (
    (SELECT count(*) FROM public.payments p WHERE upper(btrim(coalesce(p.transaction_id,'')))=v_tx)<>1
    OR EXISTS(SELECT 1 FROM public.bb_cancelled_bank_transaction_ids t WHERE upper(btrim(t.transaction_id))=v_tx)
    OR EXISTS(SELECT 1 FROM public.company_deposits d WHERE d.payment_id=v_id OR upper(btrim(coalesce(d.collection_transaction_id,'')))=v_tx)
    OR EXISTS(SELECT 1 FROM public.purchase_payments d WHERE upper(btrim(coalesce(d.transaction_id,'')))=v_tx)
    OR EXISTS(SELECT 1 FROM public.bb_bank_refund_ledger d WHERE upper(btrim(coalesce(d.transaction_id,'')))=v_tx)
    OR EXISTS(SELECT 1 FROM public.bb_bank_new_invoice_review_drafts d WHERE upper(btrim(coalesce(d.transaction_id,'')))=v_tx OR upper(btrim(coalesce(d.registered_transaction_id,'')))=v_tx)
    OR EXISTS(SELECT 1 FROM public.ar_payment_requests r WHERE r.payment_id=v_id OR upper(btrim(coalesce(r.transaction_id,'')))=v_tx)
    OR EXISTS(SELECT 1 FROM public.daily_receivable_cash_collections d WHERE d.payment_id=v_id)
    OR EXISTS(SELECT 1 FROM public.telegram_ar_jobs j WHERE j.payment_id=v_id)
    OR EXISTS(SELECT 1 FROM public.daily_cash_closes d WHERE upper(btrim(coalesce(d.bank_transaction_id,'')))=v_tx)
    OR EXISTS(SELECT 1 FROM public.bb_invoice_direct_refunds d WHERE upper(btrim(coalesce(d.bank_transaction_id,'')))=v_tx)
 ) THEN v_block:='A linked registration, request, cash record, refund or duplicate bank ID exists. Manual reconciliation is required.'; END IF;

 -- Lock all affected invoices before validating or writing. Never rely on invoice number.
 FOR v_alloc IN
   SELECT a.* FROM public.payment_allocations a
   WHERE a.payment_id=v_id ORDER BY a.invoice_id,a.allocation_id
 LOOP
   SELECT * INTO v_invoice FROM public.invoices
   WHERE invoice_id=v_alloc.invoice_id FOR UPDATE;
   IF NOT FOUND THEN v_block:='A linked invoice is missing. Cannot reverse.'; EXIT; END IF;
   IF v_invoice.customer_id IS DISTINCT FROM v_payment.customer_id
      OR v_invoice.currency IS DISTINCT FROM v_payment.currency
      OR lower(coalesce(v_invoice.payment_method,''))<>'credit'
      OR lower(coalesce(v_invoice.status,'')) IN ('void','reversed','cancelled','canceled')
      OR coalesce(v_invoice.amount_paid,0)<v_alloc.applied_amount-v_tol
      OR v_alloc.applied_amount<=0
      OR v_alloc.currency IS DISTINCT FROM v_invoice.currency
   THEN v_block:='A linked invoice or its paid amount no longer matches this payment.'; END IF;

   IF EXISTS(
     SELECT 1 FROM public.ar_request_allocations a
     JOIN public.ar_payment_requests r ON r.request_id=a.request_id
     WHERE a.invoice_id=v_invoice.invoice_id AND lower(coalesce(r.status,''))='processing'
   ) OR EXISTS(SELECT 1 FROM public.daily_cash_close_invoices d WHERE d.invoice_id=v_invoice.invoice_id)
     OR EXISTS(SELECT 1 FROM public.daily_cash_request_invoices d WHERE d.invoice_id=v_invoice.invoice_id)
     OR EXISTS(SELECT 1 FROM public.sales_returns s WHERE s.invoice_id=v_invoice.invoice_id)
   THEN v_block:='An invoice is linked to a pending request, closed collection or sales return. Review it manually.'; END IF;

   IF abs(v_invoice.outstanding-greatest(v_invoice.grand_total-coalesce(v_invoice.reversal_amount,0)-v_invoice.amount_paid,0))>v_tol
   THEN v_block:='Invoice amount paid and outstanding do not reconcile. Review manually.'; END IF;
   v_new_paid := greatest(v_invoice.amount_paid-v_alloc.applied_amount,0);
   v_new_out := greatest(v_invoice.grand_total-coalesce(v_invoice.reversal_amount,0)-v_new_paid,0);
   IF v_new_out>v_invoice.grand_total+v_tol
      OR v_invoice.grand_total<0
      OR v_invoice.amount_paid>v_invoice.grand_total+v_tol
   THEN v_block:='Invoice balance reconciliation failed.'; END IF;

   v_invoices:=v_invoices||jsonb_build_array(
    jsonb_build_object('invoiceId',v_invoice.invoice_id,'invoiceNo',v_invoice.invoice_no,
      'invoiceDate',v_invoice.invoice_date,'invoiceAmount',v_invoice.grand_total,
      'allocatedAmount',v_alloc.applied_amount,'currency',v_invoice.currency,
      'beforePaid',v_invoice.amount_paid,'beforeOutstanding',v_invoice.outstanding,
      'afterPaid',v_new_paid,'afterOutstanding',v_new_out,
      'invoiceState',to_jsonb(v_invoice),'allocationState',to_jsonb(v_alloc))
   );
 END LOOP;
 IF v_alloc_count <> jsonb_array_length(v_invoices) AND v_block='' THEN
    v_block:='Incomplete invoice allocation list.'; END IF;

 v_snapshot:=jsonb_build_object('payment',to_jsonb(v_payment),'invoices',v_invoices);
 v_token:=md5(v_snapshot::text);
 IF v_action='preview' THEN
   RETURN jsonb_build_object('eligible',v_block='','blockReason',nullif(v_block,''),
      'paymentId',v_payment.payment_id,'customerId',v_payment.customer_id,
      'customerName',v_payment.customer_name_snapshot,'transactionId',v_payment.transaction_id,
      'paymentDate',v_payment.payment_date,'amount',v_payment.amount,'currency',v_payment.currency,
      'bank',v_payment.bank_payment,'invoices',(
       SELECT coalesce(jsonb_agg(z.item-'invoiceState'-'allocationState'),'[]'::jsonb)
       FROM jsonb_array_elements(v_invoices) z(item)
      ),'token',v_token);
 END IF;

 IF v_block<>'' THEN RAISE EXCEPTION '%',v_block; END IF;
 IF length(v_reason)<12 OR length(v_reason)>500 THEN
   RAISE EXCEPTION 'Enter a reason between 12 and 500 characters'; END IF;
 IF btrim(coalesce(p_token,''))<>v_token THEN
   RAISE EXCEPTION 'Payment or invoice changed. Preview again before reversing.'; END IF;

 v_before:=v_snapshot;
 DELETE FROM public.payment_allocations WHERE payment_id=v_id;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>v_alloc_count THEN RAISE EXCEPTION 'Payment allocation reversal mismatch'; END IF;

 DELETE FROM public.payments WHERE payment_id=v_id AND upper(btrim(transaction_id))=v_tx;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 THEN RAISE EXCEPTION 'Bank payment reversal mismatch'; END IF;

 FOR v_alloc IN SELECT x.item FROM jsonb_array_elements(v_invoices) x(item)
 LOOP
   v_new_paid := (v_alloc.item->>'afterPaid')::numeric;
   v_new_out := (v_alloc.item->>'afterOutstanding')::numeric;
   UPDATE public.invoices SET
     amount_paid=v_new_paid,
     outstanding=v_new_out,
     credit_amount=v_new_out,
     status=CASE WHEN v_new_out<=v_tol THEN 'Paid'
         WHEN v_new_paid>v_tol THEN 'Processing' ELSE 'Unpaid' END
   WHERE invoice_id=v_alloc.item->>'invoiceId';
   GET DIAGNOSTICS v_rows=ROW_COUNT;
   IF v_rows<>1 THEN RAISE EXCEPTION 'Invoice outstanding restoration mismatch'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.invoice_id=v_alloc.item->>'invoiceId'
       AND abs(i.amount_paid-v_new_paid)<=v_tol AND abs(i.outstanding-v_new_out)<=v_tol)
   THEN RAISE EXCEPTION 'Invoice net balance guard rejected the reversal'; END IF;
 END LOOP;

 IF EXISTS(SELECT 1 FROM public.payments p WHERE upper(btrim(coalesce(p.transaction_id,'')))=v_tx)
  OR EXISTS(SELECT 1 FROM public.bb_cancelled_bank_transaction_ids c WHERE upper(btrim(c.transaction_id))=v_tx)
 THEN RAISE EXCEPTION 'Transaction ID not free after reversal. Nothing committed.'; END IF;

 v_after:=jsonb_build_object(
   'removedPaymentId',v_id,'releasedTransactionId',v_payment.transaction_id,
   'invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'invoiceId',i.invoice_id,'invoiceNo',i.invoice_no,'status',i.status,
      'amountPaid',i.amount_paid,'outstanding',i.outstanding) ORDER BY i.invoice_date,i.invoice_id),'[]'::jsonb)
      FROM public.invoices i WHERE i.invoice_id IN
       (SELECT x.item->>'invoiceId' FROM jsonb_array_elements(v_invoices) x(item))));
 v_actor:=coalesce(nullif(public.bb_actor_name(),''),'BIG BROTHER Admin');
 v_audit:=public.bb_next_prefixed_id('public.sales_database_edit_history'::regclass,'audit_id','AUD',6);
 INSERT INTO public.sales_database_edit_history(
    audit_id,occurred_at,module,record_id,record_no,action,field_name,
    old_value,new_value,reason,admin_name_snapshot)
 VALUES(v_audit,now(),'Accounts Receivable',v_id,v_payment.invoice_no_snapshot,
   'REVERSE','A/R Bank Payment Reversal',v_before::text,v_after::text,v_reason,v_actor);

 INSERT INTO public.bb_audit_log(
   occurred_at,actor_user_id,actor_name,module,action,record_type,record_id,
   reference_no,reason,before_state,after_state,metadata)
 VALUES(now(),auth.uid(),v_actor,'accounts_receivable',
   'admin_ar_bank_payment_reversal','payments',v_id,v_payment.transaction_id,
   v_reason,v_before,v_after,jsonb_build_object('auditId',v_audit,'customerId',
   v_payment.customer_id,'amount',v_payment.amount,'currency',v_payment.currency,
   'transactionReleased',true,'paymentId',v_id));

 RETURN jsonb_build_object('success',true,'paymentId',v_id,'releasedTransactionId',
   v_payment.transaction_id,'restoredAmount',v_payment.amount,'currency',v_payment.currency,
   'affectedInvoices',v_after->'invoices','auditId',v_audit);
END
$function$;
REVOKE ALL ON FUNCTION public.bb_ar_payment_reversal_v1(text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bb_ar_payment_reversal_v1(text,text,text,text,text) TO authenticated;
