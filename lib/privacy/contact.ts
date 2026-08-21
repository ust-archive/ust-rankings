export type PrivacyContact = {
  title: string;
  email: string;
  address?: string;
};

export function privacyContact(): PrivacyContact {
  const title = process.env.PRIVACY_CONTACT_TITLE?.trim() || "Operator";
  const email =
    process.env.PRIVACY_CONTACT_EMAIL?.trim() || "ust-rankings@flandia.dev";
  const address = process.env.PRIVACY_CONTACT_ADDRESS?.trim() || undefined;
  return address ? { title, email, address } : { title, email };
}

export function privacyContactMailto() {
  return `mailto:${privacyContact().email}`;
}
