import {
  RankingPage,
  type RankingSearchParams,
} from "@/app/rankings/rankings-page";

type Props = {
  searchParams: Promise<RankingSearchParams>;
};

export default async function CoursesPage({ searchParams }: Props) {
  return RankingPage({ entity: "course", searchParams: await searchParams });
}
