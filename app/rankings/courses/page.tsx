import {
  RankingPage,
  type RankingSearchParams,
} from "@/app/rankings/rankings-page";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<RankingSearchParams>;
};

export default async function CoursesPage({ searchParams }: Props) {
  return RankingPage({
    entity: "course",
    searchParams: await searchParams,
  });
}
