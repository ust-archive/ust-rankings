import { Suspense } from "react";
import { DetailPagePrototype } from "./prototype-client";

export default function PrototypePage() {
  return (
    <Suspense fallback={null}>
      <DetailPagePrototype />
    </Suspense>
  );
}
