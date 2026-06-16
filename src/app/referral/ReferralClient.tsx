"use client";

import dynamic from "next/dynamic";

const MayaCopilot = dynamic(() => import("@/components/MayaCopilot"), {
  ssr: false,
  loading: () => <p className="map-loading">Loading Maya…</p>,
});

export default function ReferralClient() {
  return <MayaCopilot />;
}
