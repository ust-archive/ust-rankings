import { productionRankingRefreshDependencies } from "@/lib/rankings/runtime";
import { refreshRankings } from "@/lib/rankings/server";

const result = await refreshRankings({}, productionRankingRefreshDependencies());
console.log(JSON.stringify(result));
