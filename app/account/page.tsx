import { redirect } from "next/navigation";
import { endSession, updateAccount } from "@/app/account/actions";
import { EntityLink } from "@/app/entity-navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { authenticatedUserId } from "@/lib/auth/user";
import type {
  AccountContributions,
  AccountRow,
} from "@/lib/contributions/accounts";
import { getAccountService } from "@/lib/contributions/postgres";
import { privacyContactMailto } from "@/lib/privacy/contact";
import { instructorNamesForUuids } from "@/lib/rankings/server";

export const dynamic = "force-dynamic";

const contributionDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const REACTION_LABELS: Record<string, string> = {
  up: "👍 Thumbs up",
  down: "👎 Thumbs down",
  love: "❤️ Love",
  laugh: "😂 Laugh",
  surprised: "😮 Surprised",
  confused: "😕 Confused",
  sad: "😢 Sad",
  angry: "😡 Angry",
  fire: "🔥 Fire",
};

const STATUS_COPY = {
  onboarding: "Complete onboarding before managing this account.",
  suspended: "This account is suspended. Contribution writes are disabled.",
  closed: "This account is closed. Contribution writes are disabled.",
} as const;

type AccountViewProps = {
  user: AccountRow;
  contributions: AccountContributions;
  instructorNames: Map<string, string>;
  saved?: string;
  error?: string;
};

function instructorLabel(uuid: string, names: Map<string, string>) {
  return names.get(uuid) ?? uuid;
}

export function AccountView({
  user,
  contributions,
  instructorNames,
  saved,
  error,
}: AccountViewProps) {
  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 text-left text-slate-900">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
          Community account
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Account</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Manage your public identity and revisit what you have shared with the
          HKUST community.
        </p>
      </header>
      <Separator />
      {saved ? (
        <Alert>
          <AlertDescription>Account settings saved.</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Account settings could not be saved ({error}).
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              The name shown beside your attributed Reviews.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {user.status === "active" ? (
              <form action={updateAccount} className="flex flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="accountDisplayName">
                      Public display name
                    </FieldLabel>
                    <Input
                      defaultValue={user.publicDisplayName ?? ""}
                      id="accountDisplayName"
                      name="publicDisplayName"
                      required
                    />
                  </Field>
                </FieldGroup>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="submit">Save changes</Button>
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
              <div className="flex flex-col gap-4">
                <Alert>
                  <AlertDescription>
                    {STATUS_COPY[user.status]}
                  </AlertDescription>
                </Alert>
                <form action={endSession}>
                  <Button type="submit" variant="outline">
                    Sign out
                  </Button>
                </form>
              </div>
            )}
            <Separator />
            <p className="text-sm text-muted-foreground">
              Email the{" "}
              <a
                className="underline underline-offset-4"
                href={privacyContactMailto()}
              >
                Privacy Contact
              </a>{" "}
              to request your data, a correction, a review withdrawal, or
              account closure.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-start-1 lg:row-start-1">
          <CardHeader>
            <CardTitle>Your contributions</CardTitle>
            <CardDescription>
              Your public Reviews and currently selected reactions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <section
              aria-labelledby="account-reviews"
              className="flex flex-col gap-3"
            >
              <header className="flex items-center justify-between gap-3">
                <h2 className="font-semibold" id="account-reviews">
                  Reviews
                </h2>
                <Badge variant="secondary">
                  {contributions.reviews.length}
                </Badge>
              </header>
              {contributions.reviews.length ? (
                <ul className="divide-y divide-slate-100">
                  {contributions.reviews.map((review) => (
                    <li
                      className="flex flex-col gap-1 py-3 first:pt-1 last:pb-0"
                      key={review.id}
                    >
                      <EntityLink
                        className="w-fit font-medium !no-underline hover:!underline"
                        href={`/reviews/${review.id}`}
                      >
                        View Review
                      </EntityLink>
                      <p className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground">
                        {review.coursePrefix && review.courseNumber ? (
                          <EntityLink
                            className="!no-underline hover:!underline"
                            href={`/courses/${review.coursePrefix.toLowerCase()}/${review.courseNumber.toLowerCase()}`}
                          >
                            {review.coursePrefix} {review.courseNumber}
                          </EntityLink>
                        ) : null}
                        {review.instructorUuid ? (
                          <EntityLink
                            className="!no-underline hover:!underline"
                            href={`/instructors/${review.instructorUuid}`}
                          >
                            {instructorLabel(
                              review.instructorUuid,
                              instructorNames,
                            )}
                          </EntityLink>
                        ) : null}
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
            </section>

            <Separator />

            <section
              aria-labelledby="account-reactions"
              className="flex flex-col gap-3"
            >
              <header className="flex items-center justify-between gap-3">
                <h2 className="font-semibold" id="account-reactions">
                  Reactions
                </h2>
                <Badge variant="secondary">
                  {contributions.reactions.length}
                </Badge>
              </header>
              {contributions.reactions.length ? (
                <ul className="divide-y divide-slate-100">
                  {contributions.reactions.map((reaction) => {
                    const target =
                      reaction.targetType === "course"
                        ? `${reaction.coursePrefix} ${reaction.courseNumber}`
                        : reaction.targetType === "instructor"
                          ? instructorLabel(
                              reaction.instructorUuid,
                              instructorNames,
                            )
                          : reaction.reviewAuthor
                            ? `${reaction.reviewAuthor}'s Review`
                            : "Anonymous Review";
                    const href =
                      reaction.targetType === "course"
                        ? `/courses/${reaction.coursePrefix.toLowerCase()}/${reaction.courseNumber.toLowerCase()}`
                        : reaction.targetType === "instructor"
                          ? `/instructors/${reaction.instructorUuid}`
                          : `/reviews/${reaction.reviewId}`;
                    return (
                      <li
                        className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-0"
                        key={`${reaction.targetType}-${href}-${reaction.kind}-${reaction.code}`}
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <EntityLink
                            className="truncate font-medium !no-underline hover:!underline"
                            href={href}
                          >
                            {target}
                          </EntityLink>
                          {reaction.targetType === "review" &&
                          (reaction.coursePrefix || reaction.instructorUuid) ? (
                            <p className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground">
                              {reaction.coursePrefix &&
                              reaction.courseNumber ? (
                                <EntityLink
                                  className="!no-underline hover:!underline"
                                  href={`/courses/${reaction.coursePrefix.toLowerCase()}/${reaction.courseNumber.toLowerCase()}`}
                                >
                                  {reaction.coursePrefix}{" "}
                                  {reaction.courseNumber}
                                </EntityLink>
                              ) : null}
                              {reaction.instructorUuid ? (
                                <EntityLink
                                  className="!no-underline hover:!underline"
                                  href={`/instructors/${reaction.instructorUuid}`}
                                >
                                  {instructorLabel(
                                    reaction.instructorUuid,
                                    instructorNames,
                                  )}
                                </EntityLink>
                              ) : null}
                            </p>
                          ) : null}
                          <time
                            className="text-sm text-muted-foreground"
                            dateTime={reaction.createdAt.toISOString()}
                          >
                            {contributionDate.format(reaction.createdAt)}
                          </time>
                        </div>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {REACTION_LABELS[reaction.code] ?? reaction.code}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No reactions yet</EmptyTitle>
                    <EmptyDescription>
                      Reactions you select will appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const userId = await authenticatedUserId();
  if (!userId) redirect("/auth/login?r=%2Faccount");
  const account = getAccountService();
  const [user, contributions] = await Promise.all([
    account.getUser(userId),
    account.getContributions(userId),
  ]);
  if (!user) redirect("/auth/login?r=%2Faccount");
  if (user.status === "onboarding") redirect("/onboarding?r=%2Faccount");

  const instructorNames = await instructorNamesForUuids(
    [...contributions.reviews, ...contributions.reactions].flatMap((item) =>
      item.instructorUuid ? [item.instructorUuid] : [],
    ),
  );

  return (
    <AccountView
      contributions={contributions}
      error={params.error}
      instructorNames={instructorNames}
      saved={params.saved}
      user={user}
    />
  );
}
