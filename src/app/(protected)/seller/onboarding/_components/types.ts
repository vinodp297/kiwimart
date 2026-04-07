// src/app/(protected)/seller/onboarding/_components/types.ts

export interface UserProps {
  id: string;
  name: string | null;
  email: string;
  sellerTermsAcceptedAt: string | null;
  isPhoneVerified: boolean;
  idVerified: boolean;
  idVerifiedAt: string | null;
  idSubmittedAt: string | null;
  isStripeOnboarded: boolean;
  nzbn: string | null;
  isGstRegistered: boolean;
  gstNumber: string | null;
}

export interface VerificationAppProps {
  status: string;
  documentType: string | null;
  adminNotes: string | null;
  appliedAt: string;
}
