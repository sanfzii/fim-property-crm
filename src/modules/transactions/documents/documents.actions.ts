// Lokasi: src/modules/transactions/documents/documents.actions.ts
// Layer 3: Server Action Pengambilan Metadata Dokumen Terpadu per Booking (Zero Duplication dengan transactions.actions.ts)

'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  AppError,
  executeSafeServerAction,
  translateDatabaseOrRpcError,
  type ActionResult,
} from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import { isValidUuid } from '@/modules/shared/storage/storage.paths';

export interface BookingDocumentsMetadata {
  paymentProofs: Array<{
    id: string;
    reference_number: string;
    paid_amount: number;
    payment_date: string;
    proof_file_path: string;
    proof_file_name: string;
    verification_status: string;
    submitted_at: string;
  }>;
  kprApplicationStatus: string | null;
  kprCurrentStage: string | null;
  kprDocuments: Array<{
    id: string;
    document_name: string;
    is_mandatory: boolean;
    status: string;
    file_path: string | null;
    file_name: string | null;
    uploaded_at: string | null;
    verified_at: string | null;
    verification_notes: string | null;
  }>;
  kprDisbursementProofs: Array<{
    id: string;
    tranche_type: string;
    sequence_number: number;
    disbursement_reference: string;
    proof_file_path: string;
    disbursement_date: string;
  }>;
  refundProofs: Array<{
    id: string;
    reference_number: string;
    refund_amount: number;
    status: string;
    proof_file_path: string | null;
    refund_date: string | null;
  }>;
  dealContract: {
    id: string;
    reference_number: string;
    contract_document_number: string | null;
    contract_file_path: string | null;
    contract_signed_at: string | null;
  } | null;
}

/**
 * Server Action: Mengambil Seluruh Metadata Dokumen Terkait Satu Booking.
 * Digunakan untuk menampilkan repositori dokumen terpadu pada halaman detail Booking/Deal.
 * Catatan: Aksi unggah & pembuatan Signed URL ditangani secara terpusat di transactions.actions.ts.
 */
export async function listBookingDocumentsMetadataAction(
  bookingId: string
): Promise<ActionResult<BookingDocumentsMetadata>> {
  return executeSafeServerAction(
    { module: 'documents', action: 'listBookingDocumentsMetadataAction' },
    async () => {
      await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);

      if (!isValidUuid(bookingId)) {
        throw new AppError({
          message: 'Identitas Booking tidak valid.',
          category: 'VALIDATION_ERROR',
          code: 'INVALID_BOOKING_ID',
          statusCode: 400,
        });
      }

      const supabase = await createSupabaseServerClient();

      const [paymentRecordsRes, kprAppRes, refundsRes, dealRes] = await Promise.all([
        supabase
          .from('payment_records')
          .select(
            'id, reference_number, paid_amount, payment_date, proof_file_path, proof_file_name, verification_status, submitted_at'
          )
          .eq('booking_id', bookingId)
          .order('submitted_at', { ascending: false }),
        supabase
          .from('kpr_applications')
          .select(
            'id, reference_number, application_status, current_stage, kpr_documents(id, document_name, is_mandatory, status, file_path, file_name, uploaded_at, verified_at, verification_notes), kpr_disbursements(id, tranche_type, sequence_number, disbursement_reference, proof_file_path, disbursement_date)'
          )
          .eq('booking_id', bookingId)
          .maybeSingle(),
        supabase
          .from('refund_transactions')
          .select('id, reference_number, refund_amount, status, proof_file_path, refund_date')
          .eq('booking_id', bookingId)
          .order('created_at', { ascending: false }),
        supabase
          .from('deals')
          .select(
            'id, reference_number, contract_document_number, contract_file_path, contract_signed_at'
          )
          .eq('booking_id', bookingId)
          .maybeSingle(),
      ]);

      if (paymentRecordsRes.error) {
        throw translateDatabaseOrRpcError(paymentRecordsRes.error);
      }
      if (kprAppRes.error) {
        throw translateDatabaseOrRpcError(kprAppRes.error);
      }
      if (refundsRes.error) {
        throw translateDatabaseOrRpcError(refundsRes.error);
      }
      if (dealRes.error) {
        throw translateDatabaseOrRpcError(dealRes.error);
      }

      const kprDocs = [...(kprAppRes.data?.kpr_documents ?? [])].sort((a, b) =>
        a.document_name.localeCompare(b.document_name)
      );
      const kprDisbursements = [...(kprAppRes.data?.kpr_disbursements ?? [])].sort(
        (a, b) => a.sequence_number - b.sequence_number
      );

      return {
        message: 'Metadata dokumen Booking berhasil dimuat.',
        data: {
          paymentProofs: paymentRecordsRes.data ?? [],
          kprApplicationStatus: kprAppRes.data?.application_status ?? null,
          kprCurrentStage: kprAppRes.data?.current_stage ?? null,
          kprDocuments: kprDocs,
          kprDisbursementProofs: kprDisbursements,
          refundProofs: refundsRes.data ?? [],
          dealContract: dealRes.data ?? null,
        },
      };
    }
  );
}
