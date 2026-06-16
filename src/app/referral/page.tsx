import ReferralClient from "./ReferralClient";

export const metadata = {
  title: "Maya - Referral Copilot",
  description: "Find the right healthcare facility for a specific care need, powered by evidence.",
};

export default function ReferralPage() {
  return <ReferralClient />;
}
