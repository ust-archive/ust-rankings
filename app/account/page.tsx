import { redirect } from "next/navigation";
import { endSession, updateAccount } from "@/app/account/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { authenticatedUserId } from "@/lib/auth/user";
import { getAccountService } from "@/lib/contributions/postgres";
import { privacyContactMailto } from "@/lib/privacy/contact";

export const dynamic = "force-dynamic";

const contributionDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const REACTION_LABELS: Record<string, string> = {
  love: "❤️ Love",
  laugh: "😂 Laugh",
  surprised: "😮 Surprised",
  confused: "😕 Confused",
  sad: "😢 Sad",
  angry: "😡 Angry",
  fire: "🔥 Fire",
};

const STATUS_COPY = {
  suspended: "This account is suspended. Contribution writes are disabled.",
  closed: "This account is closed. Contribution writes are disabled.",
} as const;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const userId = await authenticatedUserId();
  if (!userId) redirect("/sign-in?r=%2Faccount");
  const account = getAccountService();
  const [user, contributions] = await Promise.all([
    account.getUser(userId),
    account.getContributions(userId),
  ]);
  if (!user) redirect("/sign-in?r=%2Faccount");
  if (user.status === "onboarding") redirect("/onboarding?r=%2Faccount");

  return (
    <section className="flex w-full max-w-4xl flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-950 shadow-sm sm:p-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-slate-600">
          Email the{" "}
          <a className="underline" href={privacyContactMailto()}>
            Privacy Contact
          </a>{" "}
          to request your data, a correction, a review withdrawal, or to close
          your account.
        </p>
      </header>
      {params.saved ? (
        <p
          className="rounded-lg bg-green-50 p-3 text-sm text-green-900"
          role="status"
        >
          Account settings saved.
        </p>
      ) : null}
      {params.error ? (
        <p
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          Account settings could not be saved ({params.error}).
        </p>
      ) : null}
      {user.status === "active" ? (
        <form action={updateAccount} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="font-semibold" htmlFor="accountDisplayName">
              What name do you want people to see?
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              defaultValue={user.publicDisplayName ?? ""}
              id="accountDisplayName"
              name="publicDisplayName"
              required
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              className="rounded-lg bg-[#003366] px-4 py-2 font-semibold text-white"
              type="submit"
            >
              Save
            </button>
            <Button
              formAction={endSession}
              formNoValidate
              type="submit"
              variant="outline"
            >
              Sign out
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {STATUS_COPY[user.status]}
          </p>
          <form action={endSession}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </>
      )}

      <section
        aria-labelledby="your-contributions"
        className="flex flex-col gap-4"
      >
        <header className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold" id="your-contributions">
            Your contributions
          </h2>
          <p className="text-sm text-slate-600">
            Reviews and Emoji Reactions you have submitted.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Reviews</CardTitle>
              <CardDescription>
                Your published and withdrawn Reviews.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {contributions.reviews.length ? (
                <ul className="divide-y divide-slate-200">
                  {contributions.reviews.map((review) => (
                    <li
                      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                      key={review.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        {review.publicationState === "active" ? (
                          <a
                            className="font-semibold underline"
                            href={`/reviews/${review.id}`}
                          >
                            View Review
                          </a>
                        ) : (
                          <span className="font-semibold">
                            Withdrawn Review
                          </span>
                        )}
                        <Badge
                          variant={
                            review.publicationState === "active"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {review.publicationState}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600">
                        {review.coursePrefix && review.courseNumber ? (
                          <a
                            className="underline"
                            href={`/courses/${review.coursePrefix.toLowerCase()}/${review.courseNumber.toLowerCase()}`}
                          >
                            {review.coursePrefix} {review.courseNumber}
                          </a>
                        ) : null}
                        {review.coursePrefix && review.instructorUuid
                          ? " · "
                          : null}
                        {review.instructorUuid ? (
                          <a
                            className="underline"
                            href={`/instructors/${review.instructorUuid}`}
                          >
                            Instructor
                          </a>
                        ) : null}
                        {review.coursePrefix || review.instructorUuid
                          ? " · "
                          : null}
                        <time dateTime={review.publishedAt.toISOString()}>
                          {contributionDate.format(review.publishedAt)}
                        </time>
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No Reviews yet</EmptyTitle>
                    <EmptyDescription>
                      Reviews you publish will appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Emoji Reactions</CardTitle>
              <CardDescription>
                Your currently selected reactions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {contributions.reactions.length ? (
                <ul className="divide-y divide-slate-200">
                  {contributions.reactions.map((reaction) => {
                    const target =
                      reaction.targetType === "course"
                        ? `${reaction.coursePrefix} ${reaction.courseNumber}`
                        : "Instructor";
                    const href =
                      reaction.targetType === "course"
                        ? `/courses/${reaction.coursePrefix.toLowerCase()}/${reaction.courseNumber.toLowerCase()}`
                        : `/instructors/${reaction.instructorUuid}`;
                    const targetKey =
                      reaction.targetType === "course"
                        ? target
                        : reaction.instructorUuid;
                    return (
                      <li
                        className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                        key={`${reaction.targetType}-${targetKey}-${reaction.code}`}
                      >
                        <div className="flex flex-col gap-1">
                          <a className="font-semibold underline" href={href}>
                            {target}
                          </a>
                          <time
                            className="text-sm text-slate-600"
                            dateTime={reaction.createdAt.toISOString()}
                          >
                            {contributionDate.format(reaction.createdAt)}
                          </time>
                        </div>
                        <Badge variant="secondary">
                          {REACTION_LABELS[reaction.code] ?? reaction.code}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No Emoji Reactions yet</EmptyTitle>
                    <EmptyDescription>
                      Reactions you select will appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </section>
  );
}
