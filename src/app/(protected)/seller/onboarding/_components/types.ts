// src/app/(protected)/seller/onboarding/_components/types.ts

export interface UserProps {
  id: string;
  name: string | null;
  email: string;
  sellerTermsAcceptedAt: string | null;
  phoneVerified: boolean;
  idVerified: boolean;
  idVerifiedAt: string | null;
  idSubmittedAt: string | null;
  stripeOnboarded: boolean;
  nzbn: string | null;
  gstRegistered: boolean;
  gstNumber: string | null;
}

export interface VerificationAppProps {
  status: string;
  documentType: string | null;
  adminNotes: string | null;
  appliedAt: string;
}
