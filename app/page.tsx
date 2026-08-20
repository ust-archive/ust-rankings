import { permanentRedirect } from "next/navigation";

export default function Home() {
  permanentRedirect("/rankings/instructors");
}
