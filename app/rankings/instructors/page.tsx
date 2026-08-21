import {
  RankingPage,
  type RankingSearchParams,
} from "@/app/rankings/rankings-page";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<RankingSearchParams>;
};

export default async function InstructorsPage({ searchParams }: Props) {
  return RankingPage({
    entity: "instructor",
    searchParams: await searchParams,
  });
}
